// /pages/api/process-next.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY;

// Replace this with your exact HasData endpoint once confirmed
const HASDATA_ENDPOINT = "https://api.hasdata.com/scrape/airbnb/property";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

    // 1) Find the oldest pending submission
    const { data: submission, error: submissionError } = await supabase
      .from("listing_submissions")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (submissionError) {
      console.error("Submission lookup error:", submissionError);
      return res.status(500).json({ error: "Failed to fetch pending submission" });
    }

    if (!submission) {
      return res.status(200).json({ success: true, message: "No pending submissions found" });
    }

    // 2) Mark submission as fetching
    const { error: updateFetchingError } = await supabase
      .from("listing_submissions")
      .update({
        status: "fetching",
        status_message: "Fetching listing data from HasData",
      })
      .eq("id", submission.id);

    if (updateFetchingError) {
      console.error("Update fetching status error:", updateFetchingError);
      return res.status(500).json({ error: "Failed to mark submission as fetching" });
    }

    // 3) Create fetch record
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

    // 4) Call HasData
    let hasDataResponse;
    let hasDataJson;

    try {
      const url = new URL(HASDATA_ENDPOINT);
      url.searchParams.set("url", submission.normalised_url);

      hasDataResponse = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-KEY": HASDATA_API_KEY,
          "Accept": "application/json",
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

    // 5) Handle non-200 response
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
      });
    }

    // 6) Save successful fetch
    await supabase
      .from("listing_fetches")
      .update({
        fetch_status: "success",
        raw_response: hasDataJson,
        fetched_at: new Date().toISOString(),
      })
      .eq("id", fetchRow.id);

    await supabase
      .from("listing_submissions")
      .update({
        status: "fetched",
        status_message: "Listing data fetched successfully",
      })
      .eq("id", submission.id);

    return res.status(200).json({
      success: true,
      submission_id: submission.id,
      job_id: submission.job_id,
      fetch_id: fetchRow.id,
      message: "Listing fetched successfully",
    });
  } catch (e) {
    console.error("Unhandled error in process-next:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
