// /pages/api/submit.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;

const APP_BASE_URL = process.env.APP_BASE_URL;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function getAllowedOrigins() {
  if (ALLOWED_ORIGINS && ALLOWED_ORIGINS.trim().length > 0) {
    return ALLOWED_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (ALLOWED_ORIGIN && ALLOWED_ORIGIN.trim().length > 0) {
    return [ALLOWED_ORIGIN.trim()];
  }

  return [];
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

function generateJobId() {
  return `lg_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function extractAirbnbListingId(url) {
  const value = String(url || "").trim();
  const match = value.match(/airbnb\.[^/]+\/rooms\/(\d+)/i);

  if (match && match[1]) {
    return match[1];
  }

  return null;
}

function normaliseAirbnbUrl(url) {
  const listingId = extractAirbnbListingId(url);

  if (listingId) {
    return `https://www.airbnb.com/rooms/${listingId}`;
  }

  try {
    const parsed = new URL(String(url).trim());
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return String(url).trim();
  }
}

function parseMarketingConsent(value) {
  return (
    value === true ||
    value === "true" ||
    value === "on" ||
    value === 1 ||
    value === "1"
  );
}

function buildProcessNextUrl() {
  if (!APP_BASE_URL || !APP_BASE_URL.trim()) {
    return null;
  }

  return `${APP_BASE_URL.replace(/\/+$/, "")}/api/process-next`;
}

async function triggerProcessingInBackground(jobId) {
  const processNextUrl = buildProcessNextUrl();

  if (!processNextUrl || !INTERNAL_API_SECRET) {
    console.error("Background processing could not start: missing config");
    return;
  }

  fetch(processNextUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_API_SECRET,
    },
    body: JSON.stringify({
      job_id: jobId,
    }),
  }).catch((error) => {
    console.error("Background processing trigger failed:", error);
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (origin && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Server misconfigured: missing Supabase env vars",
      });
    }

    if (!APP_BASE_URL || !INTERNAL_API_SECRET) {
      return res.status(500).json({
        error: "Server misconfigured: missing processing env vars",
      });
    }

    const { name, email, listing_url, marketing_consent, tier: requestedTier, phone } = req.body || {};

    if (!name || !email || !listing_url) {
      return res.status(400).json({
        error: "Missing required fields: name, email, listing_url",
      });
    }

    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedListingUrl = String(listing_url).trim();

    if (!trimmedName || !trimmedEmail || !trimmedListingUrl) {
      return res.status(400).json({
        error: "Name, email and listing URL are required",
      });
    }

    const airbnbListingId = extractAirbnbListingId(trimmedListingUrl);

    if (!airbnbListingId) {
      return res.status(400).json({
        error: "Invalid Airbnb listing URL. Please use a valid Airbnb room link.",
      });
    }

    const validTiers = ["free", "pro", "premium"];
    const tier = validTiers.includes(requestedTier) ? requestedTier : "free";

    const trimmedPhone = phone ? String(phone).trim() : null;

    if ((tier === "pro" || tier === "premium") && !trimmedPhone) {
      return res.status(400).json({
        error: "A phone number is required for pro submissions.",
      });
    }

    const marketingConsentBool = parseMarketingConsent(marketing_consent);

    if (!marketingConsentBool) {
      return res.status(400).json({
        error: "Consent is required before submitting.",
      });
    }

    const jobId = generateJobId();
    const normalisedUrl = normaliseAirbnbUrl(trimmedListingUrl);

    const submissionPayload = {
      full_name: trimmedName,
      email: trimmedEmail,
      airbnb_url: trimmedListingUrl,
      tier,
      status: "pending",
      status_message: "Submission received",
      source: "website",
      job_id: jobId,
      normalised_url: normalisedUrl,
      airbnb_listing_id: airbnbListingId,
      marketing_consent: marketingConsentBool,
      phone: trimmedPhone,
    };

    const { data: submission, error: submissionError } = await supabase
      .from("listing_submissions")
      .insert([submissionPayload])
      .select()
      .single();

    if (submissionError) {
      console.error("Submission insert error:", submissionError);
      return res.status(500).json({
        error: submissionError.message || "Failed to create submission",
      });
    }

    triggerProcessingInBackground(submission.job_id);

    return res.status(200).json({
      success: true,
      job_id: submission.job_id,
      submission_id: submission.id,
      processing_started: true,
    });
  } catch (e) {
    console.error("Unhandled error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
