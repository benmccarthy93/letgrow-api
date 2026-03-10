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

const AMENITY_LABELS = {
    wifi: "WiFi", free_parking: "free parking", hot_tub: "a hot tub",
    sauna: "a sauna", pets: "pet-friendly access", heating: "heating",
    washing_machine: "a washing machine", tv: "a TV", air_con: "air conditioning",
    kitchen: "a full kitchen", fire_extinguisher: "a fire extinguisher",
    smoke_alarm: "a smoke alarm", co2_alarm: "a carbon monoxide alarm",
    first_aid_kit: "a first aid kit", hairdryer: "a hairdryer", iron: "an iron",
    workspace: "a dedicated workspace", tumble_dryer: "a tumble dryer",
    free_street_parking: "free street parking", travel_cot: "a travel cot",
    bbq: "a BBQ", pool: "a pool", ev_charger: "an EV charger", bath: "a bath",
    cot: "a cot", coffee_maker: "a coffee maker", dining_table: "a dining table",
    high_chair: "a high chair", king_bed: "a king-size bed", patio: "a patio",
    paid_parking: "paid parking",
};

function joinList(items) {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

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

  // If any parking type is present, don't penalise for missing other parking types
  const parkingKeys = ["free_parking", "free_street_parking", "paid_parking"];
  const hasAnyParking = parkingKeys.some(k => present.includes(k));
  if (hasAnyParking) {
        for (const pk of parkingKeys) {
                if (missing.includes(pk)) {
                        const entry = AMENITY_SCORING_TABLE.find(a => a.key === pk);
                        if (entry) {
                                itemScore -= entry.penalty; // undo the penalty
                                missing.splice(missing.indexOf(pk), 1);
                        }
                }
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

function buildTitleMessage(weightedScore, maxWeight, data) {
    if (weightedScore / maxWeight >= 0.8) {
        return "Your title is performing well — it's clearly structured, includes relevant search terms, and is likely helping your listing stand out in results. This is one of your stronger areas.";
    }
    const issues = [];
    if (data.capsDeduction > 0) {
        issues.push("the all-caps formatting may be hurting readability and making the listing feel less professional in search results");
    }
    if (data.lengthPoints === 0) {
        issues.push("it's significantly shorter than top-performing titles, which limits how much useful information guests see before deciding whether to click");
    } else if (data.lengthPoints <= 5) {
        issues.push("it's on the shorter side compared to high-performing listings, giving you less space to communicate what makes the property worth clicking on");
    }
    if (data.keywordPoints === 0) {
        issues.push("it doesn't appear to contain the types of terms that guests actively search and filter for on Airbnb");
    } else if (data.keywordPoints <= 3) {
        issues.push("it contains only a small number of the search-relevant terms that typically help listings get found and clicked on");
    }
    if (issues.length === 0) {
        return "Your title has some strengths but isn't performing at the level where it actively drives clicks. The difference between an average title and a high-performing one is often subtle — but the impact on daily traffic can be significant. An SEO-optimised title with the right keywords can significantly increase your visibility in search results — this is something our experts can help with.";
    }
    return `Your title is underperforming — ${joinList(issues)}. Your title is the very first thing a guest sees in search results, and weaknesses here quietly cost you clicks every single day. A professionally rewritten, SEO-optimised title tailored to your property and market can make a real difference — this is something our experts can help with.`;
}

function buildDescriptionMessage(weightedScore, maxWeight, data) {
    if (weightedScore / maxWeight >= 0.8) {
        return "Your description is performing well — it's detailed enough, includes relevant keywords, and gives guests a clear picture of the stay. This is helping convert browsers into bookers.";
    }
    const issues = [];
    if (data.lengthPoints === 0) {
        issues.push(`your description is only around ${data.descLength} characters, which is well below what top-performing listings typically have`);
    } else if (data.lengthPoints <= 5) {
        issues.push("your description could be more detailed — guests often need more context before they feel confident enough to book");
    }
    if (data.keywordPoints === 0) {
        issues.push("it appears to contain very few of the terms that help Airbnb's search algorithm understand and surface your listing to the right guests");
    } else if (data.keywordPoints <= 5) {
        issues.push(`only ${data.keywordCount} relevant search terms were detected, which is below the threshold where listings typically start ranking more competitively`);
    }
    if (issues.length === 0) {
        return "Your description has some useful content but isn't working as hard as it could to convert interested guests. When the value of a stay isn't communicated quickly and clearly, guests tend to keep scrolling. A structured, keyword-rich description written by an expert can turn browsers into bookers — this is something our team specialises in.";
    }
    return `Your description is leaving performance on the table — ${joinList(issues)}. A weak description doesn't just lose bookings — it also affects how Airbnb ranks and surfaces your listing against competitors. A professionally rewritten, SEO-optimised description can significantly improve both your search ranking and conversion rate — our experts can help with this.`;
}

function buildPhotoMessage(weightedScore, maxWeight, data) {
    const upsell = " The order of your photos matters more than most hosts realise, and professional photography or specialist AI enhancement can dramatically improve how your listing looks at first glance — driving more clicks and more bookings.";
    if (weightedScore / maxWeight >= 0.8) {
        return `Your photo count (${data.photoCount}) is strong and falls within the range where listings tend to perform best. Good visual coverage helps guests feel confident about booking without needing to look elsewhere.`;
    }
    if (data.photoCount < 10) {
        return `Only ${data.photoCount} photos were detected on your listing — well below what most guests expect. With this few images, guests are unlikely to feel confident enough to book and will almost certainly look at alternatives first.${upsell}`;
    }
    if (data.photoCount <= 20) {
        return `Your listing has ${data.photoCount} photos, which is below the level where most top-performing listings sit. Guests rely heavily on photos to build booking confidence, and thinner photo sets consistently lose out to competitors with stronger visual coverage.${upsell}`;
    }
    if (data.photoCount > 60) {
        return `Your listing has ${data.photoCount} photos — above the point where additional images tend to help. An excessively large photo set can dilute the impact of your strongest images and make it harder for guests to evaluate the property quickly.${upsell}`;
    }
    return `Your listing has ${data.photoCount} photos — reasonable, but not yet at the level where the best-performing listings in most markets tend to sit. Guests often choose the listing that gives them the most visual confidence.${upsell}`;
}

function buildAmenityMessage(weightedScore, maxWeight, data) {
    const upsell = " A competitor analysis for your area can reveal which small, affordable additions would have the biggest impact on your ranking — understanding what guests in your market expect is key, and our experts can guide you through exactly what to prioritise.";
    if (weightedScore / maxWeight >= 0.8) {
        return `Your amenity coverage is strong with ${data.amenityCount} amenities listed. You're covering the essentials well and guests comparing options in your area are unlikely to find obvious gaps. This is working in your favour.`;
    }
    if (data.amenityCount < 20) {
        return `Your listing has a fairly thin amenity set (${data.amenityCount} detected) and appears to be missing several amenities that guests frequently filter and compare by. These gaps may be quietly pushing bookings toward nearby competitors.${upsell}`;
    }
    return `Your amenity set has ${data.amenityCount} items listed, but there appear to be gaps in areas that guests commonly search and filter for. When guests compare similar listings side by side, missing amenities can quietly tip the decision toward a competitor.${upsell}`;
}

function buildTrustMessage(weightedScore, maxWeight, data) {
    if (weightedScore / maxWeight >= 0.8) {
        return "Your trust signals are strong — solid review coverage, a high rating, and the kind of profile that reassures guests at a glance. This is one of your biggest competitive advantages.";
    }
    const issues = [];
    if (data.reviewVolumeScore <= 3) {
        issues.push(`your review count (${data.reviewCount}) is low, which makes it harder for new guests to feel confident booking`);
    } else if (data.reviewVolumeScore <= 10) {
        issues.push(`your review count (${data.reviewCount}) is moderate but still below the level where guests feel fully reassured`);
    }
    if (data.ratingScore === 0 && data.rating > 0) {
        issues.push(`your rating (${data.rating}) is below the threshold that most guests consider acceptable`);
    } else if (data.ratingScore <= 3 && data.rating > 0) {
        issues.push(`your rating (${data.rating}) is reasonable but noticeably below the top performers in most markets`);
    } else if (data.ratingScore <= 10 && data.rating > 0) {
        issues.push(`your rating (${data.rating}) is decent but hasn't crossed into the range where it becomes a strong trust signal`);
    }
    if (data.superhostScore === 0) {
        issues.push("the listing doesn't have Superhost status, which many guests use as a quick trust filter when choosing between options");
    }
    if (data.responseTimeScore === 0) {
        issues.push("response time doesn't appear to be in the top tier, which can affect both guest confidence and search ranking");
    }
    if (data.safetyDeduction < -10) {
        issues.push("several safety features appear to be missing or unlisted, which can reduce guest confidence before they even enquire");
    } else if (data.safetyDeduction < 0) {
        issues.push("at least one key safety feature appears to be missing or unlisted");
    }
    const upsell = " Improving your trust profile takes the right strategy — from encouraging more positive reviews to optimising your response patterns. Our experts can provide hands-on guidance to help you strengthen these signals and drive more demand.";
    if (issues.length === 0) {
        return `Your trust signals are building but haven't yet reached the level where they actively work in your favour. Even small gaps here can have a disproportionate effect on your overall performance.${upsell}`;
    }
    const topIssues = issues.slice(0, 3);
    return `Your trust profile has gaps that are likely affecting bookings — ${joinList(topIssues)}. Weaknesses in trust have a disproportionate impact on both visibility and conversion.${upsell}`;
}

function buildCompetitiveMessage(weightedScore, maxWeight, data) {
    const upsell = " Expert pricing strategy can help you maximise occupancy and revenue — from dynamic pricing frameworks to competitive benchmarking, our team can ensure you're not leaving money on the table.";
    if (weightedScore / maxWeight >= 0.8) {
        return "Your competitive positioning is strong — your pricing shows smart variation, your calendar signals demand, and your availability settings are well-calibrated. This is helping you maximise both bookings and revenue.";
    }
    if (data.noData) {
        return "We weren't able to fully analyse your pricing and availability data for this listing. Without this data, your competitive positioning score is limited.";
    }
    const issues = [];
    if (data.signals.flatPricingDetection < 0) {
        issues.push("your pricing appears to be completely flat across your calendar, which signals to Airbnb's algorithm that the listing may not be actively managed");
    }
    if (data.signals.weekendPriceUplift === 0 && data.signals.flatPricingDetection >= 0) {
        issues.push("no weekend price uplift was detected, meaning you may be undercharging on your highest-demand nights");
    }
    if (data.signals.seasonalPricingShifts === 0 && data.signals.flatPricingDetection >= 0) {
        issues.push("no seasonal pricing variation was detected, which suggests the listing isn't capturing peak-period revenue");
    }
    if (data.signals.longGaps < 0) {
        issues.push("your calendar has large blocks of consecutive open dates, which can signal low demand and push your listing lower in search");
    }
    if (data.signals.weekendAvailability < 0) {
        issues.push("most of your weekends in the next 30 days are still open — unusual for well-performing listings and often a sign of pricing or positioning issues");
    }
    if (data.signals.minimumStay <= -10) {
        const avgMin = data.meta?.avgMinNights;
        const minText = avgMin ? ` (averaging ${avgMin} nights)` : "";
        issues.push(`your minimum stay requirement is high${minText}, which significantly reduces the pool of guests who can book`);
    }
    if (data.signals.avail0to10 < 0) {
        issues.push("your near-term availability (next 10 days) is wide open, which often indicates pricing issues or weak demand signals");
    }
    if (issues.length === 0) {
        return `Your pricing and availability strategy shows some positive signals, but isn't yet optimised to the level of top-performing listings in most markets. Even moderate improvements here could have a meaningful impact on revenue.${upsell}`;
    }
    const topIssues = issues.slice(0, 3);
    return `Your competitive positioning has issues that are likely costing you revenue — ${joinList(topIssues)}. These signals directly affect both your search ranking and earning potential.${upsell}`;
}

function buildCategoryMessages(breakdown, titleData, descriptionData, photoData, amenityData, trustData, competitiveData) {
    return {
          category_messages: [
            {
                      category: "Title",
                      weight: "10%",
                      score: breakdown.title,
                      message: buildTitleMessage(breakdown.title, BUCKET_WEIGHTS.title, titleData),
            },
            {
                      category: "Description",
                      weight: "10%",
                      score: breakdown.description,
                      message: buildDescriptionMessage(breakdown.description, BUCKET_WEIGHTS.description, descriptionData),
            },
            {
                      category: "Photos",
                      weight: "10%",
                      score: breakdown.photos,
                      message: buildPhotoMessage(breakdown.photos, BUCKET_WEIGHTS.photos, photoData),
            },
            {
                      category: "Amenities",
                      weight: "10%",
                      score: breakdown.amenities,
                      message: buildAmenityMessage(breakdown.amenities, BUCKET_WEIGHTS.amenities, amenityData),
            },
            {
                      category: "Trust",
                      weight: "30%",
                      score: breakdown.trust,
                      message: buildTrustMessage(breakdown.trust, BUCKET_WEIGHTS.trust, trustData),
            },
            {
                      category: "Competitive positioning",
                      weight: "30%",
                      score: breakdown.competitive,
                      message: buildCompetitiveMessage(breakdown.competitive, BUCKET_WEIGHTS.competitive, competitiveData),
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
          .eq("provider", "hasdata")
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

      const summaryPayload = buildCategoryMessages(breakdown, titleData, descriptionData, photoData, amenityData, trustData, competitiveData);
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
