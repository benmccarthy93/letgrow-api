// /pages/api/send-emails.js
// Vercel Cron handler — runs every 5 minutes, processes pending emails from email_queue

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./lib/send-email.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

export default async function handler(req, res) {
    // Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET>
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    // Verify cron secret (Vercel automatically sends this header for cron jobs)
    const authHeader = req.headers.authorization || "";
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        // Find pending emails ready to send
        const { data: pendingEmails, error: fetchError } = await supabase
            .from("email_queue")
            .select("*")
            .eq("status", "pending")
            .lte("send_at", new Date().toISOString())
            .order("send_at", { ascending: true })
            .limit(5);

        if (fetchError) {
            console.error("Failed to fetch pending emails:", fetchError);
            return res.status(500).json({ error: "Failed to fetch email queue" });
        }

        if (!pendingEmails || pendingEmails.length === 0) {
            return res.status(200).json({ success: true, processed: 0, message: "No emails to send" });
        }

        const results = [];

        for (const row of pendingEmails) {
            // Claim the row (set to processing) to prevent duplicate sends
            const { data: claimed, error: claimError } = await supabase
                .from("email_queue")
                .update({ status: "processing", updated_at: new Date().toISOString() })
                .eq("id", row.id)
                .eq("status", "pending")
                .select("id")
                .maybeSingle();

            if (claimError || !claimed) {
                // Another process already claimed this row
                results.push({ id: row.id, status: "skipped" });
                continue;
            }

            try {
                await sendEmail(supabase, row);

                // Mark as sent
                await supabase
                    .from("email_queue")
                    .update({
                        status: "sent",
                        sent_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", row.id);

                results.push({ id: row.id, status: "sent", email: row.recipient_email });
            } catch (err) {
                console.error(`Failed to send email ${row.id}:`, err.message);

                const newAttempts = (row.attempts || 0) + 1;
                const newStatus = newAttempts >= (row.max_attempts || 3) ? "failed" : "pending";

                await supabase
                    .from("email_queue")
                    .update({
                        status: newStatus,
                        attempts: newAttempts,
                        last_error: String(err.message).slice(0, 500),
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", row.id);

                results.push({ id: row.id, status: newStatus, error: err.message });
            }
        }

        return res.status(200).json({
            success: true,
            processed: results.length,
            results,
        });
    } catch (e) {
        console.error("Unhandled error in send-emails:", e);
        return res.status(500).json({ error: "Server error" });
    }
}
