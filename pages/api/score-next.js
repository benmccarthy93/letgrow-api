// /pages/api/score-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SCORING_VERSION = "v4_strict_amenities"; // New version

// -----------------------------
// Helpers (Updated for new scoring)
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

function extractPropertyFromRaw(rawResponse) {
  if (!rawResponse) return null;

  if (rawResponse.property && typeof rawResponse.property === "object") {
    return rawResponse.property;
  }

  return null;
}

// -----------------------------
// Scoring Methods (Rewritten for new structure)

// Guest Appeal (with missing capacity handling)
function scoreGuestAppeal(property) {
  const guestCapacity = property.guestCapacity || null;
  const bedroomCount = property.bedroom_count || 0;
  const bathroomCount = property.bathroom_count || 0;
  let score = 0;

  if (guestCapacity) {
    if (guestCapacity <= 2) {
      score += 5;
    } else if (guestCapacity <= 4) {
      score += 10;
    } else {
      score += 15;
    }
  }

  if (guestCapacity && bedroomCount > 0) {
    const guestsPerBedroom = guestCapacity / bedroomCount;
    if (guestsPerBedroom <= 2) score += 10;
    else score -= 5;
  }

  if (guestCapacity && bathroomCount > 0) {
    const guestsPerBathroom = guestCapacity / bathroomCount;
    if (guestsPerBathroom <= 2) score += 10;
    else score -= 5;
  }

  return score;
}

// Calendar Availability (with missing data handling)
function scoreCalendarAvailability(property) {
  const calendar = property.calendar || [];
  let score = 0;

  if (calendar.length > 0) {
    const availableCount = calendar.filter(entry => entry.available).length;
    const availablePct = availableCount / calendar.length;

    if (availablePct < 0.25) {
      score += 20;
    } else if (availablePct < 0.50) {
      score -= 10;
    } else {
      score += 5;
    }
  }

  return score;
}

// Title Scoring
function scoreTitle(title) {
  const cleanTitle = String(title || "").toLowerCase();
  const fillerWords = ["cosy", "great", "lovely", "amazing", "beautiful", "stunning"];
  let score = 0;

  const titleLength = cleanTitle.length;
  const fillerWordCount = fillerWords.filter(word => cleanTitle.includes(word)).length;

  if (titleLength < 18) {
    score -= 5;
  } else if (titleLength <= 50) {
    score += 5;
  } else {
    score -= 3;
  }

  if (fillerWordCount >= 2) {
    score -= 2;
  }

  return score;
}

// Description Scoring
function scoreDescription(description) {
  const descriptionLength = String(description || "").length;
  const practicalBenefitTokens = ["parking", "wifi", "workspace", "self check-in", "kitchen"];
  let score = 0;

  practicalBenefitTokens.forEach(token => {
    if (description.toLowerCase().includes(token)) score += 2;
  });

  if (descriptionLength < 100) {
    score -= 3;
  } else if (descriptionLength > 1000) {
    score -= 2;
  }

  return score;
}

// Photo Scoring
function scorePhotos(property) {
  const photos = property.photos || [];
  let score = 0;

  if (photos.length < 5) {
    score = 5;
  } else if (photos.length < 10) {
    score = 8;
  } else if (photos.length < 20) {
    score = 12;
  } else {
    score = 20;
  }

  const roomCoverage = {
    bedroom: photos.some(p => p.caption.includes("bedroom")),
    bathroom: photos.some(p => p.caption.includes("bathroom")),
    kitchen: photos.some(p => p.caption.includes("kitchen")),
    living: photos.some(p => p.caption.includes("living room")),
  };

  Object.keys(roomCoverage).forEach(room => {
    if (roomCoverage[room]) score += 2;
  });

  return score;
}

// Amenity Scoring (with custom values)
function scoreAmenities(property) {
  const amenities = property.amenities || [];
  let score = 0;

  amenities.forEach(amenity => {
    switch (amenity.title.toLowerCase()) {
      case 'hairdryer':
        score += 3; break;
      case 'wifi':
        score += 5; break;
      case 'air conditioning':
        score += 4; break;
      case 'self check-in':
        score += 6; break;
      default:
        score += 1;
    }
  });

  return score;
}

// Trust Scoring
function scoreTrustSignals(property) {
  const rating = property.rating || 0;
  const reviewCount = property.review_count || 0;
  let score = 0;

  if (rating >= 4.8) {
    score += 5;
  } else if (rating >= 4.5) {
    score += 3;
  }

  if (reviewCount >= 50) {
    score += 4;
  } else if (reviewCount >= 20) {
    score += 2;
  }

  return score;
}

// Competitive Positioning Scoring
function scoreCompetitivePositioning(property, marketData) {
  let score = 0;

  if (marketData) {
    const priceDifference = property.price - marketData.avgPrice;
    if (priceDifference < -10) {
      score += 5;
    } else if (priceDifference > 10) {
      score -= 5;
    }
  }

  return score;
}

// Final Score Calculation
function calculateFinalScore(property, marketData) {
  const guestAppeal = scoreGuestAppeal(property);
  const calendarAvailability = scoreCalendarAvailability(property);
  const titleScore = scoreTitle(property.title);
  const descriptionScore = scoreDescription(property.description);
  const photoScore = scorePhotos(property);
  const amenitiesScore = scoreAmenities(property);
  const trustScore = scoreTrustSignals(property);
  const competitiveScore = scoreCompetitivePositioning(property, marketData);

  const overallScore =
    guestAppeal + calendarAvailability + titleScore + descriptionScore +
    photoScore + amenitiesScore + trustScore + competitiveScore;

  return Math.min(overallScore, 100);
}

export default async function handler(req, res) {
  // The logic for handling the request, calling these functions, and storing the result
  try {
    const { property, marketData } = req.body; // assuming you're passing data in request body
    const overallScore = calculateFinalScore(property, marketData);

    return res.status(200).json({
      success: true,
      overallScore,
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
}
