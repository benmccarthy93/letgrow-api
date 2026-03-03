import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = process.env.ALLOWED_ORIGIN;

  if (allowed && origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, listing_url, tier, marketing_consent } = req.body ?? {};

    // Basic validation
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Missing or invalid name" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Missing or invalid email" });
    }
    if (!isValidUrl(listing_url)) {
      return res.status(400).json({ error: "Missing or invalid listing_url" });
    }

    // 1) Insert lead
    const leadPayload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      listing_url: listing_url.trim(),
      // Only include tier if your table actually has it.
      // If you didn't add tier to leads, delete the next line.
      tier: tier ? String(tier) : null,
      marketing_consent: !!marketing_consent,
    };

    // If your leads table does NOT have tier, remove it cleanly:
    if (leadPayload.tier === null) delete leadPayload.tier;

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .insert(leadPayload)
      .select("id")
      .single();

    if (leadErr) {
      console.error("Lead insert error:", leadErr);
      return res.status(500).json({ error: "Failed to create lead" });
    }

    // 2) Create job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        lead_id: lead.id,
        status: "queued",
      })
      .select("id")
      .single();

    if (jobErr) {
      console.error("Job insert error:", jobErr);
      return res.status(500).json({ error: "Failed to create job" });
    }

    // 3) Return job_id
    return res.status(200).json({ job_id: job.id });
  } catch (e) {
    console.error("Unhandled error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
