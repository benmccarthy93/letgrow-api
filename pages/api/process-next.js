// /pages/api/process-next.js
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET
const HASDATA_API_KEY = process.env.HASDATA_API_KEY
const HASDATA_PROPERTY_API_URL = process.env.HASDATA_PROPERTY_API_URL

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
})

function getInputValue(value) {
    if (Array.isArray(value)) return value[0]
    return value
}

function truncate(value, max = 250) {
    return String(value || "").slice(0, max)
}

function getBaseUrl(req) {
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`

    const host = req.headers.host
    const protocol =
        host && host.includes("localhost") ? "http" : "https"

    return `${protocol}://${host}`
}

function isAuthorised(req) {
    const headerSecret =
        req.headers["x-internal-secret"] ||
        req.headers["x-api-internal-secret"]

    return (
        INTERNAL_API_SECRET &&
        String(headerSecret || "") === String(INTERNAL_API_SECRET)
    )
}

async function markSubmission(submissionId, status, statusMessage) {
    await supabase
        .from("listing_submissions")
        .update({
            status,
            status_message: truncate(statusMessage),
        })
        .eq("id", submissionId)
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
    ])
}

async function fetchHasDataProperty(normalisedUrl) {
    if (!HASDATA_API_KEY) {
        throw new Error("Missing HASDATA_API_KEY env var")
    }

    if (!HASDATA_PROPERTY_API_URL) {
        throw new Error("Missing HASDATA_PROPERTY_API_URL env var")
    }

    const requestUrl = `${HASDATA_PROPERTY_API_URL}?${new URLSearchParams({
        url: normalisedUrl,
    }).toString()}`

    const response = await fetch(requestUrl, {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${HASDATA_API_KEY}`,
            "x-api-key": HASDATA_API_KEY,
        },
    })

    let raw
    try {
        raw = await response.json()
    } catch {
        raw = { error: "Non-JSON response from HasData" }
    }

    return {
        ok: response.ok,
        status: response.status,
        requestUrl,
        raw,
    }
}

async function triggerScoreNext(req, jobId) {
    const baseUrl = getBaseUrl(req)

    const response = await fetch(`${baseUrl}/api/score-next`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_API_SECRET,
        },
        body: JSON.stringify({
            job_id: jobId,
        }),
    })

    let data = null
    try {
        data = await response.json()
    } catch {
        data = null
    }

    return {
        ok: response.ok,
        status: response.status,
        data,
    }
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed",
        })
    }

    if (!isAuthorised(req)) {
        return res.status(401).json({
            success: false,
            error: "Unauthorised",
        })
    }

    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return res.status(500).json({
                success: false,
                error: "Missing Supabase env vars",
            })
        }

        const body = req.body && typeof req.body === "object" ? req.body : {}
        const query = req.query || {}

        const jobId =
            getInputValue(body.job_id) ||
            getInputValue(query.job_id) ||
            null

        const submissionId =
            getInputValue(body.submission_id) ||
            getInputValue(query.submission_id) ||
            null

        let submissionQuery = supabase
            .from("listing_submissions")
            .select("*")

        if (submissionId) {
            submissionQuery = submissionQuery.eq("id", submissionId)
        } else if (jobId) {
            submissionQuery = submissionQuery.eq("job_id", jobId)
        } else {
            submissionQuery = submissionQuery
                .eq("status", "pending")
                .order("created_at", { ascending: true })
                .limit(1)
        }

        const { data: submissionRows, error: submissionError } =
            await submissionQuery

        if (submissionError) {
            console.error("Submission lookup error:", submissionError)
            return res.status(500).json({
                success: false,
                error: "Failed to fetch submission",
            })
        }

        const submission = Array.isArray(submissionRows)
            ? submissionRows[0]
            : submissionRows

        if (!submission) {
            return res.status(404).json({
                success: false,
                error: "No matching submission found",
            })
        }

        if (!submission.normalised_url) {
            await markSubmission(
                submission.id,
                "failed",
                "Missing normalised_url on submission"
            )

            return res.status(400).json({
                success: false,
                error: "Submission is missing normalised_url",
                submission_id: submission.id,
                job_id: submission.job_id,
            })
        }

        await markSubmission(
            submission.id,
            "processing",
            "Fetching listing data"
        )

        const hasDataResult = await fetchHasDataProperty(
            submission.normalised_url
        )

        if (!hasDataResult.ok) {
            await insertFetchRow({
                submissionId: submission.id,
                fetchStatus: "failed",
                provider: "hasdata",
                requestUrl: hasDataResult.requestUrl,
                rawResponse: hasDataResult.raw,
            })

            await markSubmission(
                submission.id,
                "failed",
                `Fetch failed (${hasDataResult.status})`
            )

            return res.status(502).json({
                success: false,
                error: "HasData fetch failed",
                submission_id: submission.id,
                job_id: submission.job_id,
                provider_status: hasDataResult.status,
                raw_response: hasDataResult.raw,
            })
        }

        const { error: fetchInsertError } = await insertFetchRow({
            submissionId: submission.id,
            fetchStatus: "success",
            provider: "hasdata",
            requestUrl: hasDataResult.requestUrl,
            rawResponse: hasDataResult.raw,
        })

        if (fetchInsertError) {
            console.error("Fetch row insert error:", fetchInsertError)

            await markSubmission(
                submission.id,
                "failed",
                "Fetched listing data but failed to store fetch row"
            )

            return res.status(500).json({
                success: false,
                error: "Failed to store fetch row",
            })
        }

        await markSubmission(
            submission.id,
            "fetched",
            "Listing data fetched successfully"
        )

        const scoreTrigger = await triggerScoreNext(req, submission.job_id)

        if (!scoreTrigger.ok) {
            console.error("Score trigger failed:", scoreTrigger)

            await markSubmission(
                submission.id,
                "fetched",
                "Fetched successfully but scoring trigger failed"
            )

            return res.status(502).json({
                success: false,
                error: "Fetch completed but scoring trigger failed",
                submission_id: submission.id,
                job_id: submission.job_id,
                score_trigger_status: scoreTrigger.status,
                score_trigger_response: scoreTrigger.data,
            })
        }

        return res.status(200).json({
            success: true,
            submission_id: submission.id,
            job_id: submission.job_id,
            processed_by: jobId || submissionId ? "targeted" : "oldest_pending",
            fetch_status: "success",
            score_triggered: true,
            score_response: scoreTrigger.data,
        })
    } catch (error) {
        console.error("Unhandled error in process-next:", error)

        return res.status(500).json({
            success: false,
            error: error.message || "Server error",
        })
    }
}
