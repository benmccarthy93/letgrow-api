// /pages/api/score-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const SCORING_VERSION = "v5_competitive_rates";

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

function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

// -----------------------------
// Keyword Lists
// -----------------------------
const KEYWORD_LIST = [
    "london", "manchester", "birmingham", "edinburgh", "glasgow", "liverpool",
    "bristol", "leeds", "sheffield", "newcastle", "cardiff", "nottingham",
    "cambridge", "oxford", "brighton", "bath", "york", "coventry", "sunderland",
    "leicester", "reading", "milton keynes", "southampton", "portsmouth",
    "dundee", "aberdeen", "norwich", "exeter", "chester", "luton", "inverness",
    "st albans", "kingston upon hull",
    "penthouse", "studio", "apartment", "loft", "house", "cottage", "cabin",
    "villa", "mansion", "barn", "chalet", "townhouse", "duplex", "bungalow",
    "lodge", "barn conversion", "boutique hotel", "cottage retreat",
    "designer flat", "luxury villa", "waterfront villa", "seaside cottage",
    "flat", "retreat", "modern home", "cozy retreat", "beach house",
    "city centre", "seaside", "riverside", "central", "quiet", "countryside",
    "mountain view", "lake view", "harbour view", "suburban", "rural",
    "near beach", "close to public transport", "scenic views",
    "historic district", "town centre", "waterfront", "forest", "forest view",
    "valley view", "close to shops", "close to restaurants",
    "quiet neighborhood", "quiet area", "beachfront", "lakefront",
    "near train station", "near the beach", "near parks",
    "luxury", "high-end", "designer", "exclusive", "premium", "spacious",
    "stylish", "opulent", "secluded", "private", "elegant", "grand", "chic",
    "upscale", "lavish", "state-of-the-art", "modern", "boutique",
    "hot tub", "sauna", "pool", "jacuzzi", "swimming pool", "gym", "spa",
    "bbq area", "fully equipped kitchen", "washer/dryer", "dishwasher",
    "coffee machine", "hairdryer", "ironing facilities", "secure entry",
    "private garden", "balcony", "patio", "outdoor dining area", "fireplace",
    "smart tv", "wi-fi", "free parking", "free wi-fi", "office space", "desk",
    "coffee table", "dining table", "microwave", "toaster", "freezer", "fridge",
    "hangers", "towels", "bed linen", "shower gel", "conditioner", "body soap",
    "eco-friendly", "ev charger", "cleaning products", "air conditioning",
    "heating", "travel cot", "high chair", "cot", "lift", "elevator",
    "pets allowed", "bbq", "pool table", "table tennis",
    "family-friendly", "pet-friendly", "romantic getaway", "business travel",
    "corporate", "ideal for groups", "cozy", "secluded retreat", "luxury stay",
    "countryside escape", "weekend getaway", "rural escape",
    "peaceful hideaway", "seaside escape", "city break", "wellness retreat",
    "wedding venue", "honeymoon stay", "cozy cabin", "eco-friendly getaway",
    "winter wonderland", "ski-in/ski-out", "vineyard stay",
    "group stay", "corporate stay", "relaxing retreat",
    "peaceful stay", "perfect for couples", "ideal for families",
    "secluded escape", "coastal retreat", "countryside retreat", "quiet escape",
    "pool view", "sea view", "river view",
    "fully furnished", "newly renovated", "bright and airy", "modern design",
    "spacious living", "comfortable", "fully equipped",
    "near attractions", "close to parks", "close to the river", "near museums",
    "close to nightlife",
  ];

const UNIQUE_KEYWORDS = [...new Set(KEYWORD_LIST)];

function countKeywordMatches(text) {
    const lower = String(text || "").toLowerCase();
    return UNIQUE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
}

// -----------------------------
// Bucket weights (percentage of 100)
// -----------------------------
const BUCKET_WEIGHTS = {
    title: 10,
    description: 10,
    photos: 10,
    amenities: 10,
    trust: 30,
    competitive: 30,
};

// -----------------------------
// 1. Title Score (internal max 20)
// -----------------------------
function scoreTitle(title) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return { score: 0, internal: 0, max: 20, lengthPoints: 0, keywordPoints: 0, capsDeduction: 0, keywordCount: 0 };

  const titleLength = cleanTitle.length;

  let lengthPoints = 0;
    if (titleLength >= 35) lengthPoints = 10;
    else if (titleLength >= 30) lengthPoints = 5;
    else lengthPoints = 0;

  const keywordCount = countKeywordMatches(cleanTitle);
    let keywordPoints = 0;
    if (keywordCount >= 5) keywordPoints = 10;
    else if (keywordCount >= 4) keywordPoints = 7;
    else if (keywordCount >= 3) keywordPoints = 3;
    else if (keywordCount >= 2) keywordPoints = 1;
    else keywordPoints = 0;

  const letters = cleanTitle.replace(/[^a-zA-Z]/g, "");
    const isAllCaps = letters.length > 0 && letters === letters.toUpperCase();
    const capsDeduction = isAllCaps ? 10 : 0;

  const internal = clamp(lengthPoints + keywordPoints - capsDeduction, 0, 20);

  return { score: internal, internal, max: 20, lengthPoints, keywordPoints, keywordCount, capsDeduction };
}

// -----------------------------
// 2. Description Score (internal max 30)
// -----------------------------
function scoreDescription(description) {
    const raw = String(description || "");
    const clean = stripHtml(raw);
    if (!clean) return { score: 0, internal: 0, max: 30, lengthPoints: 0, keywordPoints: 0, keywordCount: 0, descLength: 0 };

  const descLength = clean.length;

  let lengthPoints = 0;
    if (descLength > 400) lengthPoints = 10;
    else if (descLength >= 350) lengthPoints = 8;
    else if (descLength >= 300) lengthPoints = 3;
    else lengthPoints = 0;

  const keywordCount = countKeywordMatches(clean);
    let keywordPoints = 0;
    if (keywordCount >= 15) keywordPoints = 20;
    else if (keywordCount >= 12) keywordPoints = 15;
    else if (keywordCount >= 10) keywordPoints = 10;
    else if (keywordCount >= 7) keywordPoints = 5;
    else if (keywordCount >= 4) keywordPoints = 2;
    else keywordPoints = 0;

  const internal = clamp(lengthPoints + keywordPoints, 0, 30);

  return { score: internal, internal, max: 30, lengthPoints, keywordPoints, keywordCount, descLength };
}

// -----------------------------
// 3. Photo Score (internal max 20)
// -----------------------------
function scorePhotos(property) {
    const photoCount = extractPhotoCount(property);

  let internal = 0;
    if (photoCount < 10) internal = 0;
    else if (photoCount <= 15) internal = 5;
    else if (photoCount <= 20) internal = 7;
    else if (photoCount <= 25) internal = 10;
    else if (photoCount <= 30) internal = 16;
    else if (photoCount <= 35) internal = 18;
    else if (photoCount <= 40) internal = 19;
    else if (photoCount <= 60) internal = 20;
    else internal = 18;

  return { score: internal, internal, max: 20, photoCount };
}

// -----------------------------
// 4. Amenities & Guest Appeal
// -----------------------------
const AMENITY_SCORING_TABLE = [
  { key: "wine_glasses", patterns: ["wine glass"], positive: 1, penalty: -3 },
  { key: "toaster", patterns: ["toaster"], positive: 1, penalty: -3 },
  { key: "waste_compactor", patterns: ["trash compactor", "waste compactor"], positive: 1, penalty: -3 },
  { key: "shower_gel", patterns: ["shower gel"], positive: 1, penalty: -3 },
  { key: "shampoo", patterns: ["shampoo"], positive: 1, penalty: -3 },
  { key: "body_soap", patterns: ["body soap"], positive: 1, penalty: -3 },
  { key: "bed_linen", patterns: ["bed linen", "bed linens"], positive: 1, penalty: -3 },
  { key: "books", patterns: ["books", "reading material"], positive: 1, penalty: -3 },
  { key: "cleaning_products", patterns: ["cleaning product"], positive: 1, penalty: -3 },
  { key: "clothes_storage", patterns: ["clothing storage", "clothes storage", "wardrobe", "closet"], positive: 1, penalty: -3 },
  { key: "coffee", patterns: ["coffee"], positive: 1, penalty: -3 },
  { key: "coffee_maker", patterns: ["coffee maker", "coffee machine"], positive: 1, penalty: -3 },
  { key: "conditioner", patterns: ["conditioner"], positive: 1, penalty: -3 },
  { key: "cooker", patterns: ["cooker", "stove"], positive: 1, penalty: -2 },
  { key: "cooking_basics", patterns: ["cooking basics"], positive: 1, penalty: -3 },
  { key: "crockery_cutlery", patterns: ["dishes and silverware", "crockery", "cutlery"], positive: 1, penalty: -3 },
  { key: "essentials", patterns: ["essentials"], positive: 1, penalty: -3 },
  { key: "extra_pillows", patterns: ["extra pillows", "extra blankets"], positive: 1, penalty: -3 },
  { key: "freezer", patterns: ["freezer"], positive: 1, penalty: -2 },
  { key: "fridge", patterns: ["fridge", "refrigerator", "mini fridge"], positive: 1, penalty: -2 },
  { key: "hangers", patterns: ["hanger"], positive: 1, penalty: -3 },
  { key: "kettle", patterns: ["kettle"], positive: 1, penalty: -3 },
  { key: "microwave", patterns: ["microwave"], positive: 1, penalty: -3 },
  { key: "oven", patterns: ["oven"], positive: 1, penalty: -2 },
  { key: "portable_fans", patterns: ["portable fan", "fan"], positive: 1, penalty: -3 },
  { key: "high_chair", patterns: ["high chair"], positive: 2, penalty: -3 },
  { key: "king_bed", patterns: ["king bed", "king size"], positive: 2, penalty: -1 },
  { key: "patio", patterns: ["patio"], positive: 2, penalty: 0 },
  { key: "paid_parking", patterns: ["paid parking"], positive: 2, penalty: 0 },
  { key: "dining_table", patterns: ["dining table"], positive: 2, penalty: -3 },
  { key: "tumble_dryer", patterns: ["dryer", "tumble dryer"], positive: 3, penalty: -1 },
  { key: "workspace", patterns: ["workspace", "dedicated workspace", "desk"], positive: 3, penalty: -1 },
  { key: "hairdryer", patterns: ["hair dryer", "hairdryer"], positive: 3, penalty: -3 },
  { key: "iron", patterns: ["iron"], positive: 3, penalty: -3 },
  { key: "bath", patterns: ["bath", "bathtub"], positive: 3, penalty: 0 },
  { key: "ev_charger", patterns: ["ev charger"], positive: 3, penalty: -1 },
  { key: "cot", patterns: ["crib", "cot"], positive: 3, penalty: 0 },
  { key: "pool", patterns: ["pool", "swimming pool"], positive: 3, penalty: 0 },
  { key: "bbq", patterns: ["bbq", "barbecue", "grill"], positive: 3, penalty: 0 },
  { key: "free_street_parking", patterns: ["free street parking", "free on-street"], positive: 3, penalty: 0 },
  { key: "travel_cot", patterns: ["travel cot", "travel crib", "pack 'n play", "pack n play"], positive: 3, penalty: -3 },
  { key: "co2_alarm", patterns: ["carbon monoxide alarm", "carbon monoxide detector", "co alarm"], positive: 3, penalty: -3 },
  { key: "smoke_alarm", patterns: ["smoke alarm", "smoke detector"], positive: 3, penalty: -3 },
  { key: "first_aid_kit", patterns: ["first aid kit"], positive: 3, penalty: -3 },
  { key: "fire_extinguisher", patterns: ["fire extinguisher"], positive: 3, penalty: -3 },
  { key: "kitchen", patterns: ["kitchen"], positive: 4, penalty: -4 },
  { key: "air_con", patterns: ["air conditioning", "air con", "aircon"], positive: 4, penalty: -2 },
  { key: "tv", patterns: ["tv", "television"], positive: 4, penalty: -2 },
  { key: "washing_machine", patterns: ["washer", "washing machine"], positive: 4, penalty: -1 },
  { key: "heating", patterns: ["heating"], positive: 4, penalty: 0 },
  { key: "free_parking", patterns: ["free parking on premises", "free parking"], positive: 5, penalty: 0 },
  { key: "pets", patterns: ["pets allowed", "pet friendly", "pet-friendly"], positive: 5, penalty: 0 },
  { key: "sauna", patterns: ["sauna"], positive: 5, penalty: 0 },
  { key: "hot_tub", patterns: ["hot tub", "jacuzzi"], positive: 5, penalty: 0 },
  { key: "wifi", patterns: ["wifi", "wi-fi"], positive: 5, penalty: -5 },
  ];

const AMENITY_TABLE_MAX_POSITIVE = AMENITY_SCORING_TABLE.reduce((sum, item) => sum + item.positive, 0);
const AMENITY_INTERNAL_MAX = 50 + AMENITY_TABLE_MAX_POSITIVE;

function scoreAmenities(property) {
    const amenityTitles = normaliseAmenityTitles(property?.amenities || []);
    const amenityCount = amenityTitles.length;

  const countBonus = amenityCount > 40 ? 50 : 0;

  let itemScore = 0;
    const present = [];
    const missing = [];

  for (const item of AMENITY_SCORING_TABLE) {
        const found = hasAmenity(amenityTitles, item.patterns);
        if (found) {
                itemScore += item.positive;
                present.push(item.key);
        } else {
                itemScore += item.penalty;
                missing.push(item.key);
        }
  }

  const internal = Math.max(0, countBonus + itemScore);

  return { score: internal, internal, max: AMENITY_INTERNAL_MAX, amenityTitles, amenityCount, countBonus, itemScore, present, missing };
}

// -----------------------------
// 5. Trust Signals (internal max 100)
// -----------------------------
function scoreTrust(property, amenityTitles) {
    const rating = extractRating(property);
    const reviewCount = extractReviewCount(property);
    const host = property?.host || {};

  let reviewVolumeScore = 0;
    if (reviewCount >= 100) reviewVolumeScore = 25;
    else if (reviewCount >= 50) reviewVolumeScore = 20;
    else if (reviewCount >= 30) reviewVolumeScore = 10;
    else if (reviewCount >= 20) reviewVolumeScore = 5;
    else if (reviewCount >= 10) reviewVolumeScore = 3;
    else reviewVolumeScore = 0;

  let ratingScore = 0;
    if (rating >= 4.91) ratingScore = 25;
    else if (rating >= 4.87) ratingScore = 20;
    else if (rating >= 4.8) ratingScore = 10;
    else if (rating >= 4.7) ratingScore = 3;
    else if (rating >= 4.6) ratingScore = 1;
    else ratingScore = 0;

  const superhostScore = host.isSuperhost ? 20 : 0;

  const yearsHosting = safeNumber(host.yearsHosting);
    const yearsActiveScore = yearsHosting >= 2 ? 20 : 0;

  const responseTimeRaw = String(host.responseTime || host.response_time || host.responseRate || "").toLowerCase();
    const respondsQuickly = responseTimeRaw.includes("within an hour") || responseTimeRaw.includes("within 1 hour") || responseTimeRaw.includes("< 1 hour") || responseTimeRaw.includes("less than an hour");
    const responseTimeScore = respondsQuickly ? 10 : 0;

  let safetyDeduction = 0;
    if (!hasAmenity(amenityTitles, ["smoke alarm", "smoke detector"])) safetyDeduction -= 5;
    if (!hasAmenity(amenityTitles, ["carbon monoxide alarm", "carbon monoxide detector", "co alarm"])) safetyDeduction -= 5;
    if (!hasAmenity(amenityTitles, ["first aid kit"])) safetyDeduction -= 5;
    if (!hasAmenity(amenityTitles, ["security camera", "security cameras"])) safetyDeduction -= 5;
    if (!hasAmenity(amenityTitles, ["fire extinguisher"])) safetyDeduction -= 5;

  const internal = clamp(reviewVolumeScore + ratingScore + superhostScore + yearsActiveScore + responseTimeScore + safetyDeduction, 0, 100);

  return { score: internal, internal, max: 100, rating, reviewCount, reviewVolumeScore, ratingScore, superhostScore, yearsHosting, yearsActiveScore, responseTimeScore, safetyDeduction };
}

// -----------------------------
// 6. Competitive Positioning (internal max 85, based on AirROI rates data)
// -----------------------------
function scoreCompetitivePositioning(ratesData) {
    const rates = Array.isArray(ratesData) ? ratesData : [];
    const signals = {};
    let total = 0;

    if (rates.length === 0) {
        return { score: 0, internal: 0, max: 85, noData: true, signals };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Helper: get rates within a day range from today
    function ratesInRange(startDay, endDay) {
        return rates.filter((r) => {
            const d = new Date(r.date);
            const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
            return diffDays >= startDay && diffDays < endDay;
        });
    }

    // Helper: availability percentage (ratio of available days)
    function availabilityPct(subset) {
        if (subset.length === 0) return 1;
        const available = subset.filter((r) => r.available).length;
        return available / subset.length;
    }

    // Get priced days (available with a rate)
    const pricedDays = rates.filter((r) => r.available && r.rate != null && r.rate > 0);

    // --- Weekend price uplift ---
    const weekdays = pricedDays.filter((r) => {
        const day = new Date(r.date).getDay();
        return day >= 1 && day <= 4; // Mon-Thu
    });
    const weekends = pricedDays.filter((r) => {
        const day = new Date(r.date).getDay();
        return day === 0 || day === 5 || day === 6; // Fri, Sat, Sun
    });
    const avgWeekday = weekdays.length > 0 ? weekdays.reduce((s, r) => s + r.rate, 0) / weekdays.length : 0;
    const avgWeekend = weekends.length > 0 ? weekends.reduce((s, r) => s + r.rate, 0) / weekends.length : 0;
    const hasWeekendUplift = avgWeekday > 0 && avgWeekend > avgWeekday * 1.05;
    signals.weekendPriceUplift = hasWeekendUplift ? 5 : 0;
    total += signals.weekendPriceUplift;

    // --- Event price spikes (any day with rate > 2x the median) ---
    const sortedRates = pricedDays.map((r) => r.rate).sort((a, b) => a - b);
    const median = sortedRates.length > 0 ? sortedRates[Math.floor(sortedRates.length / 2)] : 0;
    const hasPriceSpikes = median > 0 && pricedDays.some((r) => r.rate > median * 2);
    signals.eventPriceSpikes = hasPriceSpikes ? 5 : 0;
    total += signals.eventPriceSpikes;

    // --- Seasonal pricing shifts (compare monthly ADR across available months) ---
    const monthlyAdr = {};
    for (const r of pricedDays) {
        const month = r.date.slice(0, 7); // yyyy-MM
        if (!monthlyAdr[month]) monthlyAdr[month] = { sum: 0, count: 0 };
        monthlyAdr[month].sum += r.rate;
        monthlyAdr[month].count++;
    }
    const monthAvgs = Object.values(monthlyAdr).map((m) => m.sum / m.count);
    const hasSeasonalShifts = monthAvgs.length >= 2 && (Math.max(...monthAvgs) / Math.min(...monthAvgs)) > 1.15;
    signals.seasonalPricingShifts = hasSeasonalShifts ? 5 : 0;
    total += signals.seasonalPricingShifts;

    // --- Flat pricing detection (same price across entire calendar) ---
    const uniqueRates = new Set(pricedDays.map((r) => r.rate));
    const isFlatPricing = pricedDays.length >= 10 && uniqueRates.size <= 2;
    signals.flatPricingDetection = isFlatPricing ? -20 : 0;
    total += signals.flatPricingDetection;

    // --- Availability windows ---
    const avail0to10 = ratesInRange(0, 10);
    const avail10to20 = ratesInRange(10, 20);
    const avail20to30 = ratesInRange(20, 30);
    const avail30to60 = ratesInRange(30, 60);

    const pct0to10 = availabilityPct(avail0to10);
    if (pct0to10 < 0.25) signals.avail0to10 = 20;
    else if (pct0to10 <= 0.50) signals.avail0to10 = -10;
    else signals.avail0to10 = -25;
    total += signals.avail0to10;

    const pct10to20 = availabilityPct(avail10to20);
    if (pct10to20 < 0.25) signals.avail10to20 = 20;
    else if (pct10to20 <= 0.50) signals.avail10to20 = 5;
    else signals.avail10to20 = -20;
    total += signals.avail10to20;

    const pct20to30 = availabilityPct(avail20to30);
    if (pct20to30 < 0.25) signals.avail20to30 = 5;
    else if (pct20to30 <= 0.50) signals.avail20to30 = -5;
    else signals.avail20to30 = -15;
    total += signals.avail20to30;

    const pct30to60 = availabilityPct(avail30to60);
    if (pct30to60 < 0.50) signals.avail30to60 = 5;
    else signals.avail30to60 = -5;
    total += signals.avail30to60;

    // --- Long gaps in calendar (7+ consecutive available days) ---
    const sortedByDate = [...rates].sort((a, b) => a.date.localeCompare(b.date));
    let maxConsecutiveAvailable = 0;
    let currentStreak = 0;
    for (const r of sortedByDate) {
        if (r.available) {
            currentStreak++;
            if (currentStreak > maxConsecutiveAvailable) maxConsecutiveAvailable = currentStreak;
        } else {
            currentStreak = 0;
        }
    }
    const hasLongGaps = maxConsecutiveAvailable >= 7;
    signals.longGaps = hasLongGaps ? -20 : 0;
    total += signals.longGaps;

    // --- Price volatility (std deviation >= 35% of mean) ---
    if (pricedDays.length >= 5) {
        const mean = pricedDays.reduce((s, r) => s + r.rate, 0) / pricedDays.length;
        const variance = pricedDays.reduce((s, r) => s + Math.pow(r.rate - mean, 2), 0) / pricedDays.length;
        const stdDev = Math.sqrt(variance);
        const isVolatile = mean > 0 && (stdDev / mean) >= 0.35;
        signals.priceVolatility = isVolatile ? 5 : 0;
    } else {
        signals.priceVolatility = 0;
    }
    total += signals.priceVolatility;

    // --- Weekend availability (over 50% weekends open within next 30 days) ---
    const next30 = ratesInRange(0, 30);
    const weekendDaysNext30 = next30.filter((r) => {
        const day = new Date(r.date).getDay();
        return day === 0 || day === 5 || day === 6;
    });
    const weekendAvailPct = weekendDaysNext30.length > 0
        ? weekendDaysNext30.filter((r) => r.available).length / weekendDaysNext30.length
        : 0;
    signals.weekendAvailability = weekendAvailPct > 0.50 ? -10 : 0;
    total += signals.weekendAvailability;

    // --- Minimum stay ---
    const minNightsValues = rates
        .filter((r) => r.min_nights != null && r.min_nights > 0)
        .map((r) => r.min_nights);
    const avgMinNights = minNightsValues.length > 0
        ? minNightsValues.reduce((s, n) => s + n, 0) / minNightsValues.length
        : null;

    if (avgMinNights === null) {
        signals.minimumStay = 0;
    } else if (avgMinNights <= 1) {
        signals.minimumStay = 15;
    } else if (avgMinNights <= 2) {
        signals.minimumStay = 5;
    } else if (avgMinNights <= 5) {
        signals.minimumStay = 0;
    } else if (avgMinNights <= 7) {
        signals.minimumStay = -10;
    } else {
        signals.minimumStay = -20;
    }
    total += signals.minimumStay;

    // Internal max is 85 (sum of all best-case positive signals)
    const internal = clamp(total, 0, 85);

    return {
        score: internal,
        internal,
        max: 85,
        noData: false,
        signals,
        meta: {
            totalRateDays: rates.length,
            pricedDays: pricedDays.length,
            avgWeekday: Number(avgWeekday.toFixed(2)),
            avgWeekend: Number(avgWeekend.toFixed(2)),
            medianRate: median,
            uniqueRateCount: uniqueRates.size,
            avgMinNights: avgMinNights !== null ? Number(avgMinNights.toFixed(1)) : null,
            maxConsecutiveAvailable,
            availPct: {
                next10: Number(pct0to10.toFixed(2)),
                next10to20: Number(pct10to20.toFixed(2)),
                next20to30: Number(pct20to30.toFixed(2)),
                next30to60: Number(pct30to60.toFixed(2)),
            },
            weekendAvailPctNext30: Number(weekendAvailPct.toFixed(2)),
        },
    };
}

// -----------------------------
// Overall score calculation
// -----------------------------
function calculateOverallScore(titleData, descriptionData, photoData, amenityData, trustData, competitiveData) {
    const titlePct = (titleData.internal / titleData.max) * BUCKET_WEIGHTS.title;
    const descPct = (descriptionData.internal / descriptionData.max) * BUCKET_WEIGHTS.description;
    const photoPct = (photoData.internal / photoData.max) * BUCKET_WEIGHTS.photos;
    const amenityPct = (amenityData.internal / amenityData.max) * BUCKET_WEIGHTS.amenities;
    const trustPct = (trustData.internal / trustData.max) * BUCKET_WEIGHTS.trust;
    const competitivePct = (competitiveData.internal / competitiveData.max) * BUCKET_WEIGHTS.competitive;

  const raw = titlePct + descPct + photoPct + amenityPct + trustPct + competitivePct;

  return {
        overall: clamp(Math.round(raw), 0, 100),
        breakdown: {
                title: Number(titlePct.toFixed(2)),
                description: Number(descPct.toFixed(2)),
                photos: Number(photoPct.toFixed(2)),
                amenities: Number(amenityPct.toFixed(2)),
                trust: Number(trustPct.toFixed(2)),
                competitive: Number(competitivePct.toFixed(2)),
        },
  };
}

// -----------------------------
// Labels & Messages
// -----------------------------
function getOverallLabel(overallScore) {
    if (overallScore <= 49) return "Needs work";
    if (overallScore <= 64) return "Below par";
    if (overallScore <= 74) return "Fair";
    if (overallScore <= 84) return "Decent";
    if (overallScore <= 92) return "Strong";
    return "Exceptional";
}

function buildCategoryMessages(breakdown) {
    return {
          category_messages: [
            {
                      category: "Title Strength",
                      weight: "10%",
                      score: breakdown.title,
                      message: breakdown.title <= 2 ? "Your title looks weak or too generic, which may be limiting clicks before guests even open the listing." : breakdown.title <= 5 ? "Your title is readable, but it feels fairly ordinary and may not be surfacing the strongest reasons to book." : breakdown.title <= 8 ? "Your title is reasonably clear and useful, though it may still be underselling the most compelling parts of the stay." : "Your title is doing a good job of signalling value, clarity and guest relevance.",
            },
            {
                      category: "Description Strength",
                      weight: "10%",
                      score: breakdown.description,
                      message: breakdown.description <= 2 ? "Your description looks thin or too vague, so guests may not be getting enough confidence from it." : breakdown.description <= 5 ? "Your description covers some basics, but the opening may be too slow or too generic to sell the stay well." : breakdown.description <= 8 ? "Your description is reasonably specific and useful, though the value could be surfaced faster and more clearly." : "Your description is doing a good job of explaining the stay in a clear and persuasive way.",
            },
            {
                      category: "Photo Strength",
                      weight: "10%",
                      score: breakdown.photos,
                      message: breakdown.photos <= 2 ? "Your photo set looks too thin to build strong booking confidence, and guests may not be seeing enough of the space." : breakdown.photos <= 5 ? "Your photos give some visibility, but the volume still looks light and may be leaving gaps in room coverage." : breakdown.photos <= 8 ? "Your photo set is decent in places, though fuller coverage and stronger variety would improve confidence." : "Your photo coverage looks solid overall and is doing a good job of helping guests picture the stay.",
            },
            {
                      category: "Amenities & Guest Appeal",
                      weight: "10%",
                      score: breakdown.amenities,
                      message: breakdown.amenities <= 2 ? "Your amenities look light on key practical details, which may be making the stay feel less ready for real guest needs." : breakdown.amenities <= 5 ? "Your amenities cover some important basics, though there still appear to be practical gaps that could hold the listing back." : breakdown.amenities <= 8 ? "Your amenities look fairly solid overall, though a few practical extras could still improve guest confidence." : "Your amenities are well-rounded and are supporting the listing strongly.",
            },
            {
                      category: "Trust Signals",
                      weight: "30%",
                      score: breakdown.trust,
                      message: breakdown.trust <= 7 ? "Your trust signals look weak at the moment, which may be making guests hesitate before booking." : breakdown.trust <= 15 ? "Your trust profile is building, but the review depth or reassurance signals still look fairly limited." : breakdown.trust <= 22 ? "Your trust signals are reasonably solid, though there is still room to strengthen guest confidence further." : "Your listing has strong trust signals, supported by guest feedback and reassurance details.",
            },
            {
                      category: "Competitive Positioning",
                      weight: "30%",
                      score: breakdown.competitive,
                      message: breakdown.competitive <= 6 ? "Your pricing and availability signals suggest the listing may not be competing effectively — flat pricing, wide-open calendars, or high minimum stays could be holding it back." : breakdown.competitive <= 12 ? "Your pricing shows some variation but there are still gaps in dynamic pricing or availability management that may be costing bookings." : breakdown.competitive <= 22 ? "Your pricing strategy and availability look reasonably strong, though sharper weekend uplift, seasonal adjustments, or tighter availability windows could improve performance." : "Your listing shows strong competitive pricing signals — good dynamic pricing, tight availability, and smart minimum stay settings.",
            },
                ],
    };
}

function buildTopFixes(overall, breakdown) {
    const maxes = { title: BUCKET_WEIGHTS.title, description: BUCKET_WEIGHTS.description, photos: BUCKET_WEIGHTS.photos, amenities: BUCKET_WEIGHTS.amenities, trust: BUCKET_WEIGHTS.trust, competitive: BUCKET_WEIGHTS.competitive };
    const priorities = [];
    let improvementPotential = 0;

  const gaps = Object.entries(breakdown).map(([key, earned]) => ({ key, earned, max: maxes[key], gap: maxes[key] - earned, pct: earned / maxes[key] }));
    gaps.sort((a, b) => b.gap - a.gap);

  for (const g of gaps) {
        if (g.pct < 0.5) {
                improvementPotential += Math.round(g.gap);
                if (g.key === "photos") priorities.push("Expand the photo set — aim for at least 25-40 photos for best results.");
                if (g.key === "trust") priorities.push("Strengthen trust signals through more reviews, a higher rating, and Superhost status.");
                if (g.key === "amenities") priorities.push("Close practical amenity gaps — check the missing amenities list and add what you can.");
                if (g.key === "title") priorities.push("Rewrite the title to include more keywords — property type, location, and key amenities.");
                if (g.key === "description") priorities.push("Expand the description with more practical details, keywords, and guest-relevant information.");
                if (g.key === "competitive") priorities.push("Improve pricing strategy — add weekend uplift, seasonal variation, and tighten your availability windows to signal demand.");
        }
  }

  return { improvement_potential: clamp(improvementPotential, 3, 50), priorities: priorities.slice(0, 4) };
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
        const submissionId = getInputValue(body.submission_id) || getInputValue(query.submission_id) || null;

      if (!jobId && !submissionId) {
              return res.status(400).json({ error: "job_id or submission_id is required" });
      }

      let submissionQuery = supabase.from("listing_submissions").select("*");
        if (submissionId) {
                submissionQuery = submissionQuery.eq("id", submissionId);
        } else {
                submissionQuery = submissionQuery.eq("job_id", jobId);
        }

      const { data: submission, error: submissionError } = await submissionQuery.maybeSingle();

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
              return res.status(400).json({ error: "No successful fetch data found for submission", submission_id: submission.id, job_id: submission.job_id });
      }

      const property = extractPropertyFromRaw(fetchRow.raw_response);
        if (!property) {
                return res.status(400).json({ error: "Could not extract property payload from fetch row", submission_id: submission.id, job_id: submission.job_id });
        }

      // Fetch AirROI rates data for competitive positioning
      let airRoiRates = [];
      const { data: airRoiFetchRow, error: airRoiFetchError } = await supabase
          .from("listing_fetches")
          .select("raw_response")
          .eq("submission_id", submission.id)
          .eq("provider", "airroi")
          .eq("fetch_status", "success")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (!airRoiFetchError && airRoiFetchRow?.raw_response) {
          const rawRates = airRoiFetchRow.raw_response;
          if (Array.isArray(rawRates?.rates)) {
              airRoiRates = rawRates.rates;
          } else if (Array.isArray(rawRates)) {
              airRoiRates = rawRates;
          }
      }

      // Run all scoring buckets
      const titleData = scoreTitle(property.title);
        const amenityData = scoreAmenities(property);
        const descriptionData = scoreDescription(property.description);
        const photoData = scorePhotos(property);
        const trustData = scoreTrust(property, amenityData.amenityTitles);
        const competitiveData = scoreCompetitivePositioning(airRoiRates);

      // Calculate weighted overall score
      const { overall: overallScore, breakdown } = calculateOverallScore(titleData, descriptionData, photoData, amenityData, trustData, competitiveData);

      const scoreLabel = getOverallLabel(overallScore);

      const detectedPhotoCount = photoData.photoCount;
        const detectedReviewCount = trustData.reviewCount;
        const detectedRating = trustData.rating;

      const summaryPayload = buildCategoryMessages(breakdown);
        const topFixes = buildTopFixes(overallScore, breakdown);

      const signalsPayload = {
              bucket_weights: BUCKET_WEIGHTS,
              breakdown,
              title: { internal: titleData.internal, max: titleData.max, lengthPoints: titleData.lengthPoints, keywordPoints: titleData.keywordPoints, keywordCount: titleData.keywordCount, capsDeduction: titleData.capsDeduction },
              description: { internal: descriptionData.internal, max: descriptionData.max, lengthPoints: descriptionData.lengthPoints, keywordPoints: descriptionData.keywordPoints, keywordCount: descriptionData.keywordCount, descLength: descriptionData.descLength },
              photos: { internal: photoData.internal, max: photoData.max, photoCount: photoData.photoCount },
              amenities: { internal: amenityData.internal, max: amenityData.max, amenityCount: amenityData.amenityCount, countBonus: amenityData.countBonus, itemScore: amenityData.itemScore, present: amenityData.present, missing: amenityData.missing },
              trust: { internal: trustData.internal, max: trustData.max, reviewVolumeScore: trustData.reviewVolumeScore, ratingScore: trustData.ratingScore, superhostScore: trustData.superhostScore, yearsHosting: trustData.yearsHosting, yearsActiveScore: trustData.yearsActiveScore, responseTimeScore: trustData.responseTimeScore, safetyDeduction: trustData.safetyDeduction },
              competitive: { internal: competitiveData.internal, max: competitiveData.max, noData: competitiveData.noData, signals: competitiveData.signals, meta: competitiveData.meta },
      };

      const { error: scoreInsertError } = await supabase.from("listing_scores").insert([
        {
                  submission_id: submission.id,
                  scoring_version: SCORING_VERSION,
                  overall_score: overallScore,
                  score_label: scoreLabel,
                  title_score: breakdown.title,
                  description_score: breakdown.description,
                  photo_score: breakdown.photos,
                  amenity_score: breakdown.amenities,
                  trust_score: breakdown.trust,
                  market_score: breakdown.competitive,
                  summary: JSON.stringify({ ...summaryPayload, signals: signalsPayload }),
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
          .update({ status: "complete", status_message: "Scoring complete" })
          .eq("id", submission.id);

      if (submissionUpdateError) {
              console.error("Submission update error:", submissionUpdateError);
              return res.status(500).json({ error: "Score saved but failed to update submission status" });
      }

      return res.status(200).json({
              success: true,
              submission_id: submission.id,
              job_id: submission.job_id,
              overall_score: overallScore,
              score_label: scoreLabel,
              breakdown,
              detected_signals: { photos: detectedPhotoCount, reviews: detectedReviewCount, rating: detectedRating },
      });
  } catch (e) {
        console.error("Unhandled error in score-next:", e);
        return res.status(500).json({ error: "Server error" });
  }
}
