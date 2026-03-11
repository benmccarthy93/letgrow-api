// /pages/api/lib/send-email.js
// Fetches data, generates PDF, sends branded email via AWS SES

import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import nodemailer from "nodemailer";
import { generatePdf } from "./generate-pdf.js";

const ses = new SESClient({
    region: process.env.AWS_SES_REGION || "eu-west-2",
    credentials: {
        accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
    },
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || "results@letgrow.co.uk";

function safeJsonParse(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value === "string") {
        try { return JSON.parse(value); } catch { return null; }
    }
    return null;
}

function slugify(text) {
    return String(text || "listing")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
}

function scoreLabelEmoji(label) {
    const l = String(label || "").toLowerCase();
    if (l.includes("excellent")) return "🌟";
    if (l.includes("good")) return "✅";
    if (l.includes("fair")) return "⚡";
    return "📊";
}

function buildEmailHtml({ recipientName, overallScore, scoreLabel, tier, listingTitle, jobId }) {
    const appBaseUrl = (process.env.APP_BASE_URL || "https://www.letgrow.co.uk").replace(/\/+$/, "");
    const resultsUrl = `${appBaseUrl}/results?job_id=${jobId}`;
    const emoji = scoreLabelEmoji(scoreLabel);

    const tierLabel = tier === "premium" ? "Premium" : tier === "pro" ? "Pro" : "Free";
    const tierBadge = tier === "free" ? "" : `<span style="background:#D4A843;color:#1B4332;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold;margin-left:8px;">${tierLabel}</span>`;

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:#1B4332;padding:24px 30px;">
  <table width="100%"><tr>
    <td><span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">LETGROW</span></td>
    <td style="text-align:right;color:#B7D4C3;font-size:12px;">Listing Performance Report${tierBadge}</td>
  </tr></table>
</td></tr>

<!-- Body -->
<tr><td style="padding:30px;">
  <p style="font-size:16px;color:#333;margin:0 0 20px;">Hi ${recipientName || "there"},</p>
  <p style="font-size:14px;color:#333;margin:0 0 20px;">Your LetGrow report for <strong>${listingTitle || "your listing"}</strong> is ready.</p>

  <!-- Score Box -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F1;border-radius:8px;margin:0 0 20px;">
  <tr>
    <td style="padding:20px 25px;text-align:center;width:100px;">
      <span style="font-size:42px;font-weight:bold;color:#1B4332;">${overallScore}</span>
      <br><span style="font-size:11px;color:#888;">out of 100</span>
    </td>
    <td style="padding:20px 25px;">
      <span style="font-size:20px;font-weight:bold;color:#1B4332;">${emoji} ${scoreLabel}</span>
      <br><span style="font-size:12px;color:#555;line-height:1.5;">Your score is based on title, description, photos, amenities, trust signals, and competitive positioning.</span>
    </td>
  </tr>
  </table>

  <p style="font-size:14px;color:#333;margin:0 0 20px;">We've attached your full report as a PDF. You can also view your interactive results online:</p>

  <!-- CTA Button -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 25px;">
  <tr><td align="center">
    <a href="${resultsUrl}" style="display:inline-block;background:#1B4332;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:14px;font-weight:bold;letter-spacing:0.5px;">View Your Results Online</a>
  </td></tr>
  </table>

  ${tier === "free" ? `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E7;border-left:4px solid #D4A843;border-radius:4px;margin:0 0 20px;">
  <tr><td style="padding:15px 20px;">
    <p style="font-size:13px;color:#333;margin:0 0 5px;font-weight:bold;">Want more?</p>
    <p style="font-size:12px;color:#555;margin:0;">Upgrade to Pro for an expert-rewritten title &amp; description, review analysis, instant fixes, and a personalised 7-day action plan.</p>
  </td></tr>
  </table>` : ""}

  <p style="font-size:12px;color:#888;margin:20px 0 0;">If you have any questions, simply reply to this email.</p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f9f9f9;padding:20px 30px;border-top:1px solid #eee;">
  <p style="font-size:11px;color:#999;margin:0;text-align:center;">
    LetGrow — Where holiday lets grow<br>
    <a href="https://www.letgrow.co.uk" style="color:#1B4332;text-decoration:none;">www.letgrow.co.uk</a>
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------
// Main send function
// ---------------------------------------------------------------
export async function sendEmail(supabase, queueRow) {
    const { submission_id, job_id, tier, recipient_email, recipient_name } = queueRow;

    // 1. Fetch submission
    const { data: submission, error: subErr } = await supabase
        .from("listing_submissions")
        .select("*")
        .eq("id", submission_id)
        .maybeSingle();

    if (subErr || !submission) {
        throw new Error(`Submission not found: ${submission_id}`);
    }

    // 2. Fetch scores
    const { data: scoreRows } = await supabase
        .from("listing_scores")
        .select("*")
        .eq("submission_id", submission_id)
        .order("scored_at", { ascending: false })
        .limit(1);

    const scores = scoreRows?.[0];
    if (!scores) {
        throw new Error(`No scores found for submission: ${submission_id}`);
    }

    // 3. Fetch snapshot
    const { data: snapshot } = await supabase
        .from("listing_snapshots")
        .select("*")
        .eq("submission_id", submission_id)
        .maybeSingle();

    // 4. Fetch analysis (pro/premium only)
    let analysis = null;
    if (tier === "pro" || tier === "premium") {
        const { data: analysisRow } = await supabase
            .from("listing_analyses")
            .select("*")
            .eq("submission_id", submission_id)
            .eq("status", "complete")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        analysis = analysisRow;
    }

    // 5. Generate PDF
    const pdfBuffer = await generatePdf({
        submission,
        scores,
        snapshot,
        analysis,
        tier,
    });

    // 6. Build email
    const listingTitle = snapshot?.title || "Your Listing";
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `LetGrow-Report-${slugify(listingTitle)}-${dateStr}.pdf`;

    const htmlBody = buildEmailHtml({
        recipientName: recipient_name,
        overallScore: scores.overall_score ?? 0,
        scoreLabel: scores.score_label || "N/A",
        tier,
        listingTitle,
        jobId: job_id,
    });

    const tierLabel = tier === "premium" ? "Premium" : tier === "pro" ? "Pro" : "";
    const subjectLine = `Your LetGrow ${tierLabel ? tierLabel + " " : ""}Report is Ready — Score: ${scores.overall_score ?? 0}/100`;

    // 7. Compose MIME message with nodemailer
    const transporter = nodemailer.createTransport({ streamTransport: true });
    const message = await transporter.sendMail({
        from: `LetGrow <${FROM_EMAIL}>`,
        to: recipient_email,
        subject: subjectLine,
        html: htmlBody,
        attachments: [
            {
                filename,
                content: pdfBuffer,
                contentType: "application/pdf",
            },
        ],
    });

    // Get raw MIME buffer from the stream
    const rawChunks = [];
    for await (const chunk of message.message) {
        rawChunks.push(chunk);
    }
    const rawMessage = Buffer.concat(rawChunks);

    // 8. Send via SES
    const command = new SendRawEmailCommand({
        RawMessage: { Data: rawMessage },
        Source: `LetGrow <${FROM_EMAIL}>`,
        Destinations: [recipient_email],
    });

    await ses.send(command);

    console.log(`Email sent to ${recipient_email} for job ${job_id} (${tier})`);
}
