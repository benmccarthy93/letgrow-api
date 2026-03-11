// /pages/api/lib/email-queue.js
// Helper to insert emails into the email_queue table with tier-based delays

function calculateSendAt(tier) {
    const now = Date.now();

    if (tier === "free") {
        return new Date(now).toISOString();
    }

    const TWO_HOURS = 2 * 60 * 60 * 1000;

    // Pro: 2 to 3.5 hours
    if (tier === "pro") {
        const maxMs = 3.5 * 60 * 60 * 1000;
        const delayMs = TWO_HOURS + Math.random() * (maxMs - TWO_HOURS);
        return new Date(now + delayMs).toISOString();
    }

    // Premium: 2 to 8 hours
    const maxMs = 8 * 60 * 60 * 1000;
    const delayMs = TWO_HOURS + Math.random() * (maxMs - TWO_HOURS);
    return new Date(now + delayMs).toISOString();
}

export async function queueEmail(supabase, { submissionId, jobId, tier, recipientEmail, recipientName }) {
    const sendAt = calculateSendAt(tier);

    const { error } = await supabase.from("email_queue").insert({
        submission_id: submissionId,
        job_id: jobId,
        tier,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        send_at: sendAt,
        status: "pending",
    });

    if (error) {
        console.error("Failed to queue email:", error);
        throw error;
    }

    console.log(`Email queued for ${recipientEmail} (${tier}) — send_at: ${sendAt}`);
    return { sendAt };
}
