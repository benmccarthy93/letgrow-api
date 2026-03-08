// /pages/api/process-next.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY;
const HASDATA_PROPERTY_API_URL = process.env.HASDATA_PROPERTY_API_URL;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const STALE_PROCESSING_MINUTES = 15;

function getInputValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

// New fetching logic for market data and property data
async function fetchMarketData(url) {
  const response = await fetch(`${HASDATA_PROPERTY_API_URL}?${new URLSearchParams({ url }).toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${HASDATA_API_KEY}`,
    },
  });

  const data = await response.json();
  return data;
}

async function fetchPropertyData(url) {
  // Fetch property data from your API or source
  return await fetchMarketData(url);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { job_id, submission_id, property_url } = body;

    const propertyData = await fetchPropertyData(property_url);
    const marketData = await fetchMarketData(property_url);

    // Call your scoring function
    const overallScore = calculateFinalScore(propertyData, marketData);

    return res.status(200).json({
      success: true,
      overallScore,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
}
