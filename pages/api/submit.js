// /pages/api/submit.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Optional: allow multiple origins (comma-separated) OR single origin
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS; // e.g. "https://letgrow.co.uk,https://www.letgrow.co.uk"

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function getAllowedOrigins() {
  if (ALLOWED_ORIGINS && ALLOWED_ORIGINS.trim().length > 0) {
    return ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
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

export default async function handler(req, res) {
  const origin = req.headers.origin;

  // Basic CORS
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Reject if origin is present but not allowed (Framer/web browsers will send Origin)
  if (origin && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Server misconfigured: missing Supabase env vars" });
    }

    const {
      name,
      email,
      listing_url,
      marketing_consent,
      // tier may arrive from some forms, but we DO NOT insert it into leads (since you removed the column)
      tier,
    } = req.body || {};

    // Minimal validation
    if (!name || !email || !listing_url) {
      return res.status(400).json({ error: "Missing required fields: name, email, listing_url" });
    }

    // Normalise marketing consent to boolean
    const marketingConsentBool = !!marketing_consent;

    // 1) Insert lead (NO tier column)
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert([
        {
          name: String(name).trim(),
          email: String(email).trim().toLowerCase(),
          listing_url: String(listing_url).trim(),
          marketing_consent: marketingConsentBool,
        },
      ])
      .select()
      .single();

    if (leadError) {
      console.error("Lead insert error:", leadError);
      return res.status(500).json({ error: leadError.message || "Failed to create lead" });
    }

    // 2) Create job linked to lead
    // You CAN store tier on jobs (recommended), even if you removed it from leads.
    const jobPayload = {
      lead_id: lead.id,
      status: "queued",
    };

    // If your jobs table has a tier column and you want it:
    if (typeof tier === "string" && tier.trim().length > 0) {
      jobPayload.tier = tier.trim();
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert([jobPayload])
      .select()
      .single();

    if (jobError) {
      console.error("Job insert error:", jobError);

      // Optional cleanup: if job creation fails, you might want to delete the lead to avoid orphan leads.
      // Commented out by default.
      // await supabase.from("leads").delete().eq("id", lead.id);

      return res.status(500).json({ error: jobError.message || "Failed to create job" });
    }

    // 3) Return job_id
    return res.status(200).json({ job_id: job.id });
  } catch (e) {
    console.error("Unhandled error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
