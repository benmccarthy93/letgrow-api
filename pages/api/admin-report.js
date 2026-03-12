// /pages/api/admin-report.js
// Generates and serves the PDF report on-demand for admin preview.
// Auth via query param ?secret= (matches ADMIN_SECRET).

import { createClient } from "@supabase/supabase-js";
import { generatePdf } from "./lib/generate-pdf.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.INTERNAL_API_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "GET only" });
    }

    const { job_id, secret } = req.query;

    if (!ADMIN_SECRET || String(secret || "") !== String(ADMIN_SECRET)) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!job_id) {
        return res.status(400).json({ error: "job_id is required" });
    }

    try {
        // Fetch submission
        const { data: submission } = await supabase
            .from("listing_submissions")
            .select("*")
            .eq("job_id", job_id)
            .maybeSingle();

        if (!submission) {
            return res.status(404).json({ error: "Submission not found" });
        }

        // Fetch scores
        const { data: scoreRows } = await supabase
            .from("listing_scores")
            .select("*")
            .eq("submission_id", submission.id)
            .order("scored_at", { ascending: false })
            .limit(1);

        const scores = scoreRows?.[0];
        if (!scores) {
            return res.status(400).json({ error: "No scores found — report not ready yet" });
        }

        // Fetch snapshot
        const { data: snapshot } = await supabase
            .from("listing_snapshots")
            .select("*")
            .eq("submission_id", submission.id)
            .maybeSingle();

        // Fetch analysis (pro/premium)
        let analysis = null;
        const tier = submission.tier || "free";
        if (tier === "pro" || tier === "premium") {
            const { data: analysisRow } = await supabase
                .from("listing_analyses")
                .select("*")
                .eq("submission_id", submission.id)
                .eq("status", "complete")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            analysis = analysisRow;
        }

        // Generate PDF
        const pdfBuffer = await generatePdf({
            submission,
            scores,
            snapshot,
            analysis,
            tier,
        });

        // Serve as inline PDF (opens in browser tab)
        const filename = `LetGrow-Report-${job_id}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        return res.status(200).send(pdfBuffer);
    } catch (err) {
        console.error("Admin report generation error:", err);
        return res.status(500).json({ error: err.message || "Failed to generate report" });
    }
}
