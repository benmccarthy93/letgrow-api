// /pages/api/process-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY;
const HASDATA_PROPERTY_API_URL = process.env.HASDATA_PROPERTY_API_URL;
const HASDATA_SCRAPING_API_URL = "https://api.hasdata.com/scrape/web";
const AIRROI_API_KEY = process.env.AIRROI_API_KEY;
const AIRROI_RATES_URL = "https://api.airroi.com/listings/future/rates";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const STALE_PROCESSING_MINUTES = 15;

function getInputValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function truncate(value, max = 250) {
  return String(value || "").slice(0, max);
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  const host = req.headers.host;
  const protocol = host && host.includes("localhost") ? "http" : "https";

  return `${protocol}://${host}`;
}

function isAuthorised(req) {
  const headerSecret =
    req.headers["x-internal-secret"] ||
    req.headers["x-api-internal-secret"];

  return (
    INTERNAL_API_SECRET &&
    String(headerSecret || "") === String(INTERNAL_API_SECRET)
  );
}

function isStaleProcessing(createdAt) {
  if (!createdAt) return true;

  const createdTime = new Date(createdAt).getTime();
  if (Number.isNaN(createdTime)) return true;

  const staleMs = STALE_PROCESSING_MINUTES * 60 * 1000;
  return Date.now() - createdTime > staleMs;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function asInteger(value) {
  const numberValue = asNumber(value);
  return numberValue === null ? null : Math.round(numberValue);
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return null;
}

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function arrayContainsFeature(items, patterns) {
  const normalisedPatterns = patterns.map((pattern) => normaliseText(pattern));

  return items.some((item) => {
    const candidate =
      normaliseText(item?.title) ||
      normaliseText(item?.name) ||
      normaliseText(item?.label) ||
      normaliseText(item);

    if (!candidate) return false;

    return normalisedPatterns.some((pattern) => candidate.includes(pattern));
  });
}

function extractAmenities(raw) {
  const property = asObject(raw?.property);

  const amenitiesCandidates = [
    property.amenities,
    raw?.amenities,
    raw?.listing?.amenities,
    raw?.data?.amenities,
    raw?.pdpSections?.amenities,
    raw?.metadata?.amenities,
  ];

  for (const candidate of amenitiesCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => {
          if (typeof item === "string") {
            return { name: item, title: item, available: true };
          }

          if (item && typeof item === "object") {
            return {
              type: pickFirst(item.type),
              name: pickFirst(item.name, item.title, item.label, item.value),
              title: pickFirst(item.title, item.name, item.label, item.value),
              description: pickFirst(item.description),
              available:
                item.available === undefined ? true : Boolean(item.available),
              raw: item,
            };
          }

          return null;
        })
        .filter(Boolean);
    }
  }

  return [];
}

function extractPhotos(raw) {
  const property = asObject(raw?.property);

  const photoCandidates = [
    property.photos,
    property.images,
    raw?.images,
    raw?.photos,
    raw?.listing?.photos,
    raw?.listing?.images,
    raw?.data?.photos,
    raw?.data?.images,
    raw?.pictureUrls,
  ];

  for (const candidate of photoCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => {
          if (typeof item === "string") {
            return { url: item };
          }

          if (item && typeof item === "object") {
            return {
              url: pickFirst(item.url, item.picture, item.src, item.imageUrl, item.large),
              caption: pickFirst(item.caption, item.title, item.alt),
              raw: item,
            };
          }

          return null;
        })
        .filter(Boolean);
    }
  }

  return [];
}

function extractReviewExcerpts(raw) {
  const property = asObject(raw?.property);

  const reviewCandidates = [
    property.reviews,
    raw?.reviews,
    raw?.listing?.reviews,
    raw?.data?.reviews,
    raw?.reviewSummary?.reviews,
  ];

  for (const candidate of reviewCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .slice(0, 50)
        .map((item) => {
          if (typeof item === "string") {
            return { text: item };
          }

          if (item && typeof item === "object") {
            return {
              text: pickFirst(item.text, item.comment, item.body, item.review),
              rating: asNumber(pickFirst(item.rating, item.score)),
              created_at: pickFirst(item.createdAt, item.date),
              raw: item,
            };
          }

          return null;
        })
        .filter(Boolean);
    }
  }

  return [];
}

function extractHouseRules(raw) {
  const property = asObject(raw?.property);

  const rulesCandidates = [
    property.houseRules,
    raw?.houseRules,
    raw?.listing?.houseRules,
    raw?.data?.houseRules,
    raw?.policies?.houseRules,
  ];

  for (const candidate of rulesCandidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(Boolean);
    }

    if (candidate && typeof candidate === "object") {
      return [candidate];
    }
  }

  return [];
}

function buildListingSnapshot(submission, raw) {
  const property = asObject(raw?.property);
  const listing = asObject(
    pickFirst(
      property,
      raw?.listing,
      raw?.data?.listing,
      raw?.data,
      raw
    )
  );

  const amenities = extractAmenities(raw);
  const photos = extractPhotos(raw);
  const reviewExcerpts = extractReviewExcerpts(raw);
  const houseRules = extractHouseRules(raw);

  const title = asString(
    pickFirst(
      property.title,
      listing.title,
      raw?.title,
      raw?.name,
      raw?.listingTitle,
      raw?.seoTitle
    )
  );

  const description = asString(
    pickFirst(
      property.description,
      listing.description,
      raw?.description,
      raw?.summary,
      raw?.listingDescription
    )
  );

  const roomType = asString(
    pickFirst(
      property.roomType,
      listing.roomType,
      raw?.roomType,
      raw?.room_type
    )
  );

  const propertyType = asString(
    pickFirst(
      property.propertyType,
      listing.propertyType,
      raw?.propertyType,
      raw?.property_type
    )
  );

  const personCapacity = asInteger(
    pickFirst(
      property.guestCapacity,
      property.personCapacity,
      listing.personCapacity,
      listing.capacity,
      raw?.guestCapacity,
      raw?.personCapacity,
      raw?.capacity,
      raw?.guests
    )
  );

  const bedroomCount = asNumber(
    pickFirst(
      property.bedrooms,
      listing.bedrooms,
      raw?.bedrooms,
      raw?.bedroomCount
    )
  );

  const bedCount = asNumber(
    pickFirst(
      property.beds,
      listing.beds,
      raw?.beds,
      raw?.bedCount
    )
  );

  const bathroomCount = asNumber(
    pickFirst(
      property.bathrooms,
      listing.bathrooms,
      raw?.baths,
      raw?.bathrooms,
      raw?.bathroomCount
    )
  );

  const rating = asNumber(
    pickFirst(
      property.rating,
      listing.rating,
      raw?.rating,
      raw?.starRating,
      raw?.avgRating
    )
  );

  const reviewCount = asInteger(
    pickFirst(
      property.reviews,
      property.reviewCount,
      listing.reviewCount,
      raw?.reviewCount,
      raw?.reviewsCount,
      raw?.numberOfReviews
    )
  );

  const superhost = (() => {
    const value = pickFirst(
      property?.host?.isSuperhost,
      listing.superhost,
      raw?.superhost,
      raw?.isSuperhost,
      raw?.host?.isSuperhost
    );

    if (value === null || value === undefined) return null;
    return Boolean(value);
  })();

  const locationText = asString(
    pickFirst(
      property.address,
      raw?.address,
      raw?.location,
      raw?.city,
      raw?.area,
      raw?.publicAddress,
      raw?.listing?.location
    )
  );

  const priceText = asString(
    pickFirst(
      property.price,
      raw?.price,
      raw?.priceText,
      raw?.pricing?.price,
      raw?.pricing?.priceText,
      raw?.nightlyPrice
    )
  );

  const cleaningFeeText = asString(
    pickFirst(
      property.cleaningFee,
      raw?.cleaningFee,
      raw?.pricing?.cleaningFee,
      raw?.pricing?.cleaningFeeText
    )
  );

  const extraFeesJson = pickFirst(
    property.extraFees,
    raw?.pricing?.extraFees,
    raw?.extraFees,
    raw?.fees,
    []
  );

  const checkInText = asString(
    pickFirst(
      property.checkIn,
      raw?.checkIn,
      raw?.checkInTime,
      raw?.policies?.checkIn
    )
  );

  const checkOutText = asString(
    pickFirst(
      property.checkOut,
      raw?.checkOut,
      raw?.checkOutTime,
      raw?.policies?.checkOut
    )
  );

  return {
    submission_id: submission.id,
    job_id: submission.job_id,
    airbnb_listing_id: submission.airbnb_listing_id || null,
    normalised_url: submission.normalised_url || null,
    snapshot_version: "v1",
    title,
    description,
    room_type: roomType,
    property_type: propertyType,
    person_capacity: personCapacity,
    bedroom_count: bedroomCount,
    bed_count: bedCount,
    bathroom_count: bathroomCount,
    amenities_json: amenities,
    amenities_count: amenities.length,
    photo_count: photos.length,
    photos_json: photos,
    rating,
    review_count: reviewCount,
    reviews_excerpt_json: reviewExcerpts,
    superhost,
    location_text: locationText,
    price_text: priceText,
    cleaning_fee_text: cleaningFeeText,
    extra_fees_json: extraFeesJson,
    check_in_text: checkInText,
    check_out_text: checkOutText,
    house_rules_json: houseRules,
    title_length: title ? title.length : 0,
    description_length: description ? description.length : 0,
    has_wifi: arrayContainsFeature(amenities, ["wifi", "wi fi"]),
    has_parking: arrayContainsFeature(amenities, ["parking", "free parking"]),
    has_workspace: arrayContainsFeature(amenities, ["workspace", "dedicated workspace", "desk"]),
    has_self_check_in: arrayContainsFeature(amenities, ["self check in", "self-check-in", "lockbox", "key"]),
    has_air_con: arrayContainsFeature(amenities, ["air conditioning", "aircon", "ac"]),
    has_washer: arrayContainsFeature(amenities, ["washer", "washing machine"]),
    has_dryer: arrayContainsFeature(amenities, ["dryer", "tumble dryer"]),
    has_pet_allowed: arrayContainsFeature(amenities, ["pets allowed", "pet friendly", "pets"]),
    has_hot_tub: arrayContainsFeature(amenities, ["hot tub", "jacuzzi"]),
    has_pool: arrayContainsFeature(amenities, ["pool", "swimming pool"]),
  };
}

async function upsertSnapshot(snapshotPayload) {
  const { error } = await supabase
    .from("listing_snapshots")
    .upsert([snapshotPayload], {
      onConflict: "submission_id",
    });

  if (error) {
    throw new Error(error.message || "Failed to store listing snapshot");
  }
}

async function markSubmission(submissionId, status, statusMessage) {
  await supabase
    .from("listing_submissions")
    .update({
      status,
      status_message: truncate(statusMessage),
    })
    .eq("id", submissionId);
}

async function insertFetchRow({
  submissionId,
  fetchStatus,
  provider,
  requestUrl,
  rawResponse,
}) {
  return supabase.from("listing_fetches").insert([
    {
      submission_id: submissionId,
      fetch_status: fetchStatus,
      provider,
      request_url: requestUrl,
      raw_response: rawResponse,
      created_at: new Date().toISOString(),
    },
  ]);
}

async function fetchHasDataProperty(normalisedUrl) {
  if (!HASDATA_API_KEY) {
    throw new Error("Missing HASDATA_API_KEY env var");
  }

  if (!HASDATA_PROPERTY_API_URL) {
    throw new Error("Missing HASDATA_PROPERTY_API_URL env var");
  }

  const requestUrl = `${HASDATA_PROPERTY_API_URL}?${new URLSearchParams({
    url: normalisedUrl,
  }).toString()}`;

  const response = await fetch(requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${HASDATA_API_KEY}`,
      "x-api-key": HASDATA_API_KEY,
    },
  });

  let raw;
  try {
    raw = await response.json();
  } catch {
    raw = { error: "Non-JSON response from HasData" };
  }

  return {
    ok: response.ok,
    status: response.status,
    requestUrl,
    raw,
  };
}

async function fetchHasDataReviews(normalisedUrl) {
  if (!HASDATA_API_KEY) {
    return { ok: false, reviews: [], error: "Missing HASDATA_API_KEY" };
  }

  // Construct reviews URL: https://www.airbnb.com/rooms/{id}/reviews
  const reviewsUrl = normalisedUrl.replace(/\/?$/, "/reviews");

  try {
    const response = await fetch(HASDATA_SCRAPING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": HASDATA_API_KEY,
      },
      body: JSON.stringify({
        url: reviewsUrl,
        jsRendering: true,
        wait: 5000,
        blockAds: true,
        removeBase64Images: true,
        outputFormat: ["json"],
        aiExtractRules: {
          reviews: {
            type: "list",
            description:
              "The 50 most recent guest reviews on this page, sorted newest first.",
            output: {
              reviewer_name: { type: "string", description: "The guest name" },
              date: { type: "string", description: "When the review was posted" },
              text: { type: "string", description: "The full review comment text" },
            },
          },
        },
      }),
    });

    let raw;
    try {
      raw = await response.json();
    } catch {
      const text = await response.text().catch(() => "(unreadable)");
      console.error("[reviews] Non-JSON response from HasData scraping API", { status: response.status, contentType: response.headers.get("content-type"), bodyPreview: text.slice(0, 500) });
      return { ok: false, reviews: [], error: `Non-JSON response from HasData scraping API (status ${response.status})`, requestUrl: reviewsUrl };
    }

    if (!response.ok) {
      return { ok: false, reviews: [], error: `HasData scraping API returned ${response.status}`, raw, requestUrl: reviewsUrl };
    }

    // aiExtractRules returns results under raw.aiExtractRules or raw.data
    const aiResults = raw?.aiExtractRules || raw?.data?.aiExtractRules || raw;
    const reviewList = aiResults?.reviews || [];

    const reviews = (Array.isArray(reviewList) ? reviewList : [])
      .slice(0, 50)
      .map((item) => {
        if (typeof item === "string") {
          return { text: item };
        }
        if (item && typeof item === "object") {
          return {
            text: item.text || item.comment || item.body || item.review || "",
            reviewer_name: item.reviewer_name || item.name || null,
            created_at: item.date || item.created_at || null,
          };
        }
        return null;
      })
      .filter((r) => r && r.text);

    return { ok: true, reviews, raw, requestUrl: reviewsUrl };
  } catch (err) {
    return { ok: false, reviews: [], error: err.message, requestUrl: reviewsUrl };
  }
}

async function fetchAirRoiFutureRates(airbnbListingId) {
  if (!AIRROI_API_KEY) {
    return { ok: false, status: 0, requestUrl: null, raw: { error: "Missing AIRROI_API_KEY env var" } };
  }

  if (!airbnbListingId) {
    return { ok: false, status: 0, requestUrl: null, raw: { error: "No airbnb_listing_id available" } };
  }

  const requestUrl = `${AIRROI_RATES_URL}?${new URLSearchParams({
    id: String(airbnbListingId),
    currency: "native",
  }).toString()}`;

  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": AIRROI_API_KEY,
      },
    });

    let raw;
    try {
      raw = await response.json();
    } catch {
      raw = { error: "Non-JSON response from AirROI" };
    }

    return {
      ok: response.ok,
      status: response.status,
      requestUrl,
      raw,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      requestUrl,
      raw: { error: err.message || "AirROI fetch threw an exception" },
    };
  }
}

async function triggerScoreNext(req, jobId) {
  const baseUrl = getBaseUrl(req);

  const response = await fetch(`${baseUrl}/api/score-next`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_API_SECRET,
    },
    body: JSON.stringify({
      job_id: jobId,
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function getLatestFetchForSubmission(submissionId) {
  const { data, error } = await supabase
    .from("listing_fetches")
    .select("*")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message || "Failed to fetch existing fetch rows");
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function getLatestScoreForSubmission(submissionId) {
  const { data, error } = await supabase
    .from("listing_scores")
    .select("*")
    .eq("submission_id", submissionId)
    .order("scored_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message || "Failed to fetch existing score rows");
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function getListingHistorySignals(submission) {
  const listingId = submission.airbnb_listing_id || null;
  const normalisedUrl = submission.normalised_url || null;

  if (!listingId && !normalisedUrl) {
    return {
      previous_submission_count: 0,
      latest_previous_submission_id: null,
      latest_previous_job_id: null,
      latest_previous_score: null,
    };
  }

  let query = supabase
    .from("listing_submissions")
    .select("id, job_id, created_at, airbnb_listing_id, normalised_url")
    .neq("id", submission.id)
    .order("created_at", { ascending: false });

  if (listingId) {
    query = query.eq("airbnb_listing_id", listingId);
  } else {
    query = query.eq("normalised_url", normalisedUrl);
  }

  const { data: previousSubmissions, error: previousSubmissionsError } =
    await query;

  if (previousSubmissionsError) {
    throw new Error(
      previousSubmissionsError.message ||
        "Failed to fetch previous submissions for this listing"
    );
  }

  const previousCount = Array.isArray(previousSubmissions)
    ? previousSubmissions.length
    : 0;

  const latestPreviousSubmission =
    previousCount > 0 ? previousSubmissions[0] : null;

  let latestPreviousScore = null;

  if (latestPreviousSubmission?.id) {
    const { data: previousScores, error: previousScoresError } = await supabase
      .from("listing_scores")
      .select("overall_score, score_label, scored_at, submission_id")
      .eq("submission_id", latestPreviousSubmission.id)
      .order("scored_at", { ascending: false })
      .limit(1);

    if (previousScoresError) {
      throw new Error(
        previousScoresError.message ||
          "Failed to fetch previous score for this listing"
      );
    }

    latestPreviousScore =
      Array.isArray(previousScores) && previousScores.length > 0
        ? previousScores[0]
        : null;
  }

  return {
    previous_submission_count: previousCount,
    latest_previous_submission_id: latestPreviousSubmission?.id || null,
    latest_previous_job_id: latestPreviousSubmission?.job_id || null,
    latest_previous_score: latestPreviousScore?.overall_score ?? null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  if (!isAuthorised(req)) {
    return res.status(401).json({
      success: false,
      error: "Unauthorised",
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing Supabase env vars",
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = req.query || {};

    const jobId =
      getInputValue(body.job_id) ||
      getInputValue(query.job_id) ||
      null;

    const submissionId =
      getInputValue(body.submission_id) ||
      getInputValue(query.submission_id) ||
      null;

    let submissionQuery = supabase.from("listing_submissions").select("*");

    if (submissionId) {
      submissionQuery = submissionQuery.eq("id", submissionId);
    } else if (jobId) {
      submissionQuery = submissionQuery.eq("job_id", jobId);
    } else {
      submissionQuery = submissionQuery
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);
    }

    const { data: submissionRows, error: submissionError } =
      await submissionQuery;

    if (submissionError) {
      console.error("Submission lookup error:", submissionError);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch submission",
      });
    }

    const submission = Array.isArray(submissionRows)
      ? submissionRows[0]
      : submissionRows;

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: "No matching submission found",
      });
    }

    if (!submission.normalised_url) {
      await markSubmission(
        submission.id,
        "failed",
        "Missing normalised_url on submission"
      );

      return res.status(400).json({
        success: false,
        error: "Submission is missing normalised_url",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const existingScore = await getLatestScoreForSubmission(submission.id);

    if (existingScore) {
      await markSubmission(
        submission.id,
        "complete",
        "Score already exists for this submission"
      );

      return res.status(200).json({
        success: true,
        submission_id: submission.id,
        job_id: submission.job_id,
        processed_by: jobId || submissionId ? "targeted" : "oldest_pending",
        skipped: true,
        reason: "score_already_exists",
        score_triggered: false,
      });
    }

    if (submission.status === "complete") {
      return res.status(200).json({
        success: true,
        submission_id: submission.id,
        job_id: submission.job_id,
        processed_by: jobId || submissionId ? "targeted" : "oldest_pending",
        skipped: true,
        reason: "submission_already_complete",
        score_triggered: false,
      });
    }

    if (
      submission.status === "processing" &&
      !isStaleProcessing(submission.created_at)
    ) {
      return res.status(200).json({
        success: true,
        submission_id: submission.id,
        job_id: submission.job_id,
        processed_by: jobId || submissionId ? "targeted" : "oldest_pending",
        skipped: true,
        reason: "submission_already_processing",
        score_triggered: false,
      });
    }

    const existingFetch = await getLatestFetchForSubmission(submission.id);

    if (!existingFetch || existingFetch.fetch_status !== "success") {
      await markSubmission(
        submission.id,
        "processing",
        "Fetching listing data"
      );

      const hasDataResult = await fetchHasDataProperty(submission.normalised_url);

      if (!hasDataResult.ok) {
        await insertFetchRow({
          submissionId: submission.id,
          fetchStatus: "failed",
          provider: "hasdata",
          requestUrl: hasDataResult.requestUrl,
          rawResponse: hasDataResult.raw,
        });

        await markSubmission(
          submission.id,
          "failed",
          `Fetch failed (${hasDataResult.status})`
        );

        return res.status(502).json({
          success: false,
          error: "HasData fetch failed",
          submission_id: submission.id,
          job_id: submission.job_id,
          provider_status: hasDataResult.status,
          raw_response: hasDataResult.raw,
        });
      }

      const historySignals = await getListingHistorySignals(submission);

      const enrichedRawResponse = {
        ...hasDataResult.raw,
        letgrow_learning_signals: {
          submission_id: submission.id,
          job_id: submission.job_id,
          airbnb_listing_id: submission.airbnb_listing_id || null,
          normalised_url: submission.normalised_url || null,
          submitted_at: submission.created_at || null,
          previous_submission_count: historySignals.previous_submission_count,
          latest_previous_submission_id:
            historySignals.latest_previous_submission_id,
          latest_previous_job_id: historySignals.latest_previous_job_id,
          latest_previous_score: historySignals.latest_previous_score,
        },
      };

      const { error: fetchInsertError } = await insertFetchRow({
        submissionId: submission.id,
        fetchStatus: "success",
        provider: "hasdata",
        requestUrl: hasDataResult.requestUrl,
        rawResponse: enrichedRawResponse,
      });

      if (fetchInsertError) {
        console.error("Fetch row insert error:", fetchInsertError);

        await markSubmission(
          submission.id,
          "failed",
          "Fetched listing data but failed to store fetch row"
        );

        return res.status(500).json({
          success: false,
          error: "Failed to store fetch row",
        });
      }

      try {
        const snapshotPayload = buildListingSnapshot(
          submission,
          enrichedRawResponse
        );

        await upsertSnapshot(snapshotPayload);
      } catch (snapshotError) {
        console.error("Snapshot storage error:", snapshotError);

        await markSubmission(
          submission.id,
          "failed",
          "Fetched listing data but failed to store snapshot"
        );

        return res.status(500).json({
          success: false,
          error: "Failed to store listing snapshot",
        });
      }
    }

    // Scrape reviews via HasData web scraping API if property API returned none (non-blocking)
    if (submission.normalised_url) {
      try {
        // Check if the snapshot already has reviews
        const { data: currentSnapshot } = await supabase
          .from("listing_snapshots")
          .select("reviews_excerpt_json")
          .eq("submission_id", submission.id)
          .single();

        const existingReviews = currentSnapshot?.reviews_excerpt_json;
        const needsReviewScrape = !existingReviews || (Array.isArray(existingReviews) && existingReviews.length === 0);

        if (needsReviewScrape) {
          const reviewResult = await fetchHasDataReviews(submission.normalised_url);

          await insertFetchRow({
            submissionId: submission.id,
            fetchStatus: reviewResult.ok ? "success" : "failed",
            provider: "hasdata-reviews",
            requestUrl: reviewResult.requestUrl,
            rawResponse: reviewResult.raw || { error: reviewResult.error },
          });

          if (reviewResult.ok && reviewResult.reviews.length > 0) {
            // Only update reviews_excerpt_json; keep review_count from property API (the real total)
            await supabase
              .from("listing_snapshots")
              .update({ reviews_excerpt_json: reviewResult.reviews })
              .eq("submission_id", submission.id);
          }
        }
      } catch (reviewScrapeError) {
        console.error("Review scraping error (non-blocking):", reviewScrapeError);
      }
    }

    // Fetch AirROI future rates data (non-blocking — failure doesn't stop the pipeline)
    if (submission.airbnb_listing_id) {
      try {
        const airRoiResult = await fetchAirRoiFutureRates(submission.airbnb_listing_id);

        await insertFetchRow({
          submissionId: submission.id,
          fetchStatus: airRoiResult.ok ? "success" : "failed",
          provider: "airroi",
          requestUrl: airRoiResult.requestUrl,
          rawResponse: airRoiResult.raw,
        });
      } catch (airRoiError) {
        console.error("AirROI fetch error (non-blocking):", airRoiError);
      }
    }

    await markSubmission(
      submission.id,
      "fetched",
      "Listing data fetched successfully"
    );

    const scoreCheckAfterFetch = await getLatestScoreForSubmission(submission.id);

    if (scoreCheckAfterFetch) {
      await markSubmission(
        submission.id,
        "complete",
        "Score already exists for this submission"
      );

      return res.status(200).json({
        success: true,
        submission_id: submission.id,
        job_id: submission.job_id,
        processed_by: jobId || submissionId ? "targeted" : "oldest_pending",
        skipped: true,
        reason: "score_already_exists_after_fetch",
        score_triggered: false,
      });
    }

    const scoreTrigger = await triggerScoreNext(req, submission.job_id);

    if (!scoreTrigger.ok) {
      console.error("Score trigger failed:", scoreTrigger);

      await markSubmission(
        submission.id,
        "fetched",
        "Fetched successfully but scoring trigger failed"
      );

      return res.status(502).json({
        success: false,
        error: "Fetch completed but scoring trigger failed",
        submission_id: submission.id,
        job_id: submission.job_id,
        score_trigger_status: scoreTrigger.status,
        score_trigger_response: scoreTrigger.data,
      });
    }

    return res.status(200).json({
      success: true,
      submission_id: submission.id,
      job_id: submission.job_id,
      processed_by: jobId || submissionId ? "targeted" : "oldest_pending",
      fetch_status:
        existingFetch?.fetch_status === "success" ? "reused" : "success",
      snapshot_stored: true,
      score_triggered: true,
      score_response: scoreTrigger.data,
    });
  } catch (error) {
    console.error("Unhandled error in process-next:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
}
