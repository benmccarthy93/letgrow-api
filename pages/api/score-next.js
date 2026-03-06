// /pages/api/score-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SCORING_VERSION = "v2";

// -----------------------------
// Universal scoring rules
// -----------------------------

const TITLE_RULES = {
  idealMinLength: 20,
  idealMaxLength: 50,
  softMaxLength: 65,
  hardMaxLength: 80,
  fillerWords: [
    "cosy",
    "cozy",
    "lovely",
    "beautiful",
    "stunning",
    "amazing",
    "nice",
    "great",
    "spacious",
    "charming",
    "perfect",
  ],
  propertyTypes: [
    "apartment",
    "flat",
    "studio",
    "house",
    "home",
    "cottage",
    "cabin",
    "lodge",
    "barn",
    "annexe",
    "bungalow",
    "villa",
    "townhouse",
    "chalet",
    "hut",
    "shepherd",
    "glamping",
    "yurt",
    "boat",
    "loft",
  ],
  differentiators: [
    "free parking",
    "parking",
    "driveway",
    "garage",
    "ev charger",
    "charger",
    "sea view",
    "seaview",
    "waterfront",
    "beachfront",
    "river view",
    "lake view",
    "harbour view",
    "marina",
    "hot tub",
    "sauna",
    "pool",
    "fireplace",
    "log burner",
    "wood burner",
    "games room",
    "cinema room",
    "terrace",
    "balcony",
    "garden",
    "workspace",
    "self check-in",
    "self check in",
    "pet friendly",
    "dog friendly",
    "family friendly",
    "secure",
    "gated",
    "firepit",
    "fire pit",
  ],
  guestFit: [
    "family",
    "families",
    "couple",
    "couples",
    "group",
    "groups",
    "business",
    "remote work",
    "work trip",
    "sleeps",
    "guests",
  ],
  locationContext: [
    "near station",
    "walk to",
    "mins to",
    "minutes to",
    "town centre",
    "town center",
    "city centre",
    "city center",
    "beach",
    "harbour",
    "marina",
    "national park",
    "trail",
    "airport",
    "hospital",
    "university",
    "station",
  ],
};

const DESCRIPTION_RULES = {
  headingTokens: [
    "the space",
    "sleeping",
    "location",
    "getting around",
    "parking",
    "check-in",
    "check in",
    "perfect for",
    "highlights",
    "good for",
    "nearby",
    "walk to",
    "enjoy",
  ],
  guestFit: [
    "families",
    "family",
    "couples",
    "business",
    "groups",
    "remote work",
    "long stay",
    "long term",
    "perfect for",
    "good for",
  ],
  practicalBenefitTokens: [
    "free parking",
    "parking",
    "self check-in",
    "self check in",
    "lockbox",
    "smart lock",
    "keypad",
    "wifi",
    "wi-fi",
    "fast wifi",
    "workspace",
    "dedicated workspace",
    "heating",
    "air conditioning",
    "washer",
    "dryer",
  ],
  realismTokens: [
    "no lift",
    "no elevator",
    "stairs",
    "steep stairs",
    "low ceilings",
    "narrow staircase",
    "noise",
    "spotty signal",
    "limited mobile",
    "shared entrance",
    "compact bathroom",
    "road noise",
  ],
  experienceTokens: [
    "unwind",
    "relax",
    "soak",
    "stargaze",
    "sunset",
    "cook",
    "explore",
    "walk",
    "hike",
    "surf",
    "ski",
    "work trip",
    "family break",
  ],
  distanceRegexes: [
    /\b\d{1,2}\s?(min|mins|minutes)\s?(walk|drive)\b/i,
    /\b\d{1,2}\s?(mile|miles|km)\s?(to|from|away)\b/i,
    /\b(short walk|short drive|steps from|walk to|close to|near)\b/i,
  ],
};

const PHOTO_RULES = {
  strongCount: 16,
  goodCount: 12,
  fairCount: 8,
  weakCount: 5,
};

const AMENITY_RULES = {
  core: [
    { key: "wifi", patterns: ["wifi", "wi-fi", "wireless internet"], points: 3 },
    { key: "kitchen", patterns: ["kitchen"], points: 3 },
    { key: "heating", patterns: ["heating"], points: 2 },
    {
      key: "parking",
      patterns: ["free parking on premises", "free parking", "parking", "driveway", "garage"],
      points: 2,
    },
    {
      key: "washer_dryer",
      patterns: ["washing machine", "washer", "tumble dryer", "dryer"],
      points: 1,
    },
    {
      key: "self_check_in",
      patterns: ["self check-in", "self check in", "lockbox", "smart lock", "keypad"],
      points: 1,
    },
  ],
  segmentBoosters: [
    { key: "workspace", patterns: ["dedicated workspace", "workspace", "desk"], points: 1 },
    { key: "family", patterns: ["high chair", "travel cot", "cot", "crib", "stair gate"], points: 1 },
    { key: "pet", patterns: ["pet friendly", "pets allowed", "dog friendly"], points: 1 },
    { key: "accessibility", patterns: ["step-free", "step free", "elevator", "lift", "accessible"], points: 1 },
    {
      key: "long_stay",
      patterns: ["long term stays allowed", "long-term stays allowed"],
      points: 1,
    },
  ],
  premium: [
    { key: "hot_tub", patterns: ["hot tub"], points: 2 },
    { key: "pool", patterns: ["pool"], points: 2 },
    { key: "fireplace", patterns: ["fireplace", "log burner", "wood burner"], points: 1 },
  ],
  smallBonus: [{ key: "ev", patterns: ["ev charger", "charger"], points: 0.5 }],
  consistencyChecks: [
    { key: "wifi", patterns: ["wifi", "wi-fi", "fast wifi"] },
    { key: "parking", patterns: ["parking", "driveway", "garage"] },
    { key: "workspace", patterns: ["workspace", "desk", "remote work"] },
    { key: "family", patterns: ["high chair", "travel cot", "crib", "family"] },
    { key: "pets", patterns: ["pet friendly", "dog friendly"] },
  ],
};

const TRUST_RULES = {
  ratingBands: [
    { min: 4.9, points: 10 },
    { min: 4.8, points: 8 },
    { min: 4.7, points: 5 },
    { min: 4.5, points: 2 },
  ],
  reviewBands: [
    { min: 100, points: 4 },
    { min: 50, points: 3 },
    { min: 10, points: 2 },
    { min: 1, points: 1 },
  ],
  superhostPoints: 3,
  verifiedPoints: 1,
  safetyPoints: {
    smokeAlarm: 1,
    carbonMonoxide: 1,
  },
};

const POSITIONING_RULES = {
  titleDifferentiatorPoints: 2,
  first200ValuePoints: 2,
  guestFitPoints: 2,
  amenityConsistencyPoints: 2,
  workReadinessPoints: 2,
};

// -----------------------------
// Helpers
// -----------------------------

function getInputValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLowerText(value) {
  return stripHtml(value).toLowerCase();
}

function countMatches(text, patterns) {
  const lower = String(text || "").toLowerCase();
  return patterns.filter((pattern) => lower.includes(pattern)).length;
}

function containsAny(text, patterns) {
  const lower = String(text || "").toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function countRegexMatches(text, regexes) {
  const source = String(text || "");
  return regexes.filter((regex) => regex.test(source)).length;
}

function countEmojis(text) {
  const matches = String(text || "").match(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu
  );
  return matches ? matches.length : 0;
}

function capsRatio(text) {
  const letters = String(text || "").replace(/[^a-zA-Z]/g, "");
  if (!letters.length) return 0;
  const uppercase = letters.replace(/[^A-Z]/g, "").length;
  return uppercase / letters.length;
}

function normaliseAmenityTitles(amenities) {
  return (amenities || [])
    .filter((item) => item && item.available)
    .map((item) => String(item.title || "").toLowerCase());
}

function hasAmenity(amenityTitles, patterns) {
  return patterns.some((pattern) =>
    amenityTitles.some((title) => title.includes(pattern))
  );
}

function getSafetyFlags(property) {
  const safetyItems = [
    ...(property?.safetyAndPropertyInfo || []),
    ...(property?.amenities || []).filter((item) => item && item.available),
  ];

  const lowerTexts = safetyItems.map((item) =>
    `${String(item?.title || "")} ${String(item?.description || "")}`.toLowerCase()
  );

  return {
    smokeAlarm: lowerTexts.some((text) => text.includes("smoke alarm")),
    carbonMonoxide: lowerTexts.some(
      (text) =>
        text.includes("carbon monoxide") ||
        text.includes("co alarm")
    ),
  };
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

// -----------------------------
// Scoring
// -----------------------------

function scoreTitle(title) {
  const cleanTitle = String(title || "").trim();
  const lower = cleanTitle.toLowerCase();

  if (!cleanTitle) return 0;

  let score = 0;
  const titleLength = cleanTitle.length;
  const emojiCount = countEmojis(cleanTitle);
  const uppercaseRatio = capsRatio(cleanTitle);

  // Length
  if (
    titleLength >= TITLE_RULES.idealMinLength &&
    titleLength <= TITLE_RULES.idealMaxLength
  ) {
    score += 4;
  } else if (titleLength <= TITLE_RULES.softMaxLength && titleLength >= 15) {
    score += 2;
  } else if (titleLength <= TITLE_RULES.hardMaxLength && titleLength >= 10) {
    score += 1;
  }

  // Readability
  if (uppercaseRatio < 0.6) score += 2;
  if (emojiCount === 0 && !/[!*#]{2,}/.test(cleanTitle)) score += 2;

  // Information density
  if (countMatches(lower, TITLE_RULES.propertyTypes) > 0) score += 2;
  if (countMatches(lower, TITLE_RULES.differentiators) > 0) score += 3;
  if (countMatches(lower, TITLE_RULES.guestFit) > 0) score += 1;
  if (countMatches(lower, TITLE_RULES.locationContext) > 0) score += 1;

  // Penalties
  const fillerCount = countMatches(lower, TITLE_RULES.fillerWords);
  const usefulCount =
    countMatches(lower, TITLE_RULES.differentiators) +
    countMatches(lower, TITLE_RULES.propertyTypes) +
    countMatches(lower, TITLE_RULES.guestFit);

  if (fillerCount >= 2 && usefulCount === 0) score -= 2;
  if (emojiCount > 2) score -= 1;

  return Math.max(0, Math.min(score, 15));
}

function scoreDescription(description) {
  const raw = String(description || "");
  const clean = stripHtml(raw);
  const lower = clean.toLowerCase();

  if (!clean) return 0;

  let score = 0;
  const descLength = clean.length;
  const lineBreakCount = (String(description || "").match(/<br\s*\/?>/gi) || []).length;
  const bulletCount = (clean.match(/[•*-]/g) || []).length;

  // Structure
  const hasHeadings = countMatches(lower, DESCRIPTION_RULES.headingTokens) > 0;
  if (lineBreakCount >= 2 || bulletCount >= 2) score += 3;
  if (hasHeadings) score += 2;
  if (descLength >= 180 && descLength <= 2200) score += 1;

  // Practical specifics
  const distanceMatches = countRegexMatches(clean, DESCRIPTION_RULES.distanceRegexes);
  if (distanceMatches >= 1) score += 2;
  if (countMatches(lower, DESCRIPTION_RULES.practicalBenefitTokens) >= 2) score += 2;
  if (
    containsAny(lower, ["parking", "check-in", "check in", "transport", "station", "beach"])
  ) {
    score += 1;
  }

  // Unique feature / story
  if (countMatches(lower, TITLE_RULES.differentiators) >= 1) score += 2;
  if (countMatches(lower, DESCRIPTION_RULES.experienceTokens) >= 1) score += 1;

  // Realism
  if (countMatches(lower, DESCRIPTION_RULES.realismTokens) >= 1) score += 1;

  // Cap poor short descriptions
  if (descLength < 180) {
    score = Math.min(score, 7);
  }

  // Slight penalty for a wall of text
  if (descLength > 2500) {
    score -= 1;
  }

  return Math.max(0, Math.min(score, 15));
}

function scorePhotos(property) {
  const photoCount = Array.isArray(property?.photos) ? property.photos.length : 0;
  const bedrooms = safeNumber(property?.bedrooms);
  const bathrooms = safeNumber(property?.bathrooms);

  let score = 0;

  if (photoCount >= 25) score += 14;
  else if (photoCount >= 16) score += 14;
  else if (photoCount >= 12) score += 12;
  else if (photoCount >= 8) score += 9;
  else if (photoCount >= 5) score += 6;
  else if (photoCount >= 1) score += 3;
  else score += 0;

  const expectedMinPhotos = 8 + bedrooms * 2 + bathrooms;
  if (photoCount >= expectedMinPhotos) score += 4;
  else if (photoCount >= Math.max(0, expectedMinPhotos - 3)) score += 2;

  const titleAndDesc = `${property?.title || ""} ${stripHtml(property?.description || "")}`.toLowerCase();
  const hasVisualDifferentiator =
    countMatches(titleAndDesc, [
      "hot tub",
      "sea view",
      "seaview",
      "waterfront",
      "beachfront",
      "garden",
      "balcony",
      "terrace",
      "parking",
      "fireplace",
      "log burner",
    ]) > 0;

  if (hasVisualDifferentiator && photoCount >= 16) score += 2;

  return {
    score: Math.max(0, Math.min(score, 20)),
    photoCount,
    expectedMinPhotos,
    photoCoverageRatio: expectedMinPhotos > 0 ? photoCount / expectedMinPhotos : 0,
  };
}

function scoreAmenities(property) {
  const amenityTitles = normaliseAmenityTitles(property?.amenities || []);
  const descriptionLower = toLowerText(property?.description || "");

  let score = 0;
  const coreFlags = {};
  const mismatchFlags = [];

  for (const item of AMENITY_RULES.core) {
    const present = hasAmenity(amenityTitles, item.patterns);
    coreFlags[item.key] = present;
    if (present) score += item.points;
  }

  for (const item of AMENITY_RULES.segmentBoosters) {
    if (hasAmenity(amenityTitles, item.patterns)) {
      score += item.points;
    }
  }

  let premiumPoints = 0;
  for (const item of AMENITY_RULES.premium) {
    if (hasAmenity(amenityTitles, item.patterns)) {
      premiumPoints += item.points;
    }
  }
  score += Math.min(premiumPoints, 3);

  for (const item of AMENITY_RULES.smallBonus) {
    if (hasAmenity(amenityTitles, item.patterns)) {
      score += item.points;
    }
  }

  for (const check of AMENITY_RULES.consistencyChecks) {
    const mentionedInDescription = check.patterns.some((pattern) =>
      descriptionLower.includes(pattern)
    );
    const presentInAmenities = hasAmenity(amenityTitles, check.patterns);

    if (mentionedInDescription && !presentInAmenities) {
      mismatchFlags.push(check.key);
      score -= 1;
    }
  }

  return {
    score: Math.max(0, Math.min(score, 20)),
    amenityTitles,
    coreFlags,
    mismatchFlags,
  };
}

function scoreTrust(property) {
  const rating = safeNumber(property?.rating);
  const reviewCount = safeNumber(property?.reviews);
  const host = property?.host || {};
  const safetyFlags = getSafetyFlags(property);

  let score = 0;

  for (const band of TRUST_RULES.ratingBands) {
    if (rating >= band.min) {
      score += band.points;
      break;
    }
  }

  for (const band of TRUST_RULES.reviewBands) {
    if (reviewCount >= band.min) {
      score += band.points;
      break;
    }
  }

  if (host.isSuperhost) score += TRUST_RULES.superhostPoints;
  if (host.isVerified) score += TRUST_RULES.verifiedPoints;
  if (safetyFlags.smokeAlarm) score += TRUST_RULES.safetyPoints.smokeAlarm;
  if (safetyFlags.carbonMonoxide) score += TRUST_RULES.safetyPoints.carbonMonoxide;

  return {
    score: Math.max(0, Math.min(score, 20)),
    safetyFlags,
  };
}

function scoreCompetitivePositioning(property, amenityData) {
  const title = String(property?.title || "");
  const titleLower = title.toLowerCase();
  const descriptionRaw = String(property?.description || "");
  const descriptionClean = stripHtml(descriptionRaw);
  const descriptionLower = descriptionClean.toLowerCase();
  const first200 = descriptionClean.slice(0, 200).toLowerCase();

  let score = 0;
  const subScores = {
    titleDifferentiator: 0,
    first200Value: 0,
    guestFitClarity: 0,
    amenityConsistency: 0,
    workReadiness: 0,
  };

  // 1) Differentiator surfaced in title
  if (countMatches(titleLower, TITLE_RULES.differentiators) >= 1) {
    subScores.titleDifferentiator = POSITIONING_RULES.titleDifferentiatorPoints;
    score += subScores.titleDifferentiator;
  }

  // 2) Value surfaced early in first 200 chars
  const first200HasDifferentiator =
    countMatches(first200, TITLE_RULES.differentiators) >= 1;
  const first200HasDistance =
    countRegexMatches(first200, DESCRIPTION_RULES.distanceRegexes) >= 1;
  if (first200HasDifferentiator || first200HasDistance) {
    subScores.first200Value = POSITIONING_RULES.first200ValuePoints;
    score += subScores.first200Value;
  }

  // 3) Guest fit clarity
  if (
    countMatches(descriptionLower, DESCRIPTION_RULES.guestFit) >= 1 ||
    containsAny(descriptionLower, ["perfect for", "ideal for", "great for"])
  ) {
    subScores.guestFitClarity = POSITIONING_RULES.guestFitPoints;
    score += subScores.guestFitClarity;
  }

  // 4) Amenity consistency
  const mismatchCount = amenityData?.mismatchFlags?.length || 0;
  if (mismatchCount === 0) {
    subScores.amenityConsistency = POSITIONING_RULES.amenityConsistencyPoints;
  } else if (mismatchCount === 1) {
    subScores.amenityConsistency = 1;
  }
  score += subScores.amenityConsistency;

  // 5) Work / connection readiness
  const hasWorkspace = hasAmenity(amenityData.amenityTitles, ["workspace", "desk"]);
  const mentionsFastWifi =
    containsAny(descriptionLower, ["fast wifi", "wifi", "wi-fi"]) ||
    hasAmenity(amenityData.amenityTitles, ["wifi", "wi-fi"]);
  if (hasWorkspace || mentionsFastWifi) {
    subScores.workReadiness = POSITIONING_RULES.workReadinessPoints;
    score += subScores.workReadiness;
  }

  return {
    score: Math.max(0, Math.min(score, 10)),
    subScores,
  };
}

function getOverallLabel(overallScore) {
  if (overallScore >= 85) return "Strong";
  if (overallScore >= 65) return "Good";
  return "Needs work";
}

// -----------------------------
// Free-plan messages
// -----------------------------

function buildCategoryMessages({
  titleScore,
  descriptionScore,
  photoScore,
  amenityScore,
  trustScore,
  marketScore,
  property,
  detectedPhotoCount,
  detectedReviewCount,
  detectedRating,
}) {
  const messages = [];

  if (titleScore <= 7) {
    messages.push({
      category: "Title Strength",
      message:
        "Your title may not be surfacing the property’s most useful details clearly enough. Stronger listings usually make their type, differentiator, or guest fit easier to understand in search.",
    });
  } else {
    messages.push({
      category: "Title Strength",
      message:
        "Your title shows some useful detail, though there may still be room to sharpen what makes the listing stand out in search results.",
    });
  }

  if (descriptionScore <= 7) {
    messages.push({
      category: "Description Strength",
      message:
        "Your description may not be helping guests scan the property’s main benefits quickly enough. Stronger listings usually combine clearer structure, practical specifics and a more obvious stay angle.",
    });
  } else {
    messages.push({
      category: "Description Strength",
      message:
        "Your description provides helpful context, though there may still be room to make the stay experience and practical value clearer at a glance.",
    });
  }

  if (photoScore <= 9) {
    messages.push({
      category: "Photo Strength",
      message:
        "Your photo set may be limiting first impressions. Listings with better photo coverage usually build confidence faster before guests read the full listing.",
    });
  } else {
    messages.push({
      category: "Photo Strength",
      message:
        "Your photo count looks fairly solid, though stronger-performing listings often use broader room coverage and clearer visual merchandising.",
    });
  }

  if (amenityScore <= 9) {
    messages.push({
      category: "Amenities & Guest Appeal",
      message:
        "Your amenity mix may be missing some of the practical or high-value features guests use to compare similar stays. Expected basics matter less than clearly useful benefits.",
    });
  } else {
    messages.push({
      category: "Amenities & Guest Appeal",
      message:
        "Your listing covers a good range of useful amenities, though there may still be room to present more commercially valuable guest benefits.",
    });
  }

  if (trustScore <= 9) {
    messages.push({
      category: "Trust Signals",
      message:
        "Your trust signals look weaker than those of more established listings. Rating strength, review depth, host credibility and safety visibility can all affect booking confidence.",
    });
  } else {
    messages.push({
      category: "Trust Signals",
      message:
        "Your trust signals look reasonably healthy, though there may still be a gap versus stronger listings with deeper review momentum and sharper guest confidence markers.",
    });
  }

  if (marketScore <= 4) {
    messages.push({
      category: "Competitive Positioning",
      message:
        "Your listing may not be communicating its value as clearly as it could. Stronger listings usually surface their strongest angle early and keep that message consistent across the page.",
    });
  } else {
    messages.push({
      category: "Competitive Positioning",
      message:
        "Your listing shows some helpful positioning signals, though there may still be room to make the guest fit and strongest selling points more obvious.",
    });
  }

  return {
    detected_signals: {
      photos_detected: detectedPhotoCount,
      reviews_detected: detectedReviewCount,
      rating_detected: detectedRating,
      title_detected: property?.title || "",
    },
    category_messages: messages,
  };
}

// -----------------------------
// Handler
// -----------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase env vars" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = req.query || {};

    const jobId = getInputValue(body.job_id) || getInputValue(query.job_id) || null;
    const submissionId =
      getInputValue(body.submission_id) || getInputValue(query.submission_id) || null;

    if (!jobId && !submissionId) {
      return res.status(400).json({
        error: "job_id or submission_id is required",
      });
    }

    let submissionQuery = supabase.from("listing_submissions").select("*");

    if (submissionId) {
      submissionQuery = submissionQuery.eq("id", submissionId);
    } else {
      submissionQuery = submissionQuery.eq("job_id", jobId);
    }

    const { data: submission, error: submissionError } =
      await submissionQuery.maybeSingle();

    if (submissionError) {
      console.error("Submission lookup error:", submissionError);
      return res.status(500).json({ error: "Failed to fetch submission" });
    }

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status !== "fetched") {
      return res.status(409).json({
        error: "Submission is not ready for scoring",
        current_status: submission.status,
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const { data: fetchRow, error: fetchError } = await supabase
      .from("listing_fetches")
      .select("*")
      .eq("submission_id", submission.id)
      .eq("fetch_status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("Fetch row lookup error:", fetchError);
      return res.status(500).json({ error: "Failed to fetch listing data" });
    }

    if (!fetchRow || !fetchRow.raw_response || !fetchRow.raw_response.property) {
      return res.status(400).json({
        error: "No successful fetch data found for submission",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const property = fetchRow.raw_response.property;

    const titleScore = scoreTitle(property.title);
    const descriptionScore = scoreDescription(property.description);

    const photoData = scorePhotos(property);
    const amenityData = scoreAmenities(property);
    const trustData = scoreTrust(property);
    const positioningData = scoreCompetitivePositioning(property, amenityData);

    const photoScore = photoData.score;
    const amenityScore = amenityData.score;
    const trustScore = trustData.score;
    const marketScore = positioningData.score;

    const detectedPhotoCount = photoData.photoCount;
    const detectedReviewCount = safeNumber(property.reviews);
    const detectedRating = safeNumber(property.rating);

    const overallScore =
      titleScore +
      descriptionScore +
      photoScore +
      amenityScore +
      trustScore +
      marketScore;

    const scoreLabel = getOverallLabel(overallScore);

    const summaryPayload = buildCategoryMessages({
      titleScore,
      descriptionScore,
      photoScore,
      amenityScore,
      trustScore,
      marketScore,
      property,
      detectedPhotoCount,
      detectedReviewCount,
      detectedRating,
    });

    const signalsPayload = {
      title: {
        length: String(property.title || "").trim().length,
        caps_ratio: capsRatio(property.title || ""),
        emoji_count: countEmojis(property.title || ""),
      },
      description: {
        length: stripHtml(property.description || "").length,
        line_breaks:
          (String(property.description || "").match(/<br\s*\/?>/gi) || []).length,
        has_distance_signal:
          countRegexMatches(stripHtml(property.description || ""), DESCRIPTION_RULES.distanceRegexes) > 0,
      },
      photos: {
        detected_count: photoData.photoCount,
        expected_min: photoData.expectedMinPhotos,
        coverage_ratio: photoData.photoCoverageRatio,
      },
      amenities: {
        core_flags: amenityData.coreFlags,
        mismatch_flags: amenityData.mismatchFlags,
      },
      trust: {
        safety_flags: trustData.safetyFlags,
      },
      positioning: {
        subscores: positioningData.subScores,
      },
    };

    const { error: scoreInsertError } = await supabase.from("listing_scores").insert([
      {
        submission_id: submission.id,
        scoring_version: SCORING_VERSION,
        overall_score: overallScore,
        score_label: scoreLabel,
        title_score: titleScore,
        description_score: descriptionScore,
        photo_score: photoScore,
        amenity_score: amenityScore,
        trust_score: trustScore,
        market_score: marketScore,
        summary: JSON.stringify({
          ...summaryPayload,
          signals: signalsPayload,
        }),
        top_fixes: {
          improvement_potential: Math.max(0, 100 - overallScore),
        },
        detected_photo_count: detectedPhotoCount,
        detected_review_count: detectedReviewCount,
        detected_rating: detectedRating,
        scored_at: new Date().toISOString(),
      },
    ]);

    if (scoreInsertError) {
      console.error("Score insert error:", scoreInsertError);
      return res.status(500).json({ error: "Failed to store score" });
    }

    const { error: submissionUpdateError } = await supabase
      .from("listing_submissions")
      .update({
        status: "complete",
        status_message: "Scoring complete",
      })
      .eq("id", submission.id);

    if (submissionUpdateError) {
      console.error("Submission update error:", submissionUpdateError);
      return res.status(500).json({
        error: "Score saved but failed to update submission status",
      });
    }

    return res.status(200).json({
      success: true,
      submission_id: submission.id,
      job_id: submission.job_id,
      overall_score: overallScore,
      score_label: scoreLabel,
      detected_signals: {
        photos: detectedPhotoCount,
        reviews: detectedReviewCount,
        rating: detectedRating,
      },
    });
  } catch (e) {
    console.error("Unhandled error in score-next:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
