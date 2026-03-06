// /pages/api/score-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SCORING_VERSION = "v3_strict";

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

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countMatches(text, phrases) {
  const lower = String(text || "").toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase)).length;
}

function containsAny(text, phrases) {
  const lower = String(text || "").toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase));
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
    .filter((item) => item && item.available !== false)
    .map((item) => String(item.title || item.name || "").toLowerCase())
    .filter(Boolean);
}

function hasAmenity(amenityTitles, patterns) {
  return patterns.some((pattern) =>
    amenityTitles.some((title) => title.includes(pattern))
  );
}

function getSafetyFlags(property) {
  const safetyItems = [
    ...(property?.safetyAndPropertyInfo || []),
    ...(property?.amenities || []).filter(Boolean),
  ];

  const lowerTexts = safetyItems.map((item) =>
    `${String(item?.title || "")} ${String(item?.description || "")}`.toLowerCase()
  );

  return {
    smokeAlarm: lowerTexts.some((text) => text.includes("smoke alarm")),
    carbonMonoxide: lowerTexts.some(
      (text) => text.includes("carbon monoxide") || text.includes("co alarm")
    ),
  };
}

function extractPropertyFromRaw(rawResponse) {
  if (!rawResponse) return null;

  if (rawResponse.property && typeof rawResponse.property === "object") {
    return rawResponse.property;
  }

  if (rawResponse.data?.property && typeof rawResponse.data.property === "object") {
    return rawResponse.data.property;
  }

  if (rawResponse.result?.property && typeof rawResponse.result.property === "object") {
    return rawResponse.result.property;
  }

  if (rawResponse.listing && typeof rawResponse.listing === "object") {
    return rawResponse.listing;
  }

  if (rawResponse.data?.listing && typeof rawResponse.data.listing === "object") {
    return rawResponse.data.listing;
  }

  return null;
}

function extractPhotoCount(property) {
  if (Array.isArray(property?.photos)) return property.photos.length;
  if (Array.isArray(property?.images)) return property.images.length;
  if (Array.isArray(property?.picture_urls)) return property.picture_urls.length;
  return 0;
}

function extractReviewCount(property) {
  const directCandidates = [
    property?.reviews,
    property?.reviewsCount,
    property?.review_count,
    property?.reviews_count,
    property?.number_of_reviews,
    property?.visible_review_count,
    property?.reviewStats?.count,
    property?.reviewStats?.totalCount,
    property?.reviews?.count,
    property?.reviews?.totalCount,
  ];

  const positive = directCandidates
    .map((value) => Number(value))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (positive.length > 0) {
    return Math.max(...positive);
  }

  const zeroish = directCandidates
    .map((value) => Number(value))
    .filter((n) => Number.isFinite(n) && n === 0);

  if (zeroish.length > 0) return 0;

  return 0;
}

function extractRating(property) {
  const directCandidates = [
    property?.rating,
    property?.star_rating,
    property?.avg_rating,
    property?.average_rating,
    property?.review_score,
    property?.reviews?.rating,
    property?.reviews?.average_rating,
  ];

  const valid = directCandidates
    .map((value) => Number(value))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 5);

  if (valid.length > 0) {
    return Math.max(...valid);
  }

  return 0;
}

function detectRoomSignals(property) {
  const textBlob = [
    ...(property?.photos || []).map((p) =>
      `${String(p?.caption || "")} ${String(p?.title || "")} ${String(p?.alt || "")}`
    ),
    stripHtml(property?.description || ""),
    property?.title || "",
  ]
    .join(" ")
    .toLowerCase();

  return {
    bedroomCoverage: /\bbedroom|bed\b/.test(textBlob),
    bathroomCoverage: /\bbathroom|bath|shower\b/.test(textBlob),
    kitchenCoverage: /\bkitchen|oven|hob|microwave|fridge\b/.test(textBlob),
    livingCoverage: /\bliving|lounge|sofa|tv room|sitting room\b/.test(textBlob),
    exteriorCoverage: /\bexterior|outside|building|entrance|entry|parking|drive|garden|terrace|balcony\b/.test(textBlob),
    practicalShots: /\bparking|entrance|entry|workspace|desk|washer|laundry|bathroom|kitchen\b/.test(textBlob),
  };
}

// -----------------------------
// Rules
// -----------------------------

const TITLE_RULES = {
  idealMinLength: 18,
  idealMaxLength: 55,
  fillerWords: [
    "cosy",
    "cozy",
    "lovely",
    "beautiful",
    "stunning",
    "amazing",
    "nice",
    "great",
    "perfect",
    "gorgeous",
    "stylish",
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
    "bungalow",
    "villa",
    "townhouse",
    "loft",
  ],
  differentiators: [
    "free parking",
    "parking",
    "garage",
    "ev charger",
    "hot tub",
    "sauna",
    "pool",
    "terrace",
    "balcony",
    "garden",
    "workspace",
    "self check-in",
    "self check in",
    "pet friendly",
    "dog friendly",
    "family friendly",
    "sea view",
    "waterfront",
    "beachfront",
    "fireplace",
    "views",
    "king bed",
    "xl bed",
  ],
  guestFit: [
    "family",
    "families",
    "couple",
    "couples",
    "business",
    "remote work",
    "work trip",
    "group",
    "groups",
    "contractor",
    "contractors",
  ],
};

const DESCRIPTION_RULES = {
  guestFit: [
    "families",
    "family",
    "couples",
    "business",
    "groups",
    "remote work",
    "long stay",
    "perfect for",
    "ideal for",
    "good for",
    "contractor",
    "contractors",
  ],
  practicalBenefitTokens: [
    "free parking",
    "parking",
    "self check-in",
    "self check in",
    "lockbox",
    "smart lock",
    "wifi",
    "wi-fi",
    "workspace",
    "heating",
    "air conditioning",
    "washer",
    "dryer",
    "kitchen",
    "balcony",
    "terrace",
    "garden",
    "views",
    "minutes",
    "walk",
  ],
  distanceRegexes: [
    /\b\d{1,2}\s?(min|mins|minutes)\s?(walk|drive)\b/i,
    /\b\d{1,2}\s?(mile|miles|km)\s?(to|from|away)\b/i,
    /\b(short walk|short drive|steps from|walk to|close to|near)\b/i,
  ],
};

const AMENITY_RULES = {
  practical: [
    { key: "wifi", patterns: ["wifi", "wi-fi"], points: 2 },
    { key: "kitchen", patterns: ["kitchen"], points: 2 },
    { key: "washer", patterns: ["washing machine", "washer"], points: 2 },
    { key: "tv", patterns: ["tv"], points: 2 },
    { key: "heating", patterns: ["heating"], points: 2 },
    { key: "self_check_in", patterns: ["self check-in", "self check in", "lockbox", "smart lock", "keypad"], points: 2 },
    { key: "workspace", patterns: ["workspace", "desk", "dedicated workspace"], points: 2 },
    { key: "parking", patterns: ["parking", "free parking", "driveway", "garage"], points: 2 },
  ],
  bonus: [
    { key: "dryer", patterns: ["dryer", "tumble dryer"], points: 1 },
    { key: "aircon", patterns: ["air conditioning", "ac"], points: 1 },
    { key: "dishwasher", patterns: ["dishwasher"], points: 1 },
    { key: "coffee", patterns: ["coffee machine", "coffee maker"], points: 1 },
    { key: "hot_tub", patterns: ["hot tub"], points: 1 },
    { key: "outside_space", patterns: ["balcony", "terrace", "garden", "patio"], points: 1 },
    { key: "lift", patterns: ["lift", "elevator"], points: 1 },
    { key: "ev", patterns: ["ev charger", "charger"], points: 0.5 },
  ],
};

// -----------------------------
// Stricter scoring
// -----------------------------

function scoreTitle(title) {
  const cleanTitle = String(title || "").trim();
  const lower = cleanTitle.toLowerCase();

  if (!cleanTitle) return 0;

  let score = 0;
  const titleLength = cleanTitle.length;
  const emojiCount = countEmojis(cleanTitle);
  const uppercaseRatio = capsRatio(cleanTitle);
  const fillerCount = countMatches(lower, TITLE_RULES.fillerWords);
  const propertyTypeCount = countMatches(lower, TITLE_RULES.propertyTypes);
  const differentiatorCount = countMatches(lower, TITLE_RULES.differentiators);
  const guestFitCount = countMatches(lower, TITLE_RULES.guestFit);

  const hasUsefulLength =
    titleLength >= TITLE_RULES.idealMinLength &&
    titleLength <= TITLE_RULES.idealMaxLength;

  const tooShort = titleLength > 0 && titleLength < 18;
  const tooLong = titleLength > 65;

  if (tooShort || tooLong || emojiCount >= 3 || fillerCount >= 3) {
    score = 1 + (propertyTypeCount > 0 ? 1 : 0) + (differentiatorCount > 0 ? 1 : 0);
  } else if (hasUsefulLength && propertyTypeCount > 0 && (differentiatorCount > 0 || guestFitCount > 0)) {
    score = 8 + (guestFitCount > 0 ? 1 : 0) + (emojiCount === 0 ? 1 : 0) + (fillerCount === 0 ? 1 : 0);
  } else if (hasUsefulLength || propertyTypeCount > 0) {
    score = 3 + (propertyTypeCount > 0 ? 1 : 0) + (differentiatorCount > 0 ? 1 : 0);
  } else {
    score = 3;
  }

  if (uppercaseRatio >= 0.6) score -= 1;
  if (emojiCount >= 2) score -= 2;
  if (fillerCount >= 2) score -= 1;

  return clamp(score, 0, 15);
}

function scoreDescription(description, amenityTitles) {
  const raw = String(description || "");
  const clean = stripHtml(raw);
  const lower = clean.toLowerCase();

  if (!clean) {
    return {
      score: 0,
      claimsWithoutSupport: 0,
    };
  }

  let score = 0;

  const descLength = clean.length;
  const lineBreakCount = (raw.match(/<br\s*\/?>/gi) || []).length;
  const bulletCount = (clean.match(/[•*-]/g) || []).length;
  const hasStructure = lineBreakCount >= 2 || bulletCount >= 2;
  const opening = clean.slice(0, 220).toLowerCase();
  const openingHasValue =
    countMatches(opening, DESCRIPTION_RULES.practicalBenefitTokens) >= 1 ||
    countRegexMatches(opening, DESCRIPTION_RULES.distanceRegexes) >= 1;

  const claims = [
    { mention: containsAny(lower, ["parking", "garage", "driveway"]), support: hasAmenity(amenityTitles, ["parking", "free parking", "garage", "driveway"]) },
    { mention: containsAny(lower, ["workspace", "desk", "remote work"]), support: hasAmenity(amenityTitles, ["workspace", "desk", "dedicated workspace", "wifi", "wi-fi"]) },
    { mention: containsAny(lower, ["self check-in", "self check in"]), support: hasAmenity(amenityTitles, ["self check-in", "self check in", "lockbox", "smart lock", "keypad"]) },
    { mention: containsAny(lower, ["washer", "washing machine", "laundry"]), support: hasAmenity(amenityTitles, ["washer", "washing machine", "dryer", "tumble dryer"]) },
    { mention: containsAny(lower, ["kitchen"]), support: hasAmenity(amenityTitles, ["kitchen"]) },
    { mention: containsAny(lower, ["air conditioning", "ac"]), support: hasAmenity(amenityTitles, ["air conditioning", "ac"]) },
  ];

  const claimsWithoutSupport = claims.filter((c) => c.mention && !c.support).length;
  const specificity =
    countMatches(lower, DESCRIPTION_RULES.practicalBenefitTokens) +
    countMatches(lower, DESCRIPTION_RULES.guestFit) +
    countRegexMatches(clean, DESCRIPTION_RULES.distanceRegexes);

  if (descLength < 120) {
    score = 1 + Math.min(specificity, 1);
  } else if (descLength < 250 || !openingHasValue) {
    score = 3 + Math.min(specificity, 2) + (hasStructure ? 1 : 0);
  } else {
    score = 6 + Math.min(specificity, 4) + (openingHasValue ? 1 : 0) + (hasStructure ? 1 : 0);
  }

  if (descLength > 1200) score -= 1;
  if (claimsWithoutSupport >= 3) score -= 2;
  else if (claimsWithoutSupport >= 1) score -= 1;

  return {
    score: clamp(score, 0, 15),
    claimsWithoutSupport,
  };
}

function scorePhotos(property) {
  const photoCount = extractPhotoCount(property);
  const roomSignals = detectRoomSignals(property);

  let score = 0;

  if (photoCount <= 4) score = 0;
  else if (photoCount <= 7) score = 1;
  else if (photoCount <= 11) score = 3;
  else if (photoCount <= 15) score = 5;
  else if (photoCount <= 19) score = 10;
  else if (photoCount <= 24) score = 17;
  else if (photoCount <= 35) score = 20;
  else if (photoCount <= 43) score = 19;
  else if (photoCount <= 50) score = 18;
  else if (photoCount <= 60) score = 16;
  else score = 14;

  if (roomSignals.bedroomCoverage) score += 1;
  if (roomSignals.bathroomCoverage) score += 1;
  if (roomSignals.kitchenCoverage) score += 1;
  if (roomSignals.livingCoverage) score += 1;
  if (roomSignals.exteriorCoverage) score += 1;

  const roomCoverageCount = [
    roomSignals.bedroomCoverage,
    roomSignals.bathroomCoverage,
    roomSignals.kitchenCoverage,
    roomSignals.livingCoverage,
    roomSignals.exteriorCoverage,
  ].filter(Boolean).length;

  if (photoCount < 20) score -= 2;
  if (roomCoverageCount <= 2) score -= 2;
  if (roomCoverageCount <= 3) score -= 2;
  if (!roomSignals.practicalShots) score -= 1;
  if (photoCount >= 44) score -= 2;

  if (photoCount <= 15) score = Math.min(score, 12);
  if (photoCount <= 11) score = Math.min(score, 8);

  return {
    score: clamp(score, 0, 20),
    photoCount,
    roomSignals,
  };
}

function scoreAmenities(property) {
  const amenityTitles = normaliseAmenityTitles(property?.amenities || []);
  const descriptionLower = toLowerText(property?.description || "");

  let score = 0;
  let practicalHits = 0;
  let practicalMissingCount = 0;
  const mismatchFlags = [];

  for (const rule of AMENITY_RULES.practical) {
    const present = hasAmenity(amenityTitles, rule.patterns);
    if (present) {
      score += rule.points;
      practicalHits += 1;
    } else {
      practicalMissingCount += 1;
    }
  }

  let bonusPoints = 0;
  for (const rule of AMENITY_RULES.bonus) {
    if (hasAmenity(amenityTitles, rule.patterns)) {
      bonusPoints += rule.points;
    }
  }
  score += Math.min(bonusPoints, 4);

  const consistencyChecks = [
    { key: "wifi", patterns: ["wifi", "wi-fi"] },
    { key: "parking", patterns: ["parking", "garage", "driveway"] },
    { key: "workspace", patterns: ["workspace", "desk", "remote work"] },
    { key: "family", patterns: ["family", "high chair", "travel cot", "crib"] },
    { key: "pets", patterns: ["pet friendly", "dog friendly"] },
  ];

  for (const check of consistencyChecks) {
    const mentionedInDescription = check.patterns.some((pattern) =>
      descriptionLower.includes(pattern)
    );
    const presentInAmenities = hasAmenity(amenityTitles, check.patterns);

    if (mentionedInDescription && !presentInAmenities) {
      mismatchFlags.push(check.key);
      score -= 1;
    }
  }

  if (containsAny(descriptionLower, ["family", "business", "remote work", "contractor", "long stay"])) {
    score += 1;
  }

  return {
    score: clamp(score, 0, 20),
    amenityTitles,
    practicalHits,
    practicalMissingCount,
    mismatchFlags,
  };
}

function scoreTrust(property, amenityTitles) {
  const rating = extractRating(property);
  const reviewCount = extractReviewCount(property);
  const host = property?.host || {};
  const safetyFlags = getSafetyFlags(property);

  let reviewVolumeScore = 0;
  if (reviewCount === 0) reviewVolumeScore = 0;
  else if (reviewCount <= 2) reviewVolumeScore = 0;
  else if (reviewCount <= 4) reviewVolumeScore = 1;
  else if (reviewCount <= 9) reviewVolumeScore = 2;
  else if (reviewCount <= 19) reviewVolumeScore = 4;
  else if (reviewCount <= 39) reviewVolumeScore = 5;
  else if (reviewCount <= 79) reviewVolumeScore = 6;
  else if (reviewCount <= 119) reviewVolumeScore = 7;
  else reviewVolumeScore = 8;

  let ratingScore = 0;
  if (rating > 0 && rating < 4.5) ratingScore = 0;
  else if (rating >= 4.5 && rating <= 4.69) ratingScore = 1;
  else if (rating >= 4.7 && rating <= 4.79) ratingScore = 3;
  else if (rating >= 4.8 && rating <= 4.86) ratingScore = 4;
  else if (rating >= 4.87 && rating <= 4.93) ratingScore = 5;
  else if (rating >= 4.94) ratingScore = 6;

  let hostScore = 0;
  if (host.isSuperhost) hostScore += 2;
  if (host.isVerified) hostScore += 1;

  let safetyScore = 0;
  if (safetyFlags.smokeAlarm) safetyScore += 1;
  if (safetyFlags.carbonMonoxide) safetyScore += 1;
  if (hasAmenity(amenityTitles, ["first aid kit", "fire extinguisher"])) safetyScore += 1;
  if (hasAmenity(amenityTitles, ["self check-in", "self check in", "lockbox", "smart lock", "keypad"])) safetyScore += 1;
  if (hasAmenity(amenityTitles, ["security camera", "security cameras", "building staff", "gated"])) safetyScore += 1;

  return {
    score: clamp(reviewVolumeScore + ratingScore + hostScore + safetyScore, 0, 20),
    rating,
    reviewCount,
    safetyFlags,
    reviewVolumeScore,
    ratingScore,
    hostScore,
    safetyScore,
  };
}

function scoreCompetitivePositioning(property, amenityData, photoData) {
  const titleLower = String(property?.title || "").toLowerCase();
  const descriptionClean = stripHtml(property?.description || "");
  const descriptionLower = descriptionClean.toLowerCase();
  const first200 = descriptionClean.slice(0, 200).toLowerCase();

  let score = 0;

  const guestFit =
    countMatches(descriptionLower, DESCRIPTION_RULES.guestFit) >= 1 ||
    containsAny(descriptionLower, ["perfect for", "ideal for", "great for"]);

  const practicalValue =
    countMatches(first200, DESCRIPTION_RULES.practicalBenefitTokens) >= 1 ||
    countRegexMatches(first200, DESCRIPTION_RULES.distanceRegexes) >= 1;

  const differentiation =
    countMatches(titleLower, TITLE_RULES.differentiators) >= 1 ||
    countMatches(descriptionLower, TITLE_RULES.differentiators) >= 1;

  const copyAmenityConsistency = (amenityData?.mismatchFlags?.length || 0) === 0;
  const workReadiness =
    hasAmenity(amenityData.amenityTitles, ["workspace", "desk", "dedicated workspace"]) ||
    hasAmenity(amenityData.amenityTitles, ["wifi", "wi-fi"]);

  if (!guestFit && !practicalValue && !differentiation) {
    score = 1;
  } else if ((guestFit || practicalValue) && !differentiation) {
    score = 3;
  } else if (guestFit && practicalValue) {
    score = 5;
  }

  if (differentiation) score += 2;
  if (copyAmenityConsistency) score += 1;
  if (workReadiness) score += 1;
  if (photoData.photoCount >= 20) score += 1;

  return { score: clamp(score, 0, 10) };
}

function getOverallLabel(overallScore) {
  if (overallScore <= 49) return "Needs work";
  if (overallScore <= 64) return "Below par";
  if (overallScore <= 74) return "Fair";
  if (overallScore <= 84) return "Decent";
  if (overallScore <= 92) return "Strong";
  return "Exceptional";
}

function buildCategoryMessages({
  titleScore,
  descriptionScore,
  photoScore,
  amenityScore,
  trustScore,
  marketScore,
  detectedPhotoCount,
  detectedReviewCount,
  detectedRating,
  penaltiesApplied,
  overallCapApplied,
}) {
  return {
    detected_signals: {
      photos_detected: detectedPhotoCount,
      reviews_detected: detectedReviewCount,
      rating_detected: detectedRating,
      penalties_applied: penaltiesApplied,
      overall_cap_applied: overallCapApplied,
    },
    category_messages: [
      {
        category: "Title Strength",
        message:
          titleScore <= 3
            ? "Your title looks weak or too generic, which may be limiting clicks before guests even open the listing."
            : titleScore <= 5
            ? "Your title is readable, but it feels fairly ordinary and may not be surfacing the strongest reasons to book."
            : titleScore <= 11
            ? "Your title is reasonably clear and useful, though it may still be underselling the most compelling parts of the stay."
            : "Your title is doing a good job of signalling value, clarity and guest relevance.",
      },
      {
        category: "Description Strength",
        message:
          descriptionScore <= 2
            ? "Your description looks thin or too vague, so guests may not be getting enough confidence from it."
            : descriptionScore <= 5
            ? "Your description covers some basics, but the opening may be too slow or too generic to sell the stay well."
            : descriptionScore <= 11
            ? "Your description is reasonably specific and useful, though the value could be surfaced faster and more clearly."
            : "Your description is doing a good job of explaining the stay in a clear and persuasive way.",
      },
      {
        category: "Photo Strength",
        message:
          photoScore <= 5
            ? "Your photo set looks too thin to build strong booking confidence, and guests may not be seeing enough of the space."
            : photoScore <= 10
            ? "Your photos give some visibility, but the volume still looks light and may be leaving gaps in room coverage."
            : photoScore <= 15
            ? "Your photo set is decent in places, though fuller coverage and stronger variety would improve confidence."
            : "Your photo coverage looks solid overall and is doing a good job of helping guests picture the stay.",
      },
      {
        category: "Amenities & Guest Appeal",
        message:
          amenityScore <= 7
            ? "Your amenities look light on key practical details, which may be making the stay feel less ready for real guest needs."
            : amenityScore <= 13
            ? "Your amenities cover some important basics, though there still appear to be practical gaps that could hold the listing back."
            : amenityScore <= 17
            ? "Your amenities look fairly solid overall, though a few practical extras could still improve guest confidence."
            : "Your amenities are well-rounded and are supporting the listing strongly.",
      },
      {
        category: "Trust Signals",
        message:
          trustScore <= 6
            ? "Your trust signals look weak at the moment, which may be making guests hesitate before booking."
            : trustScore <= 10
            ? "Your trust profile is building, but the review depth or reassurance signals still look fairly limited."
            : trustScore <= 15
            ? "Your trust signals are reasonably solid, though there is still room to strengthen guest confidence further."
            : "Your listing has strong trust signals, supported by guest feedback and reassurance details.",
      },
      {
        category: "Competitive Positioning",
        message:
          marketScore <= 1
            ? "Your listing positioning looks quite generic, so it may not be clearly telling the right guests why they should choose it."
            : marketScore <= 3
            ? "Your listing shows some positioning, but it still feels ordinary and may not be standing out enough."
            : marketScore <= 6
            ? "Your listing has decent practical value and guest fit, though the edge over competing listings could be sharper."
            : marketScore <= 9
            ? "Your listing shows strong differentiation and is doing a good job of communicating who it suits."
            : "Your listing is exceptionally clear on guest fit, practical value and differentiation.",
      },
    ],
  };
}

function buildTopFixes({ overallScore, photoScore, trustScore, amenityScore, titleScore, descriptionScore, marketScore }) {
  let improvementPotential = 0;

  if (photoScore < 12) improvementPotential += 7;
  else if (photoScore < 16) improvementPotential += 4;

  if (trustScore < 10) improvementPotential += 6;
  else if (trustScore < 14) improvementPotential += 3;

  if (amenityScore < 12) improvementPotential += 4;
  else if (amenityScore < 16) improvementPotential += 2;

  if (overallScore < 65) improvementPotential += 3;

  const priorities = [];

  if (photoScore < 12) priorities.push("Expand the photo set and improve room-by-room coverage.");
  if (trustScore < 10) priorities.push("Strengthen trust signals through review depth, rating quality and reassurance details.");
  if (amenityScore < 12) priorities.push("Close practical amenity gaps that affect everyday guest confidence.");
  if (titleScore <= 5) priorities.push("Rewrite the title so it is clearer, less generic and more value-led.");
  if (descriptionScore <= 5) priorities.push("Tighten the description opening so the main reasons to book are obvious earlier.");
  if (marketScore <= 3) priorities.push("Sharpen guest fit and practical positioning so the listing stands out more clearly.");

  return {
    improvement_potential: clamp(improvementPotential, 3, 20),
    priorities: priorities.slice(0, 4),
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

    if (!fetchRow || !fetchRow.raw_response) {
      return res.status(400).json({
        error: "No successful fetch data found for submission",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const property = extractPropertyFromRaw(fetchRow.raw_response);

    if (!property) {
      return res.status(400).json({
        error: "Could not extract property payload from fetch row",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const titleScore = scoreTitle(property.title);
    const amenityData = scoreAmenities(property);
    const descriptionData = scoreDescription(property.description, amenityData.amenityTitles);
    const photoData = scorePhotos(property);
    const trustData = scoreTrust(property, amenityData.amenityTitles);
    const positioningData = scoreCompetitivePositioning(property, amenityData, photoData);

    const descriptionScore = descriptionData.score;
    const photoScore = photoData.score;
    const amenityScore = amenityData.score;
    const trustScore = trustData.score;
    const marketScore = positioningData.score;

    let overallScore =
      titleScore +
      descriptionScore +
      photoScore +
      amenityScore +
      trustScore +
      marketScore;

    const penaltiesApplied = [];

    if (photoData.photoCount < 10) penaltiesApplied.push({ key: "very_sparse_photos", value: 11 });
    else if (photoData.photoCount < 15) penaltiesApplied.push({ key: "sparse_photos", value: 7 });
    else if (photoData.photoCount < 20) penaltiesApplied.push({ key: "suboptimal_photos", value: 4 });

    if (trustData.reviewCount < 5) penaltiesApplied.push({ key: "very_low_reviews", value: 8 });
    else if (trustData.reviewCount < 10) penaltiesApplied.push({ key: "low_reviews", value: 5 });
    else if (trustData.reviewCount < 20) penaltiesApplied.push({ key: "limited_reviews", value: 3 });

    if (trustData.rating > 0 && trustData.rating < 4.5) {
      penaltiesApplied.push({ key: "low_rating", value: 8 });
    } else if (trustData.rating >= 4.5 && trustData.rating < 4.8) {
      penaltiesApplied.push({ key: "middling_rating", value: 4 });
    }

    if (amenityData.practicalMissingCount >= 4) {
      penaltiesApplied.push({ key: "weak_practical_readiness", value: 6 });
    } else if (amenityData.practicalMissingCount >= 2) {
      penaltiesApplied.push({ key: "some_practical_gaps", value: 3 });
    }

    if (descriptionData.claimsWithoutSupport >= 3) {
      penaltiesApplied.push({ key: "copy_amenity_mismatch", value: 5 });
    } else if (descriptionData.claimsWithoutSupport >= 1) {
      penaltiesApplied.push({ key: "light_copy_amenity_mismatch", value: 2 });
    }

    if (photoData.photoCount >= 44) {
      penaltiesApplied.push({ key: "photo_overload", value: photoData.photoCount >= 60 ? 4 : 2 });
    }

    const penaltyTotal = penaltiesApplied.reduce((sum, item) => sum + item.value, 0);
    overallScore -= penaltyTotal;

    let overallCapApplied = null;
    let overallCap = 100;

    if (photoScore < 12) overallCap = Math.min(overallCap, 78);
    if (photoScore < 8) overallCap = Math.min(overallCap, 70);
    if (trustScore < 10) overallCap = Math.min(overallCap, 74);
    if (trustScore < 6) overallCap = Math.min(overallCap, 66);
    if (titleScore <= 5 && descriptionScore <= 5) overallCap = Math.min(overallCap, 72);
    if (trustData.reviewCount < 5) overallCap = Math.min(overallCap, 68);

    if (overallCap < 100) {
      overallCapApplied = overallCap;
      overallScore = Math.min(overallScore, overallCap);
    }

    overallScore = clamp(Math.round(overallScore), 0, 100);

    const detectedPhotoCount = photoData.photoCount;
    const detectedReviewCount = trustData.reviewCount;
    const detectedRating = trustData.rating;

    const scoreLabel = getOverallLabel(overallScore);

    const summaryPayload = buildCategoryMessages({
      titleScore,
      descriptionScore,
      photoScore,
      amenityScore,
      trustScore,
      marketScore,
      detectedPhotoCount,
      detectedReviewCount,
      detectedRating,
      penaltiesApplied,
      overallCapApplied,
    });

    const topFixes = buildTopFixes({
      overallScore,
      photoScore,
      trustScore,
      amenityScore,
      titleScore,
      descriptionScore,
      marketScore,
    });

    const signalsPayload = {
      extracted_fields: {
        title: property.title || "",
        reviews: property.reviews ?? null,
        rating: property.rating ?? null,
        photos_detected: detectedPhotoCount,
      },
      title: {
        length: String(property.title || "").trim().length,
        caps_ratio: capsRatio(property.title || ""),
        emoji_count: countEmojis(property.title || ""),
      },
      description: {
        length: stripHtml(property.description || "").length,
        has_distance_signal:
          countRegexMatches(stripHtml(property.description || ""), DESCRIPTION_RULES.distanceRegexes) > 0,
        claims_without_support: descriptionData.claimsWithoutSupport,
      },
      photos: {
        detected_count: photoData.photoCount,
        room_signals: photoData.roomSignals,
      },
      amenities: {
        practical_hits: amenityData.practicalHits,
        practical_missing_count: amenityData.practicalMissingCount,
        mismatch_flags: amenityData.mismatchFlags,
      },
      trust: {
        review_volume_score: trustData.reviewVolumeScore,
        rating_score: trustData.ratingScore,
        host_score: trustData.hostScore,
        safety_score: trustData.safetyScore,
        safety_flags: trustData.safetyFlags,
      },
      penalties: penaltiesApplied,
      overall_cap_applied: overallCapApplied,
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
        top_fixes: topFixes,
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
