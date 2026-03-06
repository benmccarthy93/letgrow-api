// /pages/api/process-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY;

const HASDATA_ENDPOINT = "https://api.hasdata.com/scrape/airbnb/property";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function getInputValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function findTargetSubmission({ jobId, submissionId }) {
  if (submissionId) {
    const { data, error } = await supabase
      .from("listing_submissions")
      .select("*")
      .eq("id", submissionId)
      .maybeSingle();

    return { data, error };
  }

  if (jobId) {
    const { data, error } = await supabase
      .from("listing_submissions")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();

    return { data, error };
  }

  const { data, error } = await supabase
    .from("listing_submissions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return { data, error };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase env vars" });
    }

    if (!HASDATA_API_KEY) {
      return res.status(500).json({ error: "Missing HASDATA_API_KEY env var" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = req.query || {};

    const jobId =
      getInputValue(body.job_id) ||
      getInputValue(query.job_id) ||
      null;

    const submissionId =
      getInputValue(body.submission_id) ||
      getInputValue(query.submission_id) ||
      null;

    const { data: submission, error: submissionError } = await findTargetSubmission({
      jobId,
      submissionId,
    });

    if (submissionError) {
      console.error("Submission lookup error:", submissionError);
      return res.status(500).json({ error: "Failed to fetch submission" });
    }

    if (!submission) {
      return res.status(404).json({
        error: "No matching submission found",
        filters: {
          job_id: jobId,
          submission_id: submissionId,
        },
      });
    }

    if (submission.status !== "pending") {
      return res.status(409).json({
        error: "Submission is not pending",
        submission_id: submission.id,
        job_id: submission.job_id,
        current_status: submission.status,
      });
    }

    if (!submission.normalised_url) {
      await supabase
        .from("listing_submissions")
        .update({
          status: "failed",
          status_message: "Missing normalised Airbnb URL",
        })
        .eq("id", submission.id);

      return res.status(400).json({
        error: "Submission is missing normalised_url",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    // Claim the row by switching pending -> fetching
    const { data: claimedRows, error: claimError } = await supabase
      .from("listing_submissions")
      .update({
        status: "fetching",
        status_message: "Fetching listing data from HasData",
      })
      .eq("id", submission.id)
      .eq("status", "pending")
      .select("id");

    if (claimError) {
      console.error("Claim update error:", claimError);
      return res.status(500).json({ error: "Failed to claim submission for fetching" });
    }

    if (!claimedRows || claimedRows.length === 0) {
      return res.status(409).json({
        error: "Submission could not be claimed",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const { data: fetchRow, error: fetchInsertError } = await supabase
      .from("listing_fetches")
      .insert([
        {
          submission_id: submission.id,
          fetch_status: "pending",
          provider: "hasdata",
          request_url: submission.normalised_url,
        },
      ])
      .select()
      .single();

    if (fetchInsertError) {
      console.error("Fetch row insert error:", fetchInsertError);

      await supabase
        .from("listing_submissions")
        .update({
          status: "failed",
          status_message: "Failed to create fetch record",
        })
        .eq("id", submission.id);

      return res.status(500).json({ error: "Failed to create fetch record" });
    }

    let hasDataResponse;
    let hasDataJson;

    try {
      const url = new URL(HASDATA_ENDPOINT);
      url.searchParams.set("url", submission.normalised_url);

      hasDataResponse = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-api-key": HASDATA_API_KEY,
          Accept: "application/json",
        },
      });

      hasDataJson = await hasDataResponse.json();
    } catch (fetchError) {
      console.error("HasData request failed:", fetchError);

      await supabase
        .from("listing_fetches")
        .update({
          fetch_status: "failed",
          error_message: fetchError.message || "HasData request failed",
          fetched_at: new Date().toISOString(),
        })
        .eq("id", fetchRow.id);

      await supabase
        .from("listing_submissions")
        .update({
          status: "failed",
          status_message: "HasData request failed",
        })
        .eq("id", submission.id);

      return res.status(500).json({ error: "HasData request failed" });
    }

    if (!hasDataResponse.ok) {
      const errorText =
        hasDataJson?.message ||
        hasDataJson?.error ||
        `HasData returned status ${hasDataResponse.status}`;

      await supabase
        .from("listing_fetches")
        .update({
          fetch_status: "failed",
          raw_response: hasDataJson,
          error_message: errorText,
          fetched_at: new Date().toISOString(),
        })
        .eq("id", fetchRow.id);

      await supabase
        .from("listing_submissions")
        .update({
          status: "failed",
          status_message: errorText,
        })
        .eq("id", submission.id);

      return res.status(500).json({
        error: "HasData returned an error",
        details: errorText,
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const { error: fetchUpdateError } = await supabase
      .from("listing_fetches")
      .update({
        fetch_status: "success",
        raw_response: hasDataJson,
        fetched_at: new Date().toISOString(),
      })
      .eq("id", fetchRow.id);

    if (fetchUpdateError) {
      console.error("Fetch update error:", fetchUpdateError);

      await supabase
        .from("listing_submissions")
        .update({
          status: "failed",
          status_message: "Fetched data but failed saving fetch result",
        })
        .eq("id", submission.id);

      return res.status(500).json({
        error: "Fetched data but failed to save fetch result",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    const { error: submissionUpdateError } = await supabase
      .from("listing_submissions")
      .update({
        status: "fetched",
        status_message: "Listing data fetched successfully",
      })
      .eq("id", submission.id);

    if (submissionUpdateError) {
      console.error("Submission status update error:", submissionUpdateError);
      return res.status(500).json({
        error: "Fetch succeeded but failed updating submission status",
        submission_id: submission.id,
        job_id: submission.job_id,
      });
    }

    return res.status(200).json({
      success: true,
      submission_id: submission.id,
      job_id: submission.job_id,
      fetch_id: fetchRow.id,
      processed_by: jobId || submissionId ? "targeted" : "queue",
      message: "Listing fetched successfully",
    });
  } catch (e) {
    console.error("Unhandled error in process-next:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
