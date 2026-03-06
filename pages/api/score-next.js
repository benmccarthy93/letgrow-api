import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { job_id, submission_id } = req.body || {};

  try {
    // 1) Find the target submission
    let submissionQuery = supabase
      .from("listing_submissions")
      .select("*")
      .limit(1);

    if (job_id) {
      submissionQuery = submissionQuery.eq("job_id", job_id);
    } else if (submission_id) {
      submissionQuery = submissionQuery.eq("id", submission_id);
    } else {
      submissionQuery = submissionQuery
        .in("status", ["fetched", "processing_complete", "ready_for_scoring"])
        .order("created_at", { ascending: true });
    }

    const { data: submissionRows, error: submissionError } = await submissionQuery;

    if (submissionError) {
      throw new Error(`Failed to load submission: ${submissionError.message}`);
    }

    const submission = submissionRows?.[0];

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: "No matching submission found",
      });
    }

    // 2) Load latest fetch row for this submission
    const { data: fetchRows, error: fetchError } = await supabase
      .from("listing_fetches")
      .select("*")
      .eq("submission_id", submission.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (fetchError) {
      throw new Error(`Failed to load fetch row: ${fetchError.message}`);
    }

    const fetchRow = fetchRows?.[0];

    if (!fetchRow) {
      await markSubmissionFailed(submission.id, "No fetch row found for submission");
      return res.status(400).json({
        success: false,
        error: "No fetch row found for submission",
      });
    }

    const raw = normaliseRawPayload(fetchRow.raw_response);

    // 3) Extract listing data from varied HasData payload shapes
    const listing = extractListingSignals(raw);

    // 4) Score the listing with stricter rules
    const scored = scoreListingStrict(listing);

    // 5) Write score row
    const insertPayload = {
      submission_id: submission.id,
      scoring_version: "v3",
      overall_score: scored.overall_score,
      score_label: scored.score_label,
      title_score: scored.title_score,
      description_score: scored.description_score,
      photo_score: scored.photo_score,
      amenity_score: scored.amenity_score,
      trust_score: scored.trust_score,
      market_score: scored.market_score,
      summary: scored.summary,
      top_fixes: scored.top_fixes,
      detected_photo_count: scored.detected_signals.photos_detected,
      detected_review_count: scored.detected_signals.reviews_detected,
      detected_rating: scored.detected_signals.rating_detected,
      scored_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("listing_scores")
      .insert(insertPayload);

    if (insertError) {
      throw new Error(`Failed to insert score row: ${insertError.message}`);
    }

    // 6) Mark submission complete
    const { error: updateError } = await supabase
      .from("listing_submissions")
      .update({
        status: "complete",
        status_message: "Scoring complete",
      })
      .eq("id", submission.id);

    if (updateError) {
      throw new Error(`Failed to update submission status: ${updateError.message}`);
    }

    return res.status(200).json({
      success: true,
      submission_id: submission.id,
      job_id: submission.job_id,
      overall_score: scored.overall_score,
      score_label: scored.score_label,
    });
  } catch (error) {
    console.error("score-next failed:", error);

    if (submission_id) {
      await markSubmissionFailed(submission_id, error.message);
    }

    if (job_id) {
      const { data: rows } = await supabase
        .from("listing_submissions")
        .select("id")
        .eq("job_id", job_id)
        .limit(1);

      if (rows?.[0]?.id) {
        await markSubmissionFailed(rows[0].id, error.message);
      }
    }

    return res.status(500).json({
      success: false,
      error: error.message || "Unknown scoring error",
    });
  }
}

async function markSubmissionFailed(submissionId, message) {
  try {
    await supabase
      .from("listing_submissions")
      .update({
        status: "failed",
        status_message: truncate(message || "Scoring failed", 250),
      })
      .eq("id", submissionId);
  } catch (err) {
    console.error("Failed to mark submission as failed:", err);
  }
}

function normaliseRawPayload(raw) {
  if (!raw) return {};

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return raw;
}

function extractListingSignals(raw) {
  const candidates = [
    raw,
    raw?.data,
    raw?.result,
    raw?.results,
    raw?.property,
    raw?.listing,
    raw?.data?.property,
    raw?.data?.listing,
    raw?.result?.property,
    raw?.result?.listing,
    raw?.data?.results?.[0],
    raw?.results?.[0],
  ].filter(Boolean);

  const merged = mergeObjects(candidates);

  const title =
    firstString([
      merged?.title,
      merged?.name,
      merged?.listing_name,
      merged?.listingTitle,
      merged?.seo_title,
      merged?.headline,
    ]) || "";

  const description =
    firstString([
      merged?.description,
      merged?.summary,
      merged?.listing_description,
      merged?.space,
      merged?.notes,
      merged?.public_description,
    ]) || "";

  const photos = extractPhotos(merged);
  const amenities = extractAmenities(merged);
  const rating = extractRating(merged);
  const reviewsCount = extractReviewsCount(merged);
  const isSuperhost = extractBoolean(merged, [
    "is_superhost",
    "superhost",
    "host_is_superhost",
  ]);
  const isVerifiedHost = extractBoolean(merged, [
    "is_verified",
    "verified_host",
    "host_verified",
  ]);

  const hostName =
    firstString([
      merged?.host_name,
      merged?.host?.name,
      merged?.primary_host?.name,
    ]) || "";

  return {
    title,
    description,
    photos,
    amenities,
    rating,
    reviewsCount,
    isSuperhost,
    isVerifiedHost,
    hostName,
    raw: merged,
  };
}

function scoreListingStrict(listing) {
  const amenitySet = new Set(
    listing.amenities
      .map((a) => normaliseText(typeof a === "string" ? a : a?.title || a?.name || ""))
      .filter(Boolean)
  );

  const photoInfo = analysePhotos(listing.photos);
  const titleInfo = analyseTitle(listing.title);
  const descriptionInfo = analyseDescription(listing.description, amenitySet);
  const amenityInfo = analyseAmenities(amenitySet, listing.description);
  const trustInfo = analyseTrust(listing, amenitySet);
  const marketInfo = analyseCompetitivePositioning(listing, amenitySet, photoInfo);

  const title_score = clamp(titleInfo.score, 0, 15);
  const description_score = clamp(descriptionInfo.score, 0, 15);
  const photo_score = clamp(photoInfo.score, 0, 20);
  const amenity_score = clamp(amenityInfo.score, 0, 20);
  const trust_score = clamp(trustInfo.score, 0, 20);
  const market_score = clamp(marketInfo.score, 0, 10);

  let overall =
    title_score +
    description_score +
    photo_score +
    amenity_score +
    trust_score +
    market_score;

  const penalties = [];

  // Global penalties
  if (photoInfo.count < 10) penalties.push({ key: "very_sparse_photos", value: 11 });
  else if (photoInfo.count < 15) penalties.push({ key: "sparse_photos", value: 7 });
  else if (photoInfo.count < 20) penalties.push({ key: "suboptimal_photos", value: 4 });

  if (listing.reviewsCount < 5) penalties.push({ key: "very_low_reviews", value: 8 });
  else if (listing.reviewsCount < 10) penalties.push({ key: "low_reviews", value: 5 });
  else if (listing.reviewsCount < 20) penalties.push({ key: "limited_reviews", value: 3 });

  if ((listing.rating || 0) > 0 && listing.rating < 4.5) {
    penalties.push({ key: "low_rating", value: 8 });
  } else if ((listing.rating || 0) >= 4.5 && listing.rating < 4.8) {
    penalties.push({ key: "middling_rating", value: 4 });
  }

  if (amenityInfo.practicalMissingCount >= 4) {
    penalties.push({ key: "weak_practical_readiness", value: 6 });
  } else if (amenityInfo.practicalMissingCount >= 2) {
    penalties.push({ key: "some_practical_gaps", value: 3 });
  }

  if (descriptionInfo.claimsWithoutSupport >= 3) {
    penalties.push({ key: "copy_amenity_mismatch", value: 5 });
  } else if (descriptionInfo.claimsWithoutSupport >= 1) {
    penalties.push({ key: "light_copy_amenity_mismatch", value: 2 });
  }

  if (photoInfo.overloadedLikely) {
    penalties.push({ key: "photo_overload", value: photoInfo.count >= 60 ? 4 : 2 });
  }

  const penaltyTotal = penalties.reduce((sum, p) => sum + p.value, 0);
  overall -= penaltyTotal;

  // Caps: one weak area should drag the whole listing down
  let overallCap = 100;

  if (photo_score < 12) overallCap = Math.min(overallCap, 78);
  if (photo_score < 8) overallCap = Math.min(overallCap, 70);

  if (trust_score < 10) overallCap = Math.min(overallCap, 74);
  if (trust_score < 6) overallCap = Math.min(overallCap, 66);

  if (title_score <= 5 && description_score <= 5) overallCap = Math.min(overallCap, 72);
  if (listing.reviewsCount < 5) overallCap = Math.min(overallCap, 68);

  overall = Math.min(overall, overallCap);
  overall = clamp(Math.round(overall), 0, 100);

  const score_label = scoreLabel(overall);

  const summary = {
    title: titleInfo.message,
    description: descriptionInfo.message,
    photos: photoInfo.message,
    amenities: amenityInfo.message,
    trust: trustInfo.message,
    competitive_positioning: marketInfo.message,
    detected_signals: {
      photos_detected: photoInfo.count,
      reviews_detected: listing.reviewsCount || 0,
      rating_detected: listing.rating ?? null,
      superhost_detected: !!listing.isSuperhost,
      verified_host_detected: !!listing.isVerifiedHost,
      photo_signals: photoInfo.signals,
      trust_signals: trustInfo.signals,
      amenity_signals: amenityInfo.signals,
      positioning_signals: marketInfo.signals,
      penalties_applied: penalties,
      overall_cap_applied: overallCap < 100 ? overallCap : null,
    },
  };

  const top_fixes = {
    improvement_potential: estimateImprovementPotential(overall, photoInfo, trustInfo, amenityInfo),
    priorities: buildPriorities(photoInfo, trustInfo, amenityInfo, titleInfo, descriptionInfo, marketInfo),
  };

  return {
    overall_score: overall,
    score_label,
    title_score,
    description_score,
    photo_score,
    amenity_score,
    trust_score,
    market_score,
    summary,
    top_fixes,
    detected_signals: {
      photos_detected: photoInfo.count,
      reviews_detected: listing.reviewsCount || 0,
      rating_detected: listing.rating ?? null,
    },
  };
}

function analyseTitle(title) {
  const raw = title || "";
  const t = raw.trim();
  const lower = normaliseText(t);
  const length = t.length;
  const words = splitWords(lower);

  let score = 0;

  const hasUsefulLength = length >= 18 && length <= 55;
  const tooShort = length > 0 && length < 18;
  const tooLong = length > 65;
  const spamSymbols = (t.match(/[!⭐✨🔥💎🏡🎉•|~]/g) || []).length;
  const hasLocationSignal = /\b(city centre|city center|parking|balcony|terrace|garden|views?|hot tub|wifi|family|workspace|parking)\b/.test(lower);
  const hasPropertyType = /\b(apartment|flat|home|house|cottage|cabin|studio|loft|villa|barn|bungalow)\b/.test(lower);
  const hasGuestFit = /\b(family|families|business|work|couples|group|remote work|contractor|contractors)\b/.test(lower);
  const genericTerms = countMatches(lower, [
    "lovely",
    "beautiful",
    "amazing",
    "stunning",
    "nice",
    "great",
    "perfect",
    "gorgeous",
  ]);

  if (!t) {
    score = 0;
  } else if (tooShort || tooLong || spamSymbols >= 3 || genericTerms >= 3) {
    score = 1 + (hasPropertyType ? 1 : 0) + (hasLocationSignal ? 1 : 0);
  } else if (hasUsefulLength && hasPropertyType && (hasLocationSignal || hasGuestFit)) {
    score = 8 + (hasGuestFit ? 1 : 0) + (spamSymbols === 0 ? 1 : 0) + (genericTerms === 0 ? 1 : 0);
  } else if (hasUsefulLength || hasPropertyType) {
    score = 3 + (hasPropertyType ? 1 : 0) + (hasLocationSignal ? 1 : 0);
  } else {
    score = 3;
  }

  if (words.length <= 3) score -= 1;
  if (spamSymbols >= 2) score -= 2;
  if (genericTerms >= 2) score -= 1;

  score = clamp(score, 0, 15);

  const message =
    score <= 3
      ? "Your title looks weak or too generic, which may be limiting clicks before guests even open the listing."
      : score <= 5
      ? "Your title is readable, but it feels fairly ordinary and may not be surfacing the strongest reasons to book."
      : score <= 11
      ? "Your title is reasonably clear and useful, though it may still be underselling the most compelling parts of the stay."
      : "Your title is doing a good job of signalling value, clarity and guest relevance.";

  return { score, message };
}

function analyseDescription(description, amenitySet) {
  const raw = description || "";
  const d = raw.trim();
  const lower = normaliseText(d);
  const length = d.length;

  let score = 0;

  const hasStructure = /\n|•|- /.test(raw);
  const opening = lower.slice(0, 220);
  const openingHasValue = /\b(parking|wifi|workspace|family|walk|minutes|terrace|balcony|garden|views?|self check-in|self check in|kitchen)\b/.test(opening);
  const claims = [
    { phrase: /\bparking\b/, support: hasAmenity(amenitySet, ["parking", "free parking", "street parking", "garage"]) },
    { phrase: /\bworkspace|desk|remote work|work from home\b/, support: hasAmenity(amenitySet, ["workspace", "desk", "wifi"]) },
    { phrase: /\bself check-in|self check in\b/, support: hasAmenity(amenitySet, ["self check-in", "self check in", "lockbox", "smart lock"]) },
    { phrase: /\bwasher|washing machine|laundry\b/, support: hasAmenity(amenitySet, ["washer", "washing machine", "dryer"]) },
    { phrase: /\bkitchen\b/, support: hasAmenity(amenitySet, ["kitchen"]) },
    { phrase: /\bair conditioning|ac\b/, support: hasAmenity(amenitySet, ["air conditioning", "ac"]) },
  ];

  let claimsWithoutSupport = 0;
  for (const claim of claims) {
    if (claim.phrase.test(lower) && !claim.support) claimsWithoutSupport += 1;
  }

  const descriptiveSpecificity = countMatches(lower, [
    "minutes",
    "walk",
    "workspace",
    "parking",
    "balcony",
    "terrace",
    "garden",
    "family",
    "business",
    "kitchen",
    "washer",
    "check-in",
    "lift",
    "elevator",
  ]);

  if (!d) {
    score = 0;
  } else if (length < 120) {
    score = 1 + Math.min(descriptiveSpecificity, 1);
  } else if (length < 250 || !openingHasValue) {
    score = 3 + Math.min(descriptiveSpecificity, 2) + (hasStructure ? 1 : 0);
  } else {
    score =
      6 +
      Math.min(descriptiveSpecificity, 4) +
      (openingHasValue ? 1 : 0) +
      (hasStructure ? 1 : 0);
  }

  if (length > 1200) score -= 1;
  if (claimsWithoutSupport >= 3) score -= 2;
  else if (claimsWithoutSupport >= 1) score -= 1;

  score = clamp(score, 0, 15);

  const message =
    score <= 2
      ? "Your description looks thin or too vague, so guests may not be getting enough confidence from it."
      : score <= 5
      ? "Your description covers some basics, but the opening may be too slow or too generic to sell the stay well."
      : score <= 11
      ? "Your description is reasonably specific and useful, though the value could be surfaced faster and more clearly."
      : "Your description is doing a good job of explaining the stay in a clear and persuasive way.";

  return { score, message, claimsWithoutSupport };
}

function analysePhotos(photos) {
  const count = photos.length;
  const photoTexts = photos
    .map((p) => normaliseText([p.url, p.caption, p.alt, p.title].filter(Boolean).join(" ")))
    .join(" | ");

  const bedroomCoverage = /\bbedroom|bed\b/.test(photoTexts);
  const bathroomCoverage = /\bbathroom|bath|shower\b/.test(photoTexts);
  const kitchenCoverage = /\bkitchen|hob|oven|microwave|fridge\b/.test(photoTexts);
  const livingCoverage = /\bliving|sofa|lounge|sitting room|tv room\b/.test(photoTexts);
  const exteriorCoverage = /\bexterior|outside|building|front|entry|entrance|parking|drive|garden|terrace|balcony\b/.test(photoTexts);

  const roomCoverageHits = [
    bedroomCoverage,
    bathroomCoverage,
    kitchenCoverage,
    livingCoverage,
    exteriorCoverage,
  ].filter(Boolean).length;

  const firstSetText = photos
    .slice(0, 5)
    .map((p) => normaliseText([p.url, p.caption, p.alt, p.title].filter(Boolean).join(" ")))
    .join(" | ");

  const strongFirstImageSet =
    /\bbedroom|living|kitchen|view|balcony|terrace|garden|parking|exterior\b/.test(firstSetText);

  const likelyMissingRooms = roomCoverageHits <= 2;
  const weakVariety = roomCoverageHits <= 3;
  const practicalShotsMissing = !/\bparking|entry|entrance|workspace|desk|washer|laundry|bathroom|kitchen\b/.test(photoTexts);
  const overloadedLikely = count >= 44;
  const fillerLikely = count >= 44;
  const repetitionLikely = detectRepetition(photos);

  // Count-based baseline exactly in line with your stricter ranges
  let score = 0;

  if (count <= 4) score = 0;
  else if (count <= 7) score = 1;
  else if (count <= 11) score = 3;
  else if (count <= 15) score = 5;
  else if (count <= 19) score = 10;
  else if (count <= 24) score = 17;
  else if (count <= 35) score = 20;
  else if (count <= 43) score = 19;
  else if (count <= 50) score = 18;
  else if (count <= 60) score = 16;
  else score = 14;

  // Add points
  if (bedroomCoverage) score += 1;
  if (bathroomCoverage) score += 1;
  if (kitchenCoverage) score += 1;
  if (livingCoverage) score += 1;
  if (exteriorCoverage) score += 1;
  if (strongFirstImageSet) score += 1;

  // Subtract points
  if (count < 20) score -= 2;
  if (likelyMissingRooms) score -= 2;
  if (repetitionLikely) score -= 2;
  if (weakVariety) score -= 2;
  if (practicalShotsMissing) score -= 1;
  if (fillerLikely) score -= 2;

  // Keep sparse photo sets from looking strong even with decent variety
  if (count <= 15) score = Math.min(score, 12);
  if (count <= 11) score = Math.min(score, 8);

  score = clamp(score, 0, 20);

  const message =
    score <= 5
      ? "Your photo set looks too thin to build strong booking confidence, and guests may not be seeing enough of the space."
      : score <= 10
      ? "Your photos give some visibility, but the volume still looks light and may be leaving gaps in room coverage."
      : score <= 15
      ? "Your photo set is decent in places, though fuller coverage and stronger variety would improve confidence."
      : "Your photo coverage looks solid overall and is doing a good job of helping guests picture the stay.";

  return {
    score,
    count,
    overloadedLikely,
    message,
    signals: {
      bedroom_coverage: bedroomCoverage,
      bathroom_coverage: bathroomCoverage,
      kitchen_coverage: kitchenCoverage,
      living_coverage: livingCoverage,
      exterior_or_practical_coverage: exteriorCoverage,
      strong_first_image_set: strongFirstImageSet,
      likely_missing_rooms: likelyMissingRooms,
      weak_variety: weakVariety,
      practical_shots_missing: practicalShotsMissing,
      repetition_likely: repetitionLikely,
    },
  };
}

function analyseAmenities(amenitySet, description) {
  const corePractical = [
    ["wifi"],
    ["kitchen"],
    ["washer", "washing machine"],
    ["tv"],
    ["heating"],
    ["self check-in", "self check in", "lockbox", "smart lock"],
    ["workspace", "desk"],
    ["parking", "free parking", "street parking", "garage"],
  ];

  let practicalHits = 0;
  let practicalMissingCount = 0;

  for (const group of corePractical) {
    const found = hasAmenity(amenitySet, group);
    if (found) practicalHits += 1;
    else practicalMissingCount += 1;
  }

  const bonusGroups = [
    ["dryer"],
    ["air conditioning", "ac"],
    ["dishwasher"],
    ["coffee maker", "coffee machine"],
    ["hot tub"],
    ["balcony", "terrace", "garden", "patio"],
    ["lift", "elevator"],
    ["ev charger", "electric vehicle charger"],
  ];

  let bonusHits = 0;
  for (const group of bonusGroups) {
    if (hasAmenity(amenitySet, group)) bonusHits += 1;
  }

  let score = practicalHits * 2 + Math.min(bonusHits, 4);

  const desc = normaliseText(description || "");
  if (/\bfamily|business|remote work|contractor|long stay\b/.test(desc)) score += 1;

  score = clamp(score, 0, 20);

  const message =
    score <= 7
      ? "Your amenities look light on key practical details, which may be making the stay feel less ready for real guest needs."
      : score <= 13
      ? "Your amenities cover some important basics, though there still appear to be practical gaps that could hold the listing back."
      : score <= 17
      ? "Your amenities look fairly solid overall, though a few practical extras could still improve guest confidence."
      : "Your amenities are well-rounded and are supporting the listing strongly.";

  return {
    score,
    practicalMissingCount,
    message,
    signals: {
      practical_hits: practicalHits,
      bonus_hits: bonusHits,
    },
  };
}

function analyseTrust(listing, amenitySet) {
  const reviews = Number(listing.reviewsCount || 0);
  const rating = Number(listing.rating || 0);

  let reviewVolumeScore = 0;
  if (reviews === 0) reviewVolumeScore = 0;
  else if (reviews <= 2) reviewVolumeScore = 0;
  else if (reviews <= 4) reviewVolumeScore = 1;
  else if (reviews <= 9) reviewVolumeScore = 2;
  else if (reviews <= 19) reviewVolumeScore = 4;
  else if (reviews <= 39) reviewVolumeScore = 5;
  else if (reviews <= 79) reviewVolumeScore = 6;
  else if (reviews <= 119) reviewVolumeScore = 7;
  else reviewVolumeScore = 8;

  let ratingScore = 0;
  if (rating > 0 && rating < 4.5) ratingScore = 0;
  else if (rating >= 4.5 && rating <= 4.69) ratingScore = 1;
  else if (rating >= 4.7 && rating <= 4.79) ratingScore = 3;
  else if (rating >= 4.8 && rating <= 4.86) ratingScore = 4;
  else if (rating >= 4.87 && rating <= 4.93) ratingScore = 5;
  else if (rating >= 4.94) ratingScore = 6;

  let hostScore = 0;
  if (listing.isSuperhost) hostScore += 2;
  if (listing.isVerifiedHost) hostScore += 1;

  let safetyScore = 0;
  if (hasAmenity(amenitySet, ["smoke alarm"])) safetyScore += 1;
  if (hasAmenity(amenitySet, ["carbon monoxide alarm", "co alarm"])) safetyScore += 1;
  if (hasAmenity(amenitySet, ["first aid kit", "fire extinguisher"])) safetyScore += 1;
  if (hasAmenity(amenitySet, ["self check-in", "self check in", "lockbox", "smart lock"])) safetyScore += 1;
  if (hasAmenity(amenitySet, ["security cameras", "building staff", "gated"])) safetyScore += 1;

  let score = reviewVolumeScore + ratingScore + hostScore + safetyScore;
  score = clamp(score, 0, 20);

  const message =
    score <= 6
      ? "Your trust signals look weak at the moment, which may be making guests hesitate before booking."
      : score <= 10
      ? "Your trust profile is building, but the review depth or reassurance signals still look fairly limited."
      : score <= 15
      ? "Your trust signals are reasonably solid, though there is still room to strengthen guest confidence further."
      : "Your listing has strong trust signals, supported by guest feedback and reassurance details.";

  return {
    score,
    message,
    signals: {
      review_volume_score: reviewVolumeScore,
      rating_score: ratingScore,
      host_score: hostScore,
      safety_score: safetyScore,
    },
  };
}

function analyseCompetitivePositioning(listing, amenitySet, photoInfo) {
  const title = normaliseText(listing.title || "");
  const description = normaliseText(listing.description || "");
  const combined = `${title} ${description}`;

  let score = 0;

  const guestFit = /\b(family|families|business|remote work|workspace|contractor|couples|long stay)\b/.test(combined);
  const practicalValue = /\b(parking|wifi|workspace|self check-in|self check in|washer|kitchen|terrace|balcony|garden)\b/.test(combined);
  const differentiation = /\b(terrace|balcony|garden|views?|workspace|xl bed|king bed|free parking|self check-in|pet friendly|hot tub)\b/.test(combined);
  const copyAmenityConsistency =
    (!/\bparking\b/.test(combined) || hasAmenity(amenitySet, ["parking", "free parking", "street parking", "garage"])) &&
    (!/\bworkspace|desk|remote work\b/.test(combined) || hasAmenity(amenitySet, ["workspace", "desk", "wifi"])) &&
    (!/\bself check-in|self check in\b/.test(combined) || hasAmenity(amenitySet, ["self check-in", "self check in", "lockbox", "smart lock"]));

  const genericness = countMatches(combined, [
    "lovely",
    "beautiful",
    "amazing",
    "perfect",
    "great",
    "nice",
    "stylish",
  ]);

  if (!guestFit && !practicalValue && !differentiation) {
    score = 1;
  } else if ((guestFit || practicalValue) && !differentiation) {
    score = 3;
  } else if (guestFit && practicalValue) {
    score = 5;
  }

  if (differentiation) score += 2;
  if (copyAmenityConsistency) score += 1;
  if (photoInfo.count >= 20) score += 1;
  if (genericness >= 3) score -= 1;

  score = clamp(score, 0, 10);

  const message =
    score <= 1
      ? "Your listing positioning looks quite generic, so it may not be clearly telling the right guests why they should choose it."
      : score <= 3
      ? "Your listing shows some positioning, but it still feels ordinary and may not be standing out enough."
      : score <= 6
      ? "Your listing has decent practical value and guest fit, though the edge over competing listings could be sharper."
      : score <= 9
      ? "Your listing shows strong differentiation and is doing a good job of communicating who it suits."
      : "Your listing is exceptionally clear on guest fit, practical value and differentiation.";

  return {
    score,
    message,
    signals: {
      guest_fit_detected: guestFit,
      practical_value_detected: practicalValue,
      differentiation_detected: differentiation,
      copy_amenity_consistency: copyAmenityConsistency,
    },
  };
}

function scoreLabel(score) {
  if (score <= 49) return "Needs work";
  if (score <= 64) return "Below par";
  if (score <= 74) return "Fair";
  if (score <= 84) return "Decent";
  if (score <= 92) return "Strong";
  return "Exceptional";
}

function estimateImprovementPotential(overall, photoInfo, trustInfo, amenityInfo) {
  let potential = 0;

  if (photoInfo.score < 12) potential += 7;
  else if (photoInfo.score < 16) potential += 4;

  if (trustInfo.score < 10) potential += 6;
  else if (trustInfo.score < 14) potential += 3;

  if (amenityInfo.score < 12) potential += 4;
  else if (amenityInfo.score < 16) potential += 2;

  if (overall < 65) potential += 3;

  return clamp(potential, 3, 20);
}

function buildPriorities(photoInfo, trustInfo, amenityInfo, titleInfo, descriptionInfo, marketInfo) {
  const priorities = [];

  if (photoInfo.score < 12) {
    priorities.push("Expand the photo set and improve room-by-room coverage.");
  }

  if (trustInfo.score < 10) {
    priorities.push("Strengthen trust signals through review depth, rating quality and reassurance details.");
  }

  if (amenityInfo.score < 12) {
    priorities.push("Close practical amenity gaps that affect everyday guest confidence.");
  }

  if (titleInfo.score <= 5) {
    priorities.push("Rewrite the title so it is clearer, less generic and more value-led.");
  }

  if (descriptionInfo.score <= 5) {
    priorities.push("Tighten the description opening so the main reasons to book are obvious earlier.");
  }

  if (marketInfo.score <= 3) {
    priorities.push("Sharpen guest fit and practical positioning so the listing stands out more clearly.");
  }

  return priorities.slice(0, 4);
}

function extractPhotos(merged) {
  const arrays = [
    merged?.photos,
    merged?.images,
    merged?.picture_urls,
    merged?.roomAndPropertyType?.photos,
    merged?.listing_photos,
    merged?.media,
    merged?.photoTour,
  ].filter(Array.isArray);

  const rawPhotos = arrays.flat();

  return rawPhotos
    .map((item) => {
      if (typeof item === "string") {
        return { url: item };
      }

      return {
        url: firstString([item?.url, item?.picture, item?.image_url, item?.src, item?.large]),
        caption: firstString([item?.caption, item?.title, item?.alt, item?.description]),
        alt: firstString([item?.alt]),
        title: firstString([item?.title]),
      };
    })
    .filter((p) => !!p.url);
}

function extractAmenities(merged) {
  const arrays = [
    merged?.amenities,
    merged?.listing_amenities,
    merged?.amenity_groups,
    merged?.amenityGroups?.flatMap((g) => g?.items || []),
    merged?.amenities_list,
    merged?.homeAmenities,
  ].filter(Boolean);

  const flat = arrays.flatMap((entry) => {
    if (Array.isArray(entry)) return entry;
    return [];
  });

  return flat.map((a) => {
    if (typeof a === "string") return a;
    return a?.title || a?.name || a?.label || "";
  }).filter(Boolean);
}

function extractRating(merged) {
  const candidates = [
    merged?.rating,
    merged?.star_rating,
    merged?.avg_rating,
    merged?.average_rating,
    merged?.review_score,
    merged?.reviews?.rating,
    merged?.reviews?.average_rating,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (!Number.isNaN(n) && n > 0) return n;
  }

  return null;
}

function extractReviewsCount(merged) {
  const candidates = [
    merged?.reviews_count,
    merged?.number_of_reviews,
    merged?.reviewsCount,
    merged?.reviews?.count,
    merged?.review_count,
    merged?.visible_review_count,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (!Number.isNaN(n) && n >= 0) return n;
  }

  return 0;
}

function extractBoolean(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key] ?? nested(obj, key);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const v = value.toLowerCase().trim();
      if (v === "true") return true;
      if (v === "false") return false;
    }
  }
  return false;
}

function nested(obj, dotted) {
  if (!obj || !dotted.includes(".")) return undefined;
  return dotted.split(".").reduce((acc, part) => acc?.[part], obj);
}

function mergeObjects(objs) {
  return objs.reduce((acc, obj) => deepMerge(acc, obj), {});
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source ?? target;
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = out[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      out[key] = deepMerge(tgtVal, srcVal);
    } else {
      out[key] = srcVal;
    }
  }
  return out;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function splitWords(text) {
  return normaliseText(text).split(/\s+/).filter(Boolean);
}

function normaliseText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(text, phrases) {
  let count = 0;
  for (const phrase of phrases) {
    const regex = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "g");
    const matches = text.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function hasAmenity(amenitySet, candidates) {
  for (const amenity of amenitySet) {
    for (const candidate of candidates) {
      const c = normaliseText(candidate);
      if (amenity.includes(c)) return true;
    }
  }
  return false;
}

function detectRepetition(photos) {
  const keys = photos
    .map((p) => {
      const combined = normaliseText([p.url, p.caption, p.alt, p.title].filter(Boolean).join(" "));
      return combined
        .replace(/\d+/g, "")
        .replace(/\b(jpg|jpeg|png|webp|image|photo)\b/g, "")
        .trim();
    })
    .filter(Boolean);

  if (keys.length < 8) return false;

  const freq = new Map();
  for (const key of keys) {
    const shortKey = key.slice(0, 80);
    freq.set(shortKey, (freq.get(shortKey) || 0) + 1);
  }

  const repeatedBuckets = [...freq.values()].filter((n) => n >= 3).length;
  return repeatedBuckets >= 2;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function truncate(text, max) {
  return String(text || "").slice(0, max);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
