// /pages/api/result.js
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
})

function setCorsHeaders(req, res) {
    const origin = req.headers.origin || ""

    const allowedOrigins = [
        "https://www.letgrow.co.uk",
        "https://letgrow.co.uk",
        "https://letgrow-api.vercel.app",
        "http://localhost:3000",
    ]

    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin)
    } else {
        res.setHeader("Access-Control-Allow-Origin", "https://www.letgrow.co.uk")
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function getInputValue(value) {
    if (Array.isArray(value)) return value[0]
    return value
}

function safeJsonParse(value) {
    if (!value) return null
    if (typeof value === "object") return value

    if (typeof value === "string") {
        try {
            return JSON.parse(value)
        } catch {
            return null
        }
    }

    return null
}

function mapSubmissionStatus(status) {
    const s = String(status || "").toLowerCase()

    if (["complete", "done"].includes(s)) return "complete"
    if (["scored"].includes(s)) return "analysing"
    if (["failed", "error"].includes(s)) return "error"

    return "loading"
}

function buildLoadingSteps(status) {
    const s = String(status || "").toLowerCase()

    return [
        { key: "submitted", label: "Submitting your listing", done: true },
        {
            key: "fetching",
            label: "Checking title, photos and amenities",
            done: ["fetched", "complete", "scored", "done"].includes(s),
        },
        {
            key: "scoring",
            label: "Calculating your LetGrow score",
            done: ["complete", "scored", "done"].includes(s),
        },
        {
            key: "finalising",
            label: "Preparing your results",
            done: ["complete", "scored", "done"].includes(s),
        },
    ]
}

function normaliseMessages(summary, overallScore = 0) {
    const parsed = safeJsonParse(summary) || {}
    const categoryMessages = Array.isArray(parsed.category_messages)
        ? parsed.category_messages
        : []

    const mappedFromArray = {}

    for (const item of categoryMessages) {
        const category = String(item?.category || "").toLowerCase()
        const message = String(item?.message || "").trim()

        if (!message) continue

        if (category.includes("title")) mappedFromArray.title = message
        else if (category.includes("description")) mappedFromArray.description = message
        else if (category.includes("photo")) mappedFromArray.photos = message
        else if (category.includes("amenit")) mappedFromArray.amenities = message
        else if (category.includes("trust")) mappedFromArray.trust = message
        else if (category.includes("competitive"))
            mappedFromArray.competitive_positioning = message
    }

    return {
        title:
            parsed.title ||
            mappedFromArray.title ||
            "Your title is helping the listing communicate its value more clearly in search results.",
        description:
            parsed.description ||
            mappedFromArray.description ||
            "Your description is supporting the listing reasonably well and helping guests understand the stay.",
        photos:
            parsed.photos ||
            mappedFromArray.photos ||
            "Your photo set is giving guests useful visual context and supporting booking confidence.",
        amenities:
            parsed.amenities ||
            mappedFromArray.amenities ||
            "Your amenities are supporting the listing reasonably well against similar properties.",
        trust:
            parsed.trust ||
            mappedFromArray.trust ||
            "Your trust signals are helping guests feel more confident about booking.",
        competitive_positioning:
            parsed.competitive_positioning ||
            mappedFromArray.competitive_positioning ||
            "Your listing is communicating its value reasonably clearly against competing properties.",
    }
}

function extractProofSignals(scoreRow, summary) {
    const parsed = safeJsonParse(summary) || {}
    const detectedSignals = parsed?.detected_signals || {}
    const nestedSignals = parsed?.signals?.extracted_fields || {}

    return {
        photo_count:
            scoreRow?.detected_photo_count ??
            detectedSignals?.photos_detected ??
            nestedSignals?.photos_detected ??
            null,
        review_count:
            scoreRow?.detected_review_count ??
            detectedSignals?.reviews_detected ??
            nestedSignals?.reviews ??
            null,
        rating:
            scoreRow?.detected_rating ??
            detectedSignals?.rating_detected ??
            nestedSignals?.rating ??
            null,
    }
}

export default async function handler(req, res) {
    setCorsHeaders(req, res)

    if (req.method === "OPTIONS") {
        return res.status(200).end()
    }

    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" })
    }

    try {
        const jobId =
            getInputValue(req.query?.job_id) ||
            getInputValue(req.query?.jobId) ||
            null

        if (!jobId) {
            return res.status(400).json({
                success: false,
                error: "job_id is required",
            })
        }

        const { data: submission, error: submissionError } = await supabase
            .from("listing_submissions")
            .select("*")
            .eq("job_id", jobId)
            .maybeSingle()

        if (submissionError) {
            console.error("Result submission lookup error:", submissionError)
            return res.status(500).json({
                success: false,
                error: "Failed to load submission",
            })
        }

        if (!submission) {
            return res.status(404).json({
                success: false,
                job_id: jobId,
                status: "error",
                error: "Job not found",
            })
        }

        const tier = submission.tier || "free"
        const state = mapSubmissionStatus(submission.status)

        if (state === "analysing") {
            return res.status(200).json({
                success: true,
                job_id: submission.job_id,
                submission_id: submission.id,
                status: "loading",
                tier,
                status_message: "Your score is ready — generating your full expert analysis...",
                steps: [
                    ...buildLoadingSteps("complete"),
                    { key: "analysing", label: "Generating expert analysis and recommendations", done: false },
                ],
            })
        }

        if (state === "loading") {
            return res.status(200).json({
                success: true,
                job_id: submission.job_id,
                submission_id: submission.id,
                status: "loading",
                status_message:
                    submission.status_message || "Your listing is still being analysed.",
                steps: buildLoadingSteps(submission.status),
            })
        }

        if (state === "error") {
            return res.status(200).json({
                success: false,
                job_id: submission.job_id,
                submission_id: submission.id,
                status: "error",
                error: submission.status_message || "We couldn't generate your score.",
            })
        }

        const { data: scoreRows, error: scoreError } = await supabase
            .from("listing_scores")
            .select("*")
            .eq("submission_id", submission.id)
            .order("scored_at", { ascending: false })
            .limit(1)

        if (scoreError) {
            console.error("Result score lookup error:", scoreError)
            return res.status(500).json({
                success: false,
                error: "Failed to load score result",
            })
        }

        const scoreRow = scoreRows?.[0]

        if (!scoreRow) {
            return res.status(200).json({
                success: true,
                job_id: submission.job_id,
                submission_id: submission.id,
                status: "loading",
                status_message: "Your score is still being finalised.",
                steps: buildLoadingSteps("fetched"),
            })
        }

        const messages = normaliseMessages(scoreRow.summary, scoreRow.overall_score)
        const proofSignals = extractProofSignals(scoreRow, scoreRow.summary)

        const result = {
            overall_score: scoreRow.overall_score,
            score_label: scoreRow.score_label,
            messages,
            proof_signals: proofSignals,
            scored_at: scoreRow.scored_at,
            scoring_version: scoreRow.scoring_version,
        }

        // For pro/premium tiers, include analysis data
        if (tier === "pro" || tier === "premium") {
            const { data: analysisRow } = await supabase
                .from("listing_analyses")
                .select("*")
                .eq("submission_id", submission.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()

            if (analysisRow && analysisRow.status === "complete") {
                result.pro_analysis = {
                    rewritten_title: analysisRow.rewritten_title,
                    rewritten_title_score: analysisRow.rewritten_title_score,
                    rewritten_description: analysisRow.rewritten_description,
                    rewritten_description_score: analysisRow.rewritten_description_score,
                    original_title_score: analysisRow.original_title_score,
                    original_description_score: analysisRow.original_description_score,
                    review_themes: analysisRow.review_themes,
                    strengths: analysisRow.strengths,
                    revenue_leaks: analysisRow.revenue_leaks,
                    instant_fixes: analysisRow.instant_fixes,
                    overall_improvements: analysisRow.overall_improvements,
                    seven_day_plan: analysisRow.seven_day_plan,
                    click_through_suggestions: analysisRow.click_through_suggestions,
                    amenity_suggestions: analysisRow.amenity_suggestions,
                    positioning_summary: analysisRow.positioning_summary,
                    analysed_at: analysisRow.analysed_at,
                }
            }
        }

        return res.status(200).json({
            success: true,
            job_id: submission.job_id,
            submission_id: submission.id,
            status: "complete",
            tier,
            result,
        })
    } catch (error) {
        console.error("Unhandled error in result endpoint:", error)
        return res.status(500).json({
            success: false,
            error: "Server error",
        })
    }
}
