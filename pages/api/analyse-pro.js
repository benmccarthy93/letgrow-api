// /pages/api/analyse-pro.js
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { queueEmail } from "./lib/email-queue.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const ANALYSIS_VERSION = "v1_pro";

// -----------------------------
// Scoring rules (mirrored from score-next.js so Claude knows exactly how to beat them)
// -----------------------------
const TITLE_SCORING_RULES = `
TITLE SCORING RULES (max 20 points):
- HARD LIMIT: Airbnb allows a MAXIMUM of 50 characters including spaces for the title. Never exceed this.
- Length points: ≥35 characters = 10pts, ≥30 characters = 5pts, <30 characters = 0pts
- Keyword points: ≥5 keyword matches = 10pts, ≥4 = 7pts, ≥3 = 3pts, ≥2 = 1pt, <2 = 0pts
- ALL CAPS deduction: if entire title is uppercase, -10pts
- Final score = clamp(lengthPoints + keywordPoints - capsDeduction, 0, 20)

STRATEGY: You have exactly 50 characters to work with. Every character matters. Pack in 5+ keywords naturally while hitting ≥35 chars. Use "&" instead of "and", abbreviate where natural (e.g. "w/" for "with", "nr" for "near"). Lead with the strongest differentiator.

KEYWORDS THAT COUNT (case-insensitive, partial match):
Cities: london, manchester, birmingham, edinburgh, glasgow, liverpool, bristol, leeds, sheffield, newcastle, cardiff, nottingham, cambridge, oxford, brighton, bath, york, coventry, leicester, reading, southampton, portsmouth, dundee, aberdeen, norwich, exeter, chester, inverness
Property types: penthouse, studio, apartment, loft, house, cottage, cabin, villa, barn, chalet, townhouse, duplex, bungalow, lodge, flat, retreat
Location: city centre, seaside, riverside, central, quiet, countryside, mountain view, lake view, waterfront, near beach, close to public transport, beachfront, near train station
Quality: luxury, spacious, stylish, modern, boutique, elegant, chic
Amenities in title: hot tub, sauna, pool, free parking, free wi-fi, balcony, fireplace, garden, patio
Guest type: family-friendly, pet-friendly, romantic getaway, business travel, city break, group stay
Features: fully furnished, newly renovated, bright and airy, modern design, spacious living
`;

const DESCRIPTION_SCORING_RULES = `
DESCRIPTION SCORING RULES (max 30 points):
- HARD LIMIT: Airbnb allows a MAXIMUM of 500 characters including spaces for the listing description. Never exceed this.
- Length points: >400 characters = 10pts, ≥350 = 8pts, ≥300 = 3pts, <300 = 0pts
- Keyword points: ≥15 keyword matches = 20pts, ≥12 = 15pts, ≥10 = 10pts, ≥7 = 5pts, ≥4 = 2pts, <4 = 0pts
- Same keyword list as title scoring (cities, property types, locations, quality, amenities, guest types, features)
- Final score = clamp(lengthPoints + keywordPoints, 0, 30)

STRATEGY: You have 500 characters max. Aim for 420-490 characters. Every line must earn its place. Open with a punchy hook (who is this for + why it's special). Use emojis sparingly if the original listing uses them. Pack keywords naturally throughout — they should flow, never feel forced.

CRITICAL: The description MUST:
1. Be between 400-500 characters to get maximum length points (10pts) WITHOUT exceeding 500
2. Naturally include at least 15 different keywords from the list to get maximum keyword points (20pts)
3. Not be stuffed with keywords unnaturally — they must read well and compel guests to book
`;

const YOUR_PROPERTY_RULES = `
"YOUR PROPERTY" SECTION RULES:
- This is a SEPARATE section on Airbnb called "Your property" — it has NO character limit
- Purpose: "Share a general description of your property's rooms and spaces so guests know what to expect"
- This is where you put the detailed room-by-room breakdown, amenity highlights, and practical details
- Use this section to include all the keyword-rich detail that won't fit in the 500-char description
- Structure it clearly with sections for each room/space
- Include practical details: bed types, kitchen equipment, bathroom features, storage, workspace setup
- Mention transport links, local attractions, parking details here
- This is your chance to sell every aspect of the property in detail
`;

// These are ONLY used as reference data passed to Claude — Claude decides what's
// appropriate based on property type, location, and context.
const AMENITY_REFERENCE = {
    // Safety (always appropriate for any property)
    co2_alarm: { name: "Carbon monoxide alarm", cost: "~£5-10", note: "Enables the safety tick even with no CO sources — £5 for a trust boost" },
    fire_extinguisher: { name: "Fire extinguisher", cost: "~£10-15", note: "Boosts trust score significantly" },
    first_aid_kit: { name: "First aid kit", cost: "~£5-10", note: "Cheap safety tick" },
    smoke_alarm: { name: "Smoke alarm", cost: "~£5-10", note: "Often legally required" },

    // Universal essentials (appropriate for almost any property)
    hairdryer: { name: "Hairdryer", cost: "~£10-15", note: "Guests actively filter for this" },
    iron: { name: "Iron and ironing board", cost: "~£15-25", note: "Business travellers and longer stays" },
    coffee_maker: { name: "Coffee machine (pod or filter)", cost: "~£20-40", note: "Frequently praised in reviews" },
    extra_pillows: { name: "Extra pillows and blankets", cost: "~£15-30", note: "Comfort upgrade praised in reviews" },
    cooking_basics: { name: "Cooking basics (oil, salt, pepper, spices)", cost: "~£5-10", note: "Guests hate an empty kitchen" },
    books: { name: "Books / reading material", cost: "~£0-10 (charity shop)", note: "Adds character" },

    // Family (appropriate if property can sleep 3+ or has space)
    travel_cot: { name: "Travel cot", cost: "~£30", note: "Opens you to family bookings" },
    high_chair: { name: "High chair", cost: "~£15-25", note: "Essential for family guests" },
    cot: { name: "Cot/crib", cost: "~£40-80", note: "Parents actively filter for this" },

    // Work (appropriate for city/urban/apartment properties)
    workspace: { name: "Dedicated workspace / desk", cost: "~£30-60", note: "Remote workers and business travellers" },

    // Outdoor (ONLY appropriate if property has outdoor space, garden, or is rural)
    bbq: { name: "BBQ/grill", cost: "~£30-80", note: "ONLY if garden/outdoor space exists" },
    ev_charger: { name: "EV charger", cost: "~£300-800 (installed)", note: "ONLY if parking is available" },

    // Premium (NEVER suggest for city apartments or small flats)
    // hot_tub, sauna, pool — these are NOT in the suggestions list because they are
    // unrealistic for most properties. Claude should never suggest installing these.
};

// -----------------------------
// Helpers
// -----------------------------
function isAuthorised(req) {
    const headerSecret = req.headers["x-internal-secret"] || req.headers["x-api-internal-secret"];
    return INTERNAL_API_SECRET && String(headerSecret || "") === String(INTERNAL_API_SECRET);
}

function getInputValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 4096) {
    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1].trim());
    }

    // Try parsing the whole response as JSON
    return JSON.parse(text.trim());
}

// -----------------------------
// Claude Call #1: Title + Description Rewrite
// -----------------------------
async function rewriteTitleAndDescription(listing) {
    const systemPrompt = `You are an expert Airbnb listing copywriter and SEO specialist. Your job is to rewrite listing titles, descriptions, and the "Your property" section so they score MAXIMUM points on our internal scoring system while also being genuinely compelling for guests.

You MUST follow the scoring rules EXACTLY. Your rewritten title and description should score the maximum possible points.

${TITLE_SCORING_RULES}

${DESCRIPTION_SCORING_RULES}

${YOUR_PROPERTY_RULES}

IMPORTANT RULES:
1. The rewritten title MUST be ≤50 characters AND score 20/20 (≥35 chars + ≥5 keywords + not all caps)
2. The rewritten description MUST be ≤500 characters AND score 30/30 (>400 chars + ≥15 keywords)
3. The "Your property" section has NO character limit — use it to add all the rich detail
4. Both title and description must read naturally and be compelling — no keyword stuffing
5. Preserve the property's actual features, location, and character — never invent amenities or features the listing doesn't have
6. Use British English spelling
7. The title should lead with the strongest differentiator
8. The description should open with a punchy hook that tells guests exactly who this is for and why it's special
9. Emojis are OK in the description if the original listing uses them, but use sparingly

Respond with ONLY valid JSON, no markdown code blocks.`;

    const userPrompt = `Rewrite this Airbnb listing's title, description, and "Your property" section to score maximum points.

CURRENT TITLE: "${listing.title || "No title"}"
CURRENT DESCRIPTION: "${listing.description || "No description"}"

PROPERTY DETAILS:
- Type: ${listing.propertyType || "Unknown"}
- Room type: ${listing.roomType || "Entire place"}
- Location: ${listing.location || "Unknown"}
- Bedrooms: ${listing.bedrooms || "Unknown"}
- Beds: ${listing.beds || "Unknown"}
- Bathrooms: ${listing.bathrooms || "Unknown"}
- Max guests: ${listing.maxGuests || "Unknown"}
- Rating: ${listing.rating || "N/A"} (${listing.reviewCount || 0} reviews)

KEY AMENITIES PRESENT: ${(listing.amenitiesPresent || []).join(", ") || "None listed"}
KEY AMENITIES MISSING: ${(listing.amenitiesMissing || []).join(", ") || "None"}

Respond with this JSON structure:
{
  "rewritten_title": "the new title (MUST be ≤50 characters AND ≥35 characters with ≥5 keywords)",
  "title_keyword_count": <number of scoring keywords in new title>,
  "title_character_count": <character count — MUST be ≤50>,
  "title_rationale": "Brief explanation of why this title scores higher and converts better",
  "rewritten_description": "the full new description (MUST be ≤500 characters AND >400 characters with ≥15 keywords)",
  "description_keyword_count": <number of scoring keywords in new description>,
  "description_character_count": <character count — MUST be ≤500>,
  "description_rationale": "Brief explanation of improvements made",
  "rewritten_your_property": "Full rewritten 'Your property' section — detailed room-by-room breakdown with all the rich detail, amenity highlights, transport links, local attractions, practical info. No character limit. Make this comprehensive and keyword-rich.",
  "before_after_summary": "One sentence summarising the key improvement"
}`;

    return callClaude(systemPrompt, userPrompt, 4096);
}

// -----------------------------
// Claude Call #2: Review Theme Analysis
// -----------------------------
async function analyseReviews(reviews, listing) {
    if (!reviews || reviews.length === 0) {
        return {
            positive_themes: [],
            negative_themes: [],
            recurring_issues: [],
            sentiment_summary: "No reviews available for analysis.",
            fix_suggestions: [],
            review_count_analysed: 0,
        };
    }

    const systemPrompt = `You are an expert at analysing Airbnb guest reviews to extract actionable insights for hosts. You identify patterns, recurring issues, and sentiment trends that can directly improve listing performance.

Your analysis should be specific, actionable, and commercially focused. Not generic advice — real patterns from real reviews.

Use British English spelling.

Respond with ONLY valid JSON, no markdown code blocks.`;

    const reviewTexts = reviews
        .map((r, i) => {
            const rating = r.rating ? ` (${r.rating}★)` : "";
            const date = r.created_at ? ` [${r.created_at}]` : "";
            return `Review ${i + 1}${rating}${date}: "${r.text || "No text"}"`;
        })
        .join("\n\n");

    const userPrompt = `Analyse these ${reviews.length} guest reviews for an Airbnb listing.

LISTING: "${listing.title}" in ${listing.location || "Unknown location"}
RATING: ${listing.rating || "N/A"} / 5

REVIEWS:
${reviewTexts}

Provide a thorough analysis with this JSON structure:
{
  "review_count_analysed": ${reviews.length},
  "positive_themes": [
    {
      "theme": "What guests consistently praise",
      "frequency": "How many reviews mention this",
      "example_quote": "Direct quote from a review",
      "leverage_suggestion": "How the host can emphasise this strength in their listing"
    }
  ],
  "negative_themes": [
    {
      "theme": "What guests consistently complain about",
      "frequency": "How many reviews mention this",
      "example_quote": "Direct quote from a review",
      "severity": "minor|moderate|major",
      "fix_suggestions": {
        "cheap": "Budget fix option with estimated cost",
        "fast": "Quick fix that can be done this week",
        "premium": "Investment-level fix for best results"
      }
    }
  ],
  "recurring_issues": [
    {
      "issue": "Specific recurring problem",
      "times_mentioned": <number>,
      "appears_resolved": false,
      "urgency": "low|medium|high",
      "impact_on_bookings": "How this likely affects conversion"
    }
  ],
  "sentiment_summary": "2-3 sentence summary of overall guest sentiment and trends over time",
  "expectation_gaps": [
    "Things mentioned in reviews that are NOT addressed in the listing description"
  ],
  "review_response_suggestions": [
    "Specific suggestions for how the host should respond to common review themes"
  ]
}

Include at least 3 positive themes and identify ALL negative patterns, even minor ones. For each negative theme, always provide the 3-tier fix suggestion (cheap/fast/premium).`;

    return callClaude(systemPrompt, userPrompt, 4096);
}

// -----------------------------
// Claude Call #3: Full Assessment + Action Plan
// -----------------------------
async function buildFullAssessment(listing, scores, rewriteResult, reviewThemes) {
    const systemPrompt = `You are a senior Airbnb performance consultant who manages 100+ properties. You provide expert-level assessments that are specific, actionable, and commercially valuable.

Your recommendations must be REALISTIC and TAILORED to the specific property type and context:
- City apartment? Suggest a desk for remote workers, not a hot tub or BBQ.
- Rural cottage? A BBQ and outdoor seating makes sense, a dedicated workspace probably doesn't.
- Family home? Travel cot and high chair are obvious wins. But not for a romantic studio.
- 1-bed flat? Don't suggest things that need outdoor space or a garage.

NEVER suggest unrealistic amenities. A city flat cannot add a pool, sauna, hot tub, or BBQ. Think about what the host can ACTUALLY buy on Amazon for under £50 that will open a new market or solve a guest complaint.

Be clever and specific. The best recommendations are ones the host wouldn't think of themselves:
- "Buy a £5 CO alarm even though you have no gas — it enables the safety tick on Airbnb"
- "A £3 pack of earplugs in the bedside drawer pre-empts noise complaints before they happen"
- "A £12 Bluetooth speaker turns a basic flat into a lifestyle stay"
- "A laminated card with local restaurant recommendations costs nothing and gets mentioned in reviews"
- "A £15 luggage rack stops guests putting suitcases on your bed"
- "A USB charging station by the bed (£8) is the kind of detail guests photograph and praise"

Use British English spelling.

Respond with ONLY valid JSON, no markdown code blocks.`;

    const missingAmenityDetails = (listing.amenitiesMissing || [])
        .map((key) => {
            const ref = AMENITY_REFERENCE[key];
            if (ref) return `${key}: ${ref.name} (${ref.cost}) - ${ref.note}`;
            return key;
        })
        .join("\n");

    const userPrompt = `Provide a comprehensive Pro-level assessment of this Airbnb listing.

LISTING: "${listing.title}"
LOCATION: ${listing.location || "Unknown"}
TYPE: ${listing.propertyType || "Unknown"} (${listing.roomType || "Entire place"})
CAPACITY: ${listing.maxGuests || "?"} guests, ${listing.bedrooms || "?"} bedrooms, ${listing.beds || "?"} beds, ${listing.bathrooms || "?"} bathrooms
RATING: ${listing.rating || "N/A"} / 5 (${listing.reviewCount || 0} reviews)
SUPERHOST: ${listing.isSuperhost ? "Yes" : "No"}

CURRENT SCORES (out of 100):
- Overall: ${scores.overall}/100 (${scores.label})
- Title: ${scores.titleWeighted}/10 (internal ${scores.titleInternal}/${scores.titleMax})
- Description: ${scores.descWeighted}/10 (internal ${scores.descInternal}/${scores.descMax})
- Photos: ${scores.photoWeighted}/10 (${scores.photoCount} photos)
- Amenities: ${scores.amenityWeighted}/10 (${scores.amenityCount} amenities)
- Trust: ${scores.trustWeighted}/30
- Competitive: ${scores.competitiveWeighted}/30

REWRITTEN TITLE: "${rewriteResult?.rewritten_title || "N/A"}"
REWRITTEN DESCRIPTION AVAILABLE: ${rewriteResult?.rewritten_description ? "Yes" : "No"}

MISSING AMENITIES FROM OUR SCORING (reference only — only suggest ones that are REALISTIC for this property type):
${missingAmenityDetails || "None identified"}

AMENITIES ALREADY PRESENT: ${(listing.amenitiesPresent || []).join(", ")}

REVIEW THEMES SUMMARY:
${reviewThemes?.sentiment_summary || "No review data available"}
Positive: ${(reviewThemes?.positive_themes || []).map((t) => t.theme).join("; ") || "None"}
Negative: ${(reviewThemes?.negative_themes || []).map((t) => t.theme).join("; ") || "None"}
Recurring issues: ${(reviewThemes?.recurring_issues || []).map((i) => i.issue).join("; ") || "None"}

Provide the assessment as JSON:
{
  "strengths": [
    {
      "area": "What's working well",
      "detail": "Specific explanation with evidence from the data",
      "recommendation": "How to leverage this strength further"
    }
  ],
  "revenue_leaks": [
    {
      "area": "What's costing bookings or revenue",
      "estimated_impact": "low|medium|high",
      "detail": "Specific explanation",
      "fix": "Exactly what to do about it"
    }
  ],
  "instant_fixes": [
    {
      "fix": "What to change right now",
      "time_estimate": "5 mins / 15 mins / 30 mins",
      "expected_impact": "What improvement this will drive",
      "instructions": "Step-by-step how to do it on Airbnb"
    }
  ],
  "overall_improvements": [
    {
      "improvement": "What to improve",
      "priority": "high|medium|low",
      "estimated_cost": "Free / £X-£Y",
      "estimated_time": "How long to implement",
      "expected_impact": "What improvement this will drive",
      "instructions": "How to implement this"
    }
  ],
  "seven_day_plan": [
    {
      "day": "Day 1",
      "focus": "What to focus on",
      "tasks": ["Specific task 1", "Specific task 2"],
      "time_needed": "Estimated time"
    }
  ],
  "click_through_suggestions": [
    {
      "suggestion": "How to improve click-through from search results",
      "rationale": "Why this will help based on how Airbnb search works",
      "action": "Exact action to take"
    }
  ],
  "amenity_suggestions": [
    {
      "amenity": "What to add (MUST be realistic for this property type)",
      "cost": "Estimated purchase cost in GBP",
      "market_opened": "What guest segment or behaviour this enables",
      "roi_explanation": "Why this specific addition is worth it for THIS property",
      "priority": "high|medium|low",
      "where_to_buy": "Specific suggestion (e.g. 'Amazon', 'Argos', 'local hardware store')"
    }
  ],
  "positioning_summary": "2-3 sentence assessment of where this listing sits in its market and what positioning strategy would maximise revenue"
}

REQUIREMENTS:
- Minimum 3 instant fixes (things doable in under 30 minutes)
- Minimum 5 overall improvements
- The 7-day plan MUST be specific to THIS listing's weakest areas — if photos are weakest, days 1-2 are photos; if description is strong, don't waste a day on it
- At least 3 click-through suggestions
- Amenity suggestions MUST be realistic for this property type — NEVER suggest hot tubs, saunas, pools, BBQs, or gardens for city apartments/flats
- Include at least 2 "clever" suggestions the host wouldn't think of themselves (e.g. USB charging station, luggage rack, laminated local guide, earplugs pack, Bluetooth speaker)
- Include a "total investment" line: sum up all amenity suggestions to show e.g. "For approximately £85 total, you can add 8 amenities that open up family and business traveller markets"
- Every suggestion must be specific to THIS property — generic advice = failure`;

    return callClaude(systemPrompt, userPrompt, 6000);
}

// -----------------------------
// Handler
// -----------------------------
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    if (!isAuthorised(req)) {
        return res.status(401).json({ error: "Unauthorised" });
    }

    if (!ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY env var" });
    }

    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const jobId = getInputValue(body.job_id) || null;
        const submissionId = getInputValue(body.submission_id) || null;

        if (!jobId && !submissionId) {
            return res.status(400).json({ error: "job_id or submission_id is required" });
        }

        // 1. Fetch submission
        let subQuery = supabase.from("listing_submissions").select("*");
        if (submissionId) subQuery = subQuery.eq("id", submissionId);
        else subQuery = subQuery.eq("job_id", jobId);

        const { data: submission, error: subErr } = await subQuery.maybeSingle();
        if (subErr || !submission) {
            return res.status(404).json({ error: "Submission not found" });
        }

        // 2. Fetch HasData raw response
        const { data: fetchRow } = await supabase
            .from("listing_fetches")
            .select("raw_response")
            .eq("submission_id", submission.id)
            .eq("fetch_status", "success")
            .eq("provider", "hasdata")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!fetchRow?.raw_response) {
            return res.status(400).json({ error: "No listing data found" });
        }

        const rawResponse = fetchRow.raw_response;
        const property = rawResponse.property || rawResponse.data?.property || rawResponse.listing || rawResponse.data?.listing || {};

        // 3. Fetch scores
        const { data: scoreRow } = await supabase
            .from("listing_scores")
            .select("*")
            .eq("submission_id", submission.id)
            .order("scored_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!scoreRow) {
            return res.status(400).json({ error: "No scores found — scoring must complete first" });
        }

        // 4. Fetch snapshot for structured data
        const { data: snapshot } = await supabase
            .from("listing_snapshots")
            .select("*")
            .eq("submission_id", submission.id)
            .limit(1)
            .maybeSingle();

        // Parse signals from score summary
        const summaryData = scoreRow.summary ? (typeof scoreRow.summary === "string" ? JSON.parse(scoreRow.summary) : scoreRow.summary) : {};
        const signals = summaryData.signals || {};

        // Build listing context object
        const listing = {
            title: property.title || snapshot?.title || "",
            description: property.description || snapshot?.description || "",
            propertyType: property.propertyType || property.property_type || snapshot?.property_type || "",
            roomType: property.roomType || property.room_type || snapshot?.room_type || "",
            location: property.location || property.city || snapshot?.location || "",
            bedrooms: property.bedrooms || snapshot?.bedroom_count || null,
            beds: property.beds || snapshot?.bed_count || null,
            bathrooms: property.bathrooms || snapshot?.bathroom_count || null,
            maxGuests: property.personCapacity || property.person_capacity || snapshot?.person_capacity || null,
            rating: scoreRow.detected_rating || null,
            reviewCount: scoreRow.detected_review_count || 0,
            isSuperhost: property.host?.isSuperhost || property.host?.is_superhost || false,
            amenitiesPresent: signals.amenities?.present || [],
            amenitiesMissing: signals.amenities?.missing || [],
            amenityCount: signals.amenities?.amenityCount || 0,
        };

        // Build scores context
        const scores = {
            overall: scoreRow.overall_score,
            label: scoreRow.score_label,
            titleWeighted: scoreRow.title_score,
            titleInternal: signals.title?.internal || 0,
            titleMax: signals.title?.max || 20,
            descWeighted: scoreRow.description_score,
            descInternal: signals.description?.internal || 0,
            descMax: signals.description?.max || 30,
            photoWeighted: scoreRow.photo_score,
            photoCount: scoreRow.detected_photo_count || 0,
            amenityWeighted: scoreRow.amenity_score,
            amenityCount: signals.amenities?.amenityCount || 0,
            trustWeighted: scoreRow.trust_score,
            competitiveWeighted: scoreRow.market_score,
        };

        // Extract reviews from snapshot or raw response
        let reviews = [];
        if (snapshot?.reviews_excerpt_json) {
            reviews = Array.isArray(snapshot.reviews_excerpt_json) ? snapshot.reviews_excerpt_json : [];
        } else {
            // Try extracting from raw response
            const reviewCandidates = [property.reviews, rawResponse.reviews, rawResponse.listing?.reviews];
            for (const candidate of reviewCandidates) {
                if (Array.isArray(candidate)) {
                    reviews = candidate.slice(0, 50).map((item) => {
                        if (typeof item === "string") return { text: item };
                        if (item && typeof item === "object") {
                            return {
                                text: item.text || item.comment || item.body || item.review || "",
                                rating: item.rating || item.score || null,
                                created_at: item.createdAt || item.date || null,
                            };
                        }
                        return null;
                    }).filter(Boolean);
                    break;
                }
            }
        }

        console.log(JSON.stringify({ event: "pipeline", stage: "analysis_start", job_id: submission.job_id, submission_id: submission.id, tier: submission.tier }));

        // Create analysis record
        const { data: analysisRow, error: insertErr } = await supabase
            .from("listing_analyses")
            .insert([{
                submission_id: submission.id,
                job_id: submission.job_id,
                tier: "pro",
                analysis_version: ANALYSIS_VERSION,
                original_title_score: signals.title || null,
                original_description_score: signals.description || null,
                status: "processing",
                status_message: "Analysis in progress",
            }])
            .select()
            .single();

        if (insertErr) {
            console.error("Analysis insert error:", insertErr);
            return res.status(500).json({ error: "Failed to create analysis record" });
        }

        // 5. Run the 3 Claude calls (1 & 2 in parallel, then 3 which depends on both)
        const rawResponses = {};
        let rewriteResult = null;
        let reviewThemes = null;
        let assessment = null;

        // Calls 1 & 2 are independent — run in parallel
        const [rewriteOutcome, reviewOutcome] = await Promise.allSettled([
            rewriteTitleAndDescription(listing),
            analyseReviews(reviews, listing),
        ]);

        if (rewriteOutcome.status === "fulfilled") {
            rewriteResult = rewriteOutcome.value;
            rawResponses.rewrite = rewriteResult;
        } else {
            console.error("Claude rewrite call failed:", rewriteOutcome.reason);
            rawResponses.rewrite_error = rewriteOutcome.reason?.message || String(rewriteOutcome.reason);
        }

        if (reviewOutcome.status === "fulfilled") {
            reviewThemes = reviewOutcome.value;
            rawResponses.reviews = reviewThemes;
        } else {
            console.error("Claude review analysis failed:", reviewOutcome.reason);
            rawResponses.reviews_error = reviewOutcome.reason?.message || String(reviewOutcome.reason);
        }

        // Call 3: Full Assessment + Action Plan (depends on calls 1 & 2)
        try {
            assessment = await buildFullAssessment(listing, scores, rewriteResult, reviewThemes);
            rawResponses.assessment = assessment;
        } catch (err) {
            console.error("Claude assessment call failed:", err);
            rawResponses.assessment_error = err.message;
        }

        // 6. Update analysis record with results
        const updatePayload = {
            rewritten_title: rewriteResult?.rewritten_title || null,
            rewritten_title_score: rewriteResult ? {
                keyword_count: rewriteResult.title_keyword_count,
                character_count: rewriteResult.title_character_count,
                rationale: rewriteResult.title_rationale,
            } : null,
            rewritten_description: rewriteResult?.rewritten_description || null,
            rewritten_description_score: rewriteResult ? {
                keyword_count: rewriteResult.description_keyword_count,
                character_count: rewriteResult.description_character_count,
                rationale: rewriteResult.description_rationale,
                before_after_summary: rewriteResult.before_after_summary,
            } : null,
            rewritten_your_property: rewriteResult?.rewritten_your_property || null,
            review_themes: reviewThemes || null,
            strengths: assessment?.strengths || null,
            revenue_leaks: assessment?.revenue_leaks || null,
            instant_fixes: assessment?.instant_fixes || null,
            overall_improvements: assessment?.overall_improvements || null,
            seven_day_plan: assessment?.seven_day_plan || null,
            click_through_suggestions: assessment?.click_through_suggestions || null,
            amenity_suggestions: assessment?.amenity_suggestions || null,
            positioning_summary: assessment?.positioning_summary || null,
            raw_responses: rawResponses,
            status: "complete",
            status_message: "Analysis complete",
            analysed_at: new Date().toISOString(),
        };

        const { error: updateErr } = await supabase
            .from("listing_analyses")
            .update(updatePayload)
            .eq("id", analysisRow.id);

        if (updateErr) {
            console.error("Analysis update error:", updateErr);
            return res.status(500).json({ error: "Failed to save analysis results" });
        }

        // Mark submission as complete (analyse-pro owns this for pro/premium tiers)
        const { error: submissionUpdateErr } = await supabase
            .from("listing_submissions")
            .update({ status: "complete", status_message: "Analysis complete" })
            .eq("id", submission.id);

        if (submissionUpdateErr) {
            console.error("Failed to update submission status:", submissionUpdateErr);
        }

        console.log(JSON.stringify({ event: "pipeline", stage: "analysis_complete", job_id: submission.job_id, submission_id: submission.id, tier: submission.tier, analysis_id: analysisRow.id }));

        // Queue email with tier-based delay (pro: 2-3.5hrs, premium: 2-8hrs)
        try {
            await queueEmail(supabase, {
                submissionId: submission.id,
                jobId: submission.job_id,
                tier: submission.tier || "pro",
                recipientEmail: submission.email,
                recipientName: submission.full_name,
            });
            console.log(JSON.stringify({ event: "pipeline", stage: "email_queued", job_id: submission.job_id, submission_id: submission.id, tier: submission.tier || "pro" }));
        } catch (emailErr) {
            console.error("Failed to queue pro/premium email:", emailErr);
        }

        return res.status(200).json({
            success: true,
            submission_id: submission.id,
            job_id: submission.job_id,
            analysis_id: analysisRow.id,
            status: "complete",
            rewritten_title: rewriteResult?.rewritten_title || null,
            review_themes_count: {
                positive: (reviewThemes?.positive_themes || []).length,
                negative: (reviewThemes?.negative_themes || []).length,
                recurring_issues: (reviewThemes?.recurring_issues || []).length,
            },
            instant_fixes_count: (assessment?.instant_fixes || []).length,
            improvements_count: (assessment?.overall_improvements || []).length,
        });
    } catch (e) {
        console.error("Unhandled error in analyse-pro:", e);

        // Mark analysis as failed so it doesn't stay stuck at "processing"
        try {
            const body = req.body && typeof req.body === "object" ? req.body : {};
            const jobId = getInputValue(body.job_id) || null;
            const submissionId = getInputValue(body.submission_id) || null;

            if (jobId || submissionId) {
                // Find the processing analysis record and mark it failed
                let analysisQuery = supabase.from("listing_analyses").select("id").eq("status", "processing");
                if (submissionId) analysisQuery = analysisQuery.eq("submission_id", submissionId);
                else if (jobId) analysisQuery = analysisQuery.eq("job_id", jobId);
                const { data: stuckAnalysis } = await analysisQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

                if (stuckAnalysis) {
                    await supabase.from("listing_analyses").update({
                        status: "failed",
                        status_message: `Analysis failed: ${e.message || "Server error"}`,
                    }).eq("id", stuckAnalysis.id);
                }

                // Also update submission status so it doesn't stay stuck
                let subQuery = supabase.from("listing_submissions").select("id");
                if (submissionId) subQuery = subQuery.eq("id", submissionId);
                else subQuery = subQuery.eq("job_id", jobId);
                const { data: sub } = await subQuery.maybeSingle();
                if (sub) {
                    await supabase.from("listing_submissions").update({
                        status: "failed",
                        status_message: `Analysis failed: ${e.message || "Server error"}`,
                    }).eq("id", sub.id);
                }
            }
        } catch (cleanupErr) {
            console.error("Failed to mark analysis as failed:", cleanupErr);
        }

        return res.status(500).json({ error: "Server error" });
    }
}
