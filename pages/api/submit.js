// pages/api/submit.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getAllowedOrigins() {
  // Preferred: ALLOWED_ORIGINS="https://a.com,https://b.com"
  const list = process.env.ALLOWED_ORIGINS;
  if (list && list.trim().length) {
    return list.split(",").map((o) => o.trim()).filter(Boolean);
  }

  // Backwards compatible: ALLOWED_ORIGIN="https://a.com"
  const single = process.env.ALLOWED_ORIGIN;
  if (single && single.trim().length) return [single.trim()];

  return [];
}

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // --- CORS ---
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    // If you want to hard-block unknown origins even for OPTIONS:
    if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
      return res.status(403).end("Forbidden origin");
    }
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // If you want strict origin enforcement:
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  try {
    const { name, email, listing_url, marketing_consent, tier } = req.body ?? {};

    // --- Basic validation ---
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Invalid name" });
    }
    if (
      !email ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (
      !listing_url ||
      typeof listing_url !== "string" ||
      !isValidHttpUrl(listing_url)
    ) {
      return res.status(400).json({ error: "Invalid listing_url" });
    }

    const leadTier =
      typeof tier === "string" && tier.trim().length ? tier.trim() : "starter";

    const consent = Boolean(marketing_consent);

    // --- 1) Insert lead ---
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        listing_url: listing_url.trim(),
        marketing_consent: consent,
        tier: leadTier,
      })
      .select("id")
      .single();

    if (leadError || !lead?.id) {
      console.error("Lead insert error:", leadError);
      return res.status(500).json({ error: "Failed to create lead" });
    }

    // --- 2) Create job linked to lead ---
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        lead_id: lead.id,
        status: "queued",
        // result_json, error, score left NULL initially
      })
      .select("id")
      .single();

    if (jobError || !job?.id) {
      console.error("Job insert error:", jobError);
      return res.status(500).json({ error: "Failed to create job" });
    }

    // --- 3) Optional: trigger scoring webhook (if configured) ---
    const webhookUrl = process.env.SCORING_WEBHOOK_URL;
    if (webhookUrl && isValidHttpUrl(webhookUrl)) {
      // Fire-and-forget (don’t block the response)
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          lead_id: lead.id,
          listing_url: listing_url.trim(),
          tier: leadTier,
        }),
      }).catch((e) => console.error("Webhook trigger failed:", e));
    }

    return res.status(200).json({ job_id: job.id });
  } catch (e) {
    console.error("Unhandled submit error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
