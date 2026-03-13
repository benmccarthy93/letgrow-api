// /pages/api/admin.js
// Internal admin route for pipeline monitoring, debugging, and queue management.
// Authenticated via x-admin-secret header (falls back to INTERNAL_API_SECRET).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.INTERNAL_API_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

function isAuthorised(req) {
    const secret =
        req.headers["x-admin-secret"] ||
        req.headers["x-internal-secret"];
    return ADMIN_SECRET && String(secret || "") === String(ADMIN_SECRET);
}

// ---------------------------------------------------------------------------
// Action: pipeline-status
// Returns all submissions with their full pipeline state (fetch, score, analysis, email).
// ---------------------------------------------------------------------------
async function pipelineStatus({ status, tier, limit = 50, job_id, order = "desc" }) {
    const cappedLimit = Math.min(Number(limit) || 50, 200);

    // 1. Fetch submissions
    let query = supabase
        .from("listing_submissions")
        .select("id, job_id, email, full_name, tier, status, status_message, phone, airbnb_listing_id, airbnb_url, created_at")
        .order("created_at", { ascending: order === "asc" })
        .limit(cappedLimit);

    if (job_id) query = query.eq("job_id", job_id);
    if (status) query = query.eq("status", status);
    if (tier) query = query.eq("tier", tier);

    const { data: submissions, error: subErr } = await query;
    if (subErr) throw new Error(`Submissions query failed: ${subErr.message}`);
    if (!submissions || submissions.length === 0) return [];

    const ids = submissions.map((s) => s.id);

    // 2. Batch-fetch related data (4 parallel queries)
    const [fetchesRes, scoresRes, analysesRes, emailsRes] = await Promise.all([
        supabase
            .from("listing_fetches")
            .select("submission_id, fetch_status, provider, created_at")
            .in("submission_id", ids)
            .order("created_at", { ascending: false }),
        supabase
            .from("listing_scores")
            .select("submission_id, overall_score, score_label, summary, scored_at")
            .in("submission_id", ids)
            .order("scored_at", { ascending: false }),
        supabase
            .from("listing_analyses")
            .select("submission_id, status, analysed_at")
            .in("submission_id", ids)
            .order("created_at", { ascending: false }),
        supabase
            .from("email_queue")
            .select("submission_id, status, send_at, sent_at, attempts, last_error")
            .in("submission_id", ids)
            .order("created_at", { ascending: false }),
    ]);

    // 3. Index by submission_id (take latest per submission)
    const latestBySubmission = (rows) => {
        const map = new Map();
        for (const row of rows || []) {
            if (!map.has(row.submission_id)) map.set(row.submission_id, row);
        }
        return map;
    };

    const fetchMap = latestBySubmission(fetchesRes.data);
    const scoreMap = latestBySubmission(scoresRes.data);
    const analysisMap = latestBySubmission(analysesRes.data);
    const emailMap = latestBySubmission(emailsRes.data);

    // 4. Build response
    const now = Date.now();
    return submissions.map((sub) => {
        const fetch = fetchMap.get(sub.id);
        const score = scoreMap.get(sub.id);
        const analysis = analysisMap.get(sub.id);
        const email = emailMap.get(sub.id);
        const createdMs = new Date(sub.created_at).getTime();
        const durationSeconds = Math.round((now - createdMs) / 1000);

        return {
            id: sub.id,
            job_id: sub.job_id,
            email: sub.email,
            full_name: sub.full_name,
            tier: sub.tier,
            status: sub.status,
            status_message: sub.status_message,
            airbnb_listing_id: sub.airbnb_listing_id,
            created_at: sub.created_at,
            duration_seconds: durationSeconds,
            pipeline: {
                fetch: fetch
                    ? { status: fetch.fetch_status, provider: fetch.provider, fetched_at: fetch.created_at }
                    : null,
                score: score
                    ? (() => {
                        let rateDataMissing = false;
                        try {
                            const summary = typeof score.summary === "string" ? JSON.parse(score.summary) : score.summary;
                            rateDataMissing = !!summary?.signals?.competitive?.noData;
                        } catch { /* ignore parse errors */ }
                        return { overall_score: score.overall_score, label: score.score_label, scored_at: score.scored_at, rate_data_missing: rateDataMissing };
                    })()
                    : null,
                analysis: analysis
                    ? { status: analysis.status, analysed_at: analysis.analysed_at }
                    : null,
                email: email
                    ? { status: email.status, send_at: email.send_at, sent_at: email.sent_at, attempts: email.attempts, last_error: email.last_error }
                    : null,
            },
        };
    });
}

// ---------------------------------------------------------------------------
// Action: stuck-submissions
// Returns submissions that have been in a non-terminal state for too long.
// ---------------------------------------------------------------------------
async function stuckSubmissions({ threshold_minutes = 15 }) {
    const thresholdMs = Number(threshold_minutes) * 60 * 1000;
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();

    const { data: stuck, error } = await supabase
        .from("listing_submissions")
        .select("id, job_id, email, full_name, tier, status, status_message, created_at")
        .not("status", "in", '("complete","failed")')
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(100);

    if (error) throw new Error(`Stuck query failed: ${error.message}`);
    if (!stuck || stuck.length === 0) return { stuck_count: 0, submissions: [] };

    const now = Date.now();
    const enriched = stuck.map((sub) => {
        const createdMs = new Date(sub.created_at).getTime();
        return {
            ...sub,
            stuck_minutes: Math.round((now - createdMs) / 60000),
        };
    });

    return { stuck_count: enriched.length, threshold_minutes: Number(threshold_minutes), submissions: enriched };
}

// ---------------------------------------------------------------------------
// Action: force-send
// Skip the email queue delay for a specific job_id.
// ---------------------------------------------------------------------------
async function forceSend({ job_id }) {
    if (!job_id) throw new Error("job_id is required");

    // Check email_queue for this job
    const { data: emailRow, error: emailErr } = await supabase
        .from("email_queue")
        .select("*")
        .eq("job_id", job_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (emailErr) throw new Error(`Email queue query failed: ${emailErr.message}`);

    if (emailRow) {
        if (emailRow.status === "sent") {
            return { action: "none", reason: "Email already sent", email: emailRow };
        }
        if (emailRow.status === "processing") {
            return { action: "none", reason: "Email is currently being sent", email: emailRow };
        }
        if (emailRow.status === "failed") {
            // Reset failed email to pending with immediate send_at
            const { error: updateErr } = await supabase
                .from("email_queue")
                .update({ status: "pending", send_at: new Date().toISOString(), attempts: 0, last_error: null, updated_at: new Date().toISOString() })
                .eq("id", emailRow.id);
            if (updateErr) throw new Error(`Failed to reset email: ${updateErr.message}`);
            return { action: "reset_and_queued", reason: "Failed email reset to pending with immediate send_at", job_id };
        }
        // status is "pending" — just move send_at to now
        const { error: updateErr } = await supabase
            .from("email_queue")
            .update({ send_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", emailRow.id);
        if (updateErr) throw new Error(`Failed to update send_at: ${updateErr.message}`);
        return { action: "queue_jumped", reason: "send_at moved to NOW — next cron run will pick it up", job_id, original_send_at: emailRow.send_at };
    }

    // No email_queue row — check if submission exists and is complete enough to send
    const { data: submission } = await supabase
        .from("listing_submissions")
        .select("id, job_id, email, full_name, tier, status")
        .eq("job_id", job_id)
        .maybeSingle();

    if (!submission) {
        return { action: "none", reason: "No submission found for this job_id" };
    }

    if (submission.status !== "complete" && submission.status !== "scored") {
        return { action: "none", reason: `Submission is in "${submission.status}" state — not ready for email yet` };
    }

    // For pro/premium, require "complete" (analysis must finish before sending)
    if (submission.status === "scored" && submission.tier !== "free") {
        return { action: "none", reason: `Pro/premium report is still being generated (status: scored). Wait for analysis to complete.` };
    }

    // Check scores exist
    const { data: scoreCheck } = await supabase
        .from("listing_scores")
        .select("id")
        .eq("submission_id", submission.id)
        .limit(1)
        .maybeSingle();

    if (!scoreCheck) {
        return { action: "none", reason: "No scores found — pipeline may still be running" };
    }

    // Create a new email_queue entry with immediate send_at
    const { error: insertErr } = await supabase.from("email_queue").insert({
        submission_id: submission.id,
        job_id: submission.job_id,
        tier: submission.tier || "free",
        recipient_email: submission.email,
        recipient_name: submission.full_name,
        send_at: new Date().toISOString(),
        status: "pending",
    });

    if (insertErr) throw new Error(`Failed to create email queue entry: ${insertErr.message}`);
    return { action: "created_and_queued", reason: "New email_queue entry created with immediate send_at", job_id };
}

// ---------------------------------------------------------------------------
// Action: retry-analysis
// Re-trigger pro/premium analysis for a stuck or failed submission.
// ---------------------------------------------------------------------------
async function retryAnalysis({ job_id }) {
    if (!job_id) throw new Error("job_id is required");

    const { data: submission } = await supabase
        .from("listing_submissions")
        .select("id, job_id, email, full_name, tier, status")
        .eq("job_id", job_id)
        .maybeSingle();

    if (!submission) {
        return { action: "none", reason: "No submission found for this job_id" };
    }

    if (submission.tier === "free") {
        return { action: "none", reason: "Free tier submissions do not have analysis" };
    }

    // Reset any stuck/failed analysis records
    await supabase
        .from("listing_analyses")
        .update({ status: "cancelled", status_message: "Superseded by retry" })
        .eq("submission_id", submission.id)
        .in("status", ["processing", "failed"]);

    // Reset submission status to scored so analysis can be re-triggered
    await supabase
        .from("listing_submissions")
        .update({ status: "scored", status_message: "Retrying analysis" })
        .eq("id", submission.id);

    // Trigger the analysis
    const APP_BASE_URL = process.env.APP_BASE_URL;
    const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

    if (!APP_BASE_URL || !INTERNAL_API_SECRET) {
        return { action: "reset", reason: "Submission reset to scored but could not trigger analysis — missing APP_BASE_URL or INTERNAL_API_SECRET" };
    }

    const analyseUrl = `${APP_BASE_URL.replace(/\/+$/, "")}/api/analyse-pro`;
    fetch(analyseUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_API_SECRET,
        },
        body: JSON.stringify({ submission_id: submission.id, job_id: submission.job_id }),
    }).catch((err) => {
        console.error("Retry analysis trigger error:", err);
    });

    return { action: "retried", reason: "Analysis re-triggered", job_id };
}

// ---------------------------------------------------------------------------
// Action: retry-processing
// Re-trigger process-next for a submission stuck in "pending" or "processing".
// ---------------------------------------------------------------------------
async function retryProcessing({ job_id }) {
    if (!job_id) throw new Error("job_id is required");

    const { data: submission } = await supabase
        .from("listing_submissions")
        .select("id, job_id, status, tier")
        .eq("job_id", job_id)
        .maybeSingle();

    if (!submission) {
        return { action: "none", reason: "No submission found for this job_id" };
    }

    if (submission.status !== "pending" && submission.status !== "processing") {
        return { action: "none", reason: `Submission is in "${submission.status}" state — only pending/processing can be retried` };
    }

    // Reset to pending so process-next picks it up cleanly
    await supabase
        .from("listing_submissions")
        .update({ status: "pending", status_message: "Retrying processing" })
        .eq("id", submission.id);

    const APP_BASE_URL = process.env.APP_BASE_URL;
    const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

    if (!APP_BASE_URL || !INTERNAL_API_SECRET) {
        return { action: "reset", reason: "Submission reset to pending but could not trigger processing — missing config" };
    }

    const processUrl = `${APP_BASE_URL.replace(/\/+$/, "")}/api/process-next`;
    try {
        const response = await fetch(processUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": INTERNAL_API_SECRET,
            },
            body: JSON.stringify({ job_id: submission.job_id }),
        });

        if (!response.ok) {
            return { action: "reset", reason: `Submission reset but process-next returned ${response.status}`, job_id };
        }

        return { action: "retried", reason: "Processing re-triggered", job_id };
    } catch (err) {
        console.error("Retry processing trigger error:", err);
        return { action: "reset", reason: "Submission reset but trigger failed: " + err.message, job_id };
    }
}

// ---------------------------------------------------------------------------
// Action: submission-detail
// Deep dive into a single submission with all related data.
// ---------------------------------------------------------------------------
async function submissionDetail({ job_id, submission_id }) {
    if (!job_id && !submission_id) throw new Error("job_id or submission_id is required");

    let query = supabase.from("listing_submissions").select("*");
    if (job_id) query = query.eq("job_id", job_id);
    else query = query.eq("id", submission_id);

    const { data: submission, error: subErr } = await query.maybeSingle();
    if (subErr) throw new Error(`Submission query failed: ${subErr.message}`);
    if (!submission) return { error: "Submission not found" };

    const sid = submission.id;

    const [fetchesRes, scoresRes, analysesRes, emailsRes, snapshotRes] = await Promise.all([
        supabase.from("listing_fetches").select("*").eq("submission_id", sid).order("created_at", { ascending: false }),
        supabase.from("listing_scores").select("*").eq("submission_id", sid).order("scored_at", { ascending: false }),
        supabase.from("listing_analyses").select("id, submission_id, job_id, tier, analysis_version, status, status_message, analysed_at, created_at").eq("submission_id", sid).order("created_at", { ascending: false }),
        supabase.from("email_queue").select("*").eq("submission_id", sid).order("created_at", { ascending: false }),
        supabase.from("listing_snapshots").select("*").eq("submission_id", sid).maybeSingle(),
    ]);

    return {
        submission,
        fetches: fetchesRes.data || [],
        scores: scoresRes.data || [],
        analyses: analysesRes.data || [],
        emails: emailsRes.data || [],
        snapshot: snapshotRes.data || null,
    };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed — use POST" });
    }

    if (!isAuthorised(req)) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { action, ...params } = req.body || {};

    if (!action) {
        return res.status(400).json({
            error: "Missing action",
            available_actions: ["pipeline-status", "stuck-submissions", "force-send", "retry-analysis", "retry-processing", "submission-detail"],
        });
    }

    try {
        switch (action) {
            case "pipeline-status": {
                const result = await pipelineStatus(params);
                return res.status(200).json({ success: true, count: result.length, submissions: result });
            }
            case "stuck-submissions": {
                const result = await stuckSubmissions(params);
                return res.status(200).json({ success: true, ...result });
            }
            case "force-send": {
                const result = await forceSend(params);
                return res.status(200).json({ success: true, ...result });
            }
            case "retry-analysis": {
                const result = await retryAnalysis(params);
                return res.status(200).json({ success: true, ...result });
            }
            case "retry-processing": {
                const result = await retryProcessing(params);
                return res.status(200).json({ success: true, ...result });
            }
            case "submission-detail": {
                const result = await submissionDetail(params);
                return res.status(200).json({ success: true, ...result });
            }
            default:
                return res.status(400).json({
                    error: `Unknown action: ${action}`,
                    available_actions: ["pipeline-status", "stuck-submissions", "force-send", "retry-analysis", "retry-processing", "submission-detail"],
                });
        }
    } catch (err) {
        console.error(`Admin action "${action}" error:`, err);
        return res.status(500).json({ error: err.message || "Server error" });
    }
}
