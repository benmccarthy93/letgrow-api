// /pages/api/result.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function getInputValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeJsonParse(value) {
  if (!value) return null;

  if (typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return null;
}

function mapSubmissionStatus(status) {
  const s = String(status || "").toLowerCase();

  if (["complete", "scored", "done"].includes(s)) return "complete";
  if (["failed", "error"].includes(s)) return "error";

  return "loading";
}

function buildLoadingSteps(status) {
  const s = String(status || "").toLowerCase();

  const steps = [
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
  ];

  return steps;
}

function normaliseMessages(summary) {
  const parsed = safeJsonParse(summary) || {};

  const categoryMessages = Array.isArray(parsed.category_messages)
    ? parsed.category_messages
    : [];

  const mappedFromArray = {};
  for (const item of categoryMessages) {
    const category = String(item?.category || "").toLowerCase();
    const message = String(item?.message || "").trim();

    if (!message) continue;

    if (category.includes("title")) mappedFromArray.title = message;
    else if (category.includes("description")) mappedFromArray.description = message;
    else if (category.includes("photo")) mappedFromArray.photos = message;
    else if (category.includes("amenit")) mappedFromArray.amenities = message;
    else if (category.includes("trust")) mappedFromArray.trust = message;
    else if (category.includes("competitive")) mappedFromArray.competitive_positioning = message;
  }

  return {
    title:
      parsed.title ||
      mappedFromArray.title ||
      "Your title has been reviewed for clarity, differentiation and guest appeal.",
    description:
      parsed.description ||
      mappedFromArray.description ||
      "Your description has been reviewed for clarity, structure and value communication.",
    photos:
      parsed.photos ||
      mappedFromArray.photos ||
      "Your photo set has been reviewed for coverage, confidence and merchandising strength.",
    amenities:
      parsed.amenities ||
      mappedFromArray.amenities ||
      "Your amenities have been reviewed for practical guest appeal and completeness.",
    trust:
      parsed.trust ||
      mappedFromArray.trust ||
      "Your trust signals have been reviewed for guest confidence and credibility.",
    competitive_positioning:
      parsed.competitive_positioning ||
      mappedFromArray.competitive_positioning ||
      "Your listing positioning has been reviewed against what stronger listings communicate clearly.",
  };
}

function extractProofSignals(scoreRow, summary) {
  const parsed = safeJsonParse(summary) || {};
  const detectedSignals = parsed?.detected_signals || {};
  const nestedSignals = parsed?.signals?.extracted_fields || {};

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
  };
}

function extractTopFixes(topFixes) {
  const parsed = safeJsonParse(topFixes) || {};

  return {
    improvement_potential: parsed?.improvement_potential ?? null,
    priorities: Array.isArray(parsed?.priorities) ? parsed.priorities : [],
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const jobId =
      getInputValue(req.query?.job_id) ||
      getInputValue(req.query?.jobId) ||
      null;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: "job_id is required",
      });
    }

    const { data: submission, error: submissionError } = await supabase
      .from("listing_submissions")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();

    if (submissionError) {
      console.error("Result submission lookup error:", submissionError);
      return res.status(500).json({
        success: false,
        error: "Failed to load submission",
      });
    }

    if (!submission) {
      return res.status(404).json({
        success: false,
        job_id: jobId,
        status: "error",
        error: "Job not found",
      });
    }

    const state = mapSubmissionStatus(submission.status);

    if (state === "loading") {
      return res.status(200).json({
        success: true,
        job_id: submission.job_id,
        submission_id: submission.id,
        status: "loading",
        status_message: submission.status_message || "Your listing is still being analysed.",
        steps: buildLoadingSteps(submission.status),
      });
    }

    if (state === "error") {
      return res.status(200).json({
        success: false,
        job_id: submission.job_id,
        submission_id: submission.id,
        status: "error",
        error: submission.status_message || "We couldn't generate your score.",
      });
    }

    const { data: scoreRows, error: scoreError } = await supabase
      .from("listing_scores")
      .select("*")
      .eq("submission_id", submission.id)
      .order("scored_at", { ascending: false })
      .limit(1);

    if (scoreError) {
      console.error("Result score lookup error:", scoreError);
      return res.status(500).json({
        success: false,
        error: "Failed to load score result",
      });
    }

    const scoreRow = scoreRows?.[0];

    if (!scoreRow) {
      return res.status(200).json({
        success: true,
        job_id: submission.job_id,
        submission_id: submission.id,
        status: "loading",
        status_message: "Your score is still being finalised.",
        steps: buildLoadingSteps("fetched"),
      });
    }

    const messages = normaliseMessages(scoreRow.summary);
    const proofSignals = extractProofSignals(scoreRow, scoreRow.summary);
    const topFixes = extractTopFixes(scoreRow.top_fixes);

    return res.status(200).json({
      success: true,
      job_id: submission.job_id,
      submission_id: submission.id,
      status: "complete",
      result: {
        overall_score: scoreRow.overall_score,
        score_label: scoreRow.score_label,
        messages,
        proof_signals: proofSignals,
        top_fixes: topFixes,
        scored_at: scoreRow.scored_at,
        scoring_version: scoreRow.scoring_version,
      },
    });
  } catch (error) {
    console.error("Unhandled error in result endpoint:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
}
