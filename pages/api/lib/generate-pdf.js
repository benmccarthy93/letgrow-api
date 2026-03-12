// /pages/api/lib/generate-pdf.js
// Generates a branded PDF report using PDFKit

import PDFDocument from "pdfkit";

// Brand colours — derived from the LetGrow logo
const DARK_GREEN = "#3B6B4A";       // Logo background green
const DEEP_GREEN = "#2A4F36";       // Darker shade for contrast
const GOLD = "#C49A4B";             // Logo house-icon gold
const CREAM = "#EDE3D0";            // Logo text warm cream
const WHITE = "#FFFFFF";
const BODY_TEXT = "#333333";
const LIGHT_GREY = "#F5F5F5";
const MEDIUM_GREY = "#7A8A7E";      // Greenish grey to stay on-brand
const SECTION_BG = "#EDF2EE";       // Light tint of brand green

// Score colours — using brand palette
function scoreColour(score, max) {
    const pct = max > 0 ? score / max : 0;
    if (pct >= 0.75) return DARK_GREEN;
    if (pct >= 0.5) return GOLD;
    if (pct >= 0.25) return "#D4785A";   // Warm terracotta
    return "#B5453A";                     // Muted red
}

function scoreLabelColour(label) {
    const l = String(label || "").toLowerCase();
    if (l.includes("excellent")) return DEEP_GREEN;
    if (l.includes("good")) return DARK_GREEN;
    if (l.includes("fair")) return GOLD;
    if (l.includes("poor") || l.includes("needs")) return "#B5453A";
    return BODY_TEXT;
}

async function fetchImageBuffer(url, timeoutMs = 5000) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const arrayBuffer = await resp.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch {
        return null;
    }
}

function safeJsonParse(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value === "string") {
        try { return JSON.parse(value); } catch { return null; }
    }
    return null;
}

function drawScoreBar(doc, x, y, width, score, max, height = 10) {
    const pct = max > 0 ? Math.min(score / max, 1) : 0;
    // Background
    doc.roundedRect(x, y, width, height, 3).fill("#E0E0E0");
    // Filled portion
    if (pct > 0) {
        doc.roundedRect(x, y, width * pct, height, 3).fill(scoreColour(score, max));
    }
}

function addPageFooter(doc) {
    const bottom = doc.page.height - 40;
    doc.fontSize(8).fillColor(MEDIUM_GREY)
        .text("LetGrow — Where holiday lets grow | www.letgrow.co.uk", 50, bottom, { align: "center", width: doc.page.width - 100 });
}

function ensureSpace(doc, needed) {
    if (doc.y + needed > doc.page.height - 60) {
        doc.addPage();
        addPageFooter(doc);
    }
}

function drawSectionHeader(doc, title) {
    ensureSpace(doc, 40);
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(DARK_GREEN).text(title, { underline: false });
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(GOLD).lineWidth(1).stroke();
    doc.moveDown(0.3);
}

function extractItemText(item) {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return String(item ?? "");

    // Review positive themes: theme + leverage_suggestion
    if (item.theme && item.leverage_suggestion) {
        let text = item.theme;
        if (item.frequency) text += ` (${item.frequency})`;
        if (item.example_quote) text += `\n  "${item.example_quote}"`;
        if (item.leverage_suggestion) text += `\n  Suggestion: ${item.leverage_suggestion}`;
        return text;
    }
    // Review negative themes: theme + fix_suggestions
    if (item.theme && item.fix_suggestions) {
        let text = `${item.theme}`;
        if (item.severity) text += ` [${item.severity}]`;
        if (item.frequency) text += ` — ${item.frequency}`;
        if (item.example_quote) text += `\n  "${item.example_quote}"`;
        const fixes = item.fix_suggestions;
        if (fixes && typeof fixes === "object") {
            if (fixes.fast) text += `\n  Quick fix: ${fixes.fast}`;
            if (fixes.cheap) text += `\n  Budget fix: ${fixes.cheap}`;
            if (fixes.premium) text += `\n  Premium fix: ${fixes.premium}`;
        }
        return text;
    }
    // Recurring issues
    if (item.issue) {
        let text = item.issue;
        if (item.urgency) text += ` [${item.urgency} urgency]`;
        if (item.times_mentioned) text += ` — mentioned ${item.times_mentioned} times`;
        if (item.impact_on_bookings) text += `\n  Impact: ${item.impact_on_bookings}`;
        return text;
    }
    // Strengths: area + detail + recommendation
    if (item.area && item.detail) {
        let text = `${item.area}: ${item.detail}`;
        if (item.recommendation) text += `\n  Recommendation: ${item.recommendation}`;
        return text;
    }
    // Revenue leaks
    if (item.area && item.fix) {
        let text = `${item.area}`;
        if (item.estimated_impact) text += ` [${item.estimated_impact} impact]`;
        if (item.detail) text += `: ${item.detail}`;
        text += `\n  Fix: ${item.fix}`;
        return text;
    }
    // Improvements
    if (item.improvement) {
        let text = item.improvement;
        if (item.priority) text += ` [${item.priority}]`;
        if (item.estimated_cost) text += ` — ${item.estimated_cost}`;
        if (item.expected_impact) text += `\n  Impact: ${item.expected_impact}`;
        if (item.instructions) text += `\n  How: ${item.instructions}`;
        return text;
    }
    // Click-through suggestions
    if (item.suggestion && item.rationale) {
        let text = item.suggestion;
        if (item.rationale) text += `\n  Why: ${item.rationale}`;
        if (item.action) text += `\n  Action: ${item.action}`;
        return text;
    }
    // Generic fallback — try common field names
    return item.text || item.title || item.suggestion || item.action || item.fix || item.description || item.name || item.focus || JSON.stringify(item);
}

function drawBulletList(doc, items, options = {}) {
    const { numbered = false, indent = 60 } = options;
    if (!Array.isArray(items)) return;
    items.forEach((item, i) => {
        const text = extractItemText(item);
        // Estimate height needed based on text length
        const estimatedLines = Math.ceil(text.length / 80) + (text.split("\n").length - 1);
        ensureSpace(doc, Math.max(20, estimatedLines * 14));
        const prefix = numbered ? `${i + 1}. ` : "• ";
        doc.fontSize(10).fillColor(BODY_TEXT).text(`${prefix}${text}`, indent, doc.y, { width: doc.page.width - indent - 50 });
        doc.moveDown(0.3);
    });
}

// ---------------------------------------------------------------
// Main PDF generation
// ---------------------------------------------------------------
export async function generatePdf({ submission, scores, snapshot, analysis, tier }) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: "A4",
                margins: { top: 50, bottom: 50, left: 50, right: 50 },
                bufferPages: true,
                info: {
                    Title: `LetGrow Report — ${submission.full_name || "Listing Report"}`,
                    Author: "LetGrow",
                    Subject: "Airbnb Listing Analysis Report",
                },
            });

            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            // ===================== HEADER =====================
            // Dark green header band
            doc.rect(0, 0, doc.page.width, 100).fill(DEEP_GREEN);

            // Logo — fetch from Supabase storage (try full logo, then square)
            const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qjsrpsxjtmywcojnucjv.supabase.co"}/storage/v1/object/public/assets`;
            let logoBuffer = await fetchImageBuffer(`${storageBase}/logo.png`);
            if (!logoBuffer) logoBuffer = await fetchImageBuffer(`${storageBase}/logo-square.png`);
            if (logoBuffer) {
                try {
                    doc.image(logoBuffer, 50, 15, { height: 70 });
                } catch (e) {
                    console.error("Logo embed error:", e.message);
                    doc.font("Helvetica-Bold").fontSize(22).fillColor(CREAM).text("LETGROW", 50, 30);
                    doc.font("Helvetica");
                }
            } else {
                doc.font("Helvetica-Bold").fontSize(22).fillColor(CREAM).text("LETGROW", 50, 30);
                doc.font("Helvetica");
            }

            // Header text
            doc.fontSize(11).fillColor(CREAM)
                .text("Listing Performance Report", 250, 25, { align: "right", width: 260 })
                .fontSize(9).fillColor("#B7D4C3")
                .text(`Prepared for: ${submission.full_name || "Guest"}`, 250, 45, { align: "right", width: 260 })
                .text(`Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, 250, 60, { align: "right", width: 260 })
                .text(`Tier: ${(tier || "free").charAt(0).toUpperCase() + (tier || "free").slice(1)} Plan`, 250, 75, { align: "right", width: 260 });

            doc.y = 115;

            // ===================== PROPERTY PHOTOS =====================
            const photosJson = safeJsonParse(snapshot?.photos_json);
            const photoUrls = Array.isArray(photosJson)
                ? photosJson.slice(0, 4).map((p) => (typeof p === "string" ? p : p?.url || p?.picture)).filter(Boolean)
                : [];

            if (photoUrls.length > 0) {
                const photoBuffers = await Promise.all(photoUrls.map((url) => fetchImageBuffer(url)));
                const validPhotos = photoBuffers.filter(Boolean);

                if (validPhotos.length > 0) {
                    const photoWidth = validPhotos.length === 1 ? 300 : (doc.page.width - 110) / Math.min(validPhotos.length, 4);
                    const photoHeight = 100;
                    let px = 50;

                    validPhotos.forEach((buf) => {
                        try {
                            doc.image(buf, px, doc.y, { width: photoWidth, height: photoHeight, fit: [photoWidth, photoHeight] });
                            px += photoWidth + 5;
                        } catch { /* skip broken image */ }
                    });

                    doc.y += photoHeight + 10;
                }
            }

            // Listing title
            const listingTitle = snapshot?.title || submission.airbnb_url || "Your Listing";
            doc.fontSize(12).fillColor(DARK_GREEN).text(listingTitle, 50, doc.y, { width: doc.page.width - 100 });
            if (snapshot?.location_text) {
                doc.fontSize(9).fillColor(MEDIUM_GREY).text(snapshot.location_text);
            }
            doc.moveDown(0.8);

            // ===================== OVERALL SCORE =====================
            const overallScore = scores?.overall_score ?? 0;
            const scoreLabel = scores?.score_label || "N/A";

            // Score box
            const boxY = doc.y;
            doc.roundedRect(50, boxY, doc.page.width - 100, 70, 8).fill(SECTION_BG);

            doc.fontSize(36).fillColor(scoreLabelColour(scoreLabel))
                .text(String(overallScore), 70, boxY + 10, { width: 80 });

            doc.fontSize(9).fillColor(MEDIUM_GREY)
                .text("out of 100", 70, boxY + 50, { width: 80 });

            doc.fontSize(18).fillColor(scoreLabelColour(scoreLabel))
                .text(scoreLabel, 170, boxY + 15, { width: 200 });

            doc.fontSize(9).fillColor(BODY_TEXT)
                .text("Your LetGrow Score measures how well your listing performs across six key areas that drive bookings.", 170, boxY + 42, { width: doc.page.width - 250 });

            doc.y = boxY + 85;

            // ===================== CATEGORY BREAKDOWN =====================
            drawSectionHeader(doc, "Score Breakdown");

            const summary = safeJsonParse(scores?.summary) || {};
            const categoryMessages = Array.isArray(summary.category_messages) ? summary.category_messages : [];

            const categories = [
                { key: "title", label: "Title", score: scores?.title_score, max: 10, weight: "10%" },
                { key: "description", label: "Description", score: scores?.description_score, max: 10, weight: "10%" },
                { key: "photo", label: "Photos", score: scores?.photo_score, max: 10, weight: "10%" },
                { key: "amenit", label: "Amenities", score: scores?.amenity_score, max: 10, weight: "10%" },
                { key: "trust", label: "Trust Signals", score: scores?.trust_score, max: 30, weight: "30%" },
                { key: "competitive", label: "Competitive Positioning", score: scores?.market_score, max: 30, weight: "30%" },
            ];

            categories.forEach((cat) => {
                ensureSpace(doc, 50);
                const catY = doc.y;

                // Category name + score
                doc.fontSize(11).fillColor(DARK_GREEN)
                    .text(`${cat.label}`, 50, catY, { continued: true })
                    .fillColor(MEDIUM_GREY).fontSize(8).text(`  (${cat.weight})`, { continued: false });

                doc.fontSize(10).fillColor(BODY_TEXT)
                    .text(`${cat.score ?? 0} / ${cat.max}`, doc.page.width - 120, catY, { width: 70, align: "right" });

                // Score bar
                drawScoreBar(doc, 50, catY + 18, doc.page.width - 170, cat.score ?? 0, cat.max);

                // Message
                const msg = categoryMessages.find((m) => String(m?.category || "").toLowerCase().includes(cat.key));
                if (msg?.message) {
                    doc.fontSize(9).fillColor(BODY_TEXT).text(msg.message, 50, catY + 32, { width: doc.page.width - 100 });
                }

                doc.y = Math.max(doc.y, catY + 32) + 12;
            });

            // ===================== TOP FIXES =====================
            const topFixes = safeJsonParse(scores?.top_fixes) || (Array.isArray(scores?.top_fixes) ? scores.top_fixes : []);
            if (Array.isArray(topFixes) && topFixes.length > 0) {
                drawSectionHeader(doc, "Top Fixes to Improve Your Score");
                drawBulletList(doc, topFixes, { numbered: true });
            }

            addPageFooter(doc);

            // ===================== PRO / PREMIUM CONTENT =====================
            if ((tier === "pro" || tier === "premium") && analysis) {

                // --- Rewritten Title ---
                if (analysis.rewritten_title) {
                    drawSectionHeader(doc, "Optimised Title");

                    const origTitleScore = safeJsonParse(analysis.rewritten_title_score);
                    doc.fontSize(9).fillColor(MEDIUM_GREY).text("Your current title:");
                    doc.fontSize(11).fillColor(BODY_TEXT).text(snapshot?.title || "(not available)");
                    doc.moveDown(0.3);
                    doc.fontSize(9).fillColor(MEDIUM_GREY).text("Our recommended title:");
                    doc.fontSize(11).fillColor(DARK_GREEN).text(analysis.rewritten_title);

                    if (origTitleScore) {
                        doc.moveDown(0.2);
                        doc.fontSize(9).fillColor(MEDIUM_GREY).text(
                            `Keywords: ${origTitleScore.keyword_count ?? "N/A"} | Characters: ${origTitleScore.character_count ?? "N/A"}`
                        );
                        if (origTitleScore.rationale) {
                            doc.moveDown(0.1);
                            doc.fontSize(9).fillColor(BODY_TEXT).text(origTitleScore.rationale, { width: doc.page.width - 100 });
                        }
                    }
                }

                // --- Rewritten Description ---
                if (analysis.rewritten_description) {
                    drawSectionHeader(doc, "Optimised Description");

                    doc.fontSize(9).fillColor(MEDIUM_GREY).text("Our recommended description:");
                    doc.fontSize(10).fillColor(BODY_TEXT).text(analysis.rewritten_description, { width: doc.page.width - 100 });

                    const descScore = safeJsonParse(analysis.rewritten_description_score);
                    if (descScore) {
                        doc.moveDown(0.2);
                        doc.fontSize(9).fillColor(MEDIUM_GREY).text(
                            `Keywords: ${descScore.keyword_count ?? "N/A"} | Characters: ${descScore.character_count ?? "N/A"}`
                        );
                        if (descScore.rationale) {
                            doc.moveDown(0.1);
                            doc.fontSize(9).fillColor(BODY_TEXT).text(descScore.rationale, { width: doc.page.width - 100 });
                        }
                    }
                }

                // --- Review Themes ---
                const reviewThemes = safeJsonParse(analysis.review_themes);
                if (reviewThemes) {
                    drawSectionHeader(doc, "Review Analysis");

                    if (Array.isArray(reviewThemes.positive_themes) && reviewThemes.positive_themes.length > 0) {
                        doc.fontSize(10).fillColor(DARK_GREEN).text("What guests love:");
                        drawBulletList(doc, reviewThemes.positive_themes);
                    }
                    if (Array.isArray(reviewThemes.negative_themes) && reviewThemes.negative_themes.length > 0) {
                        ensureSpace(doc, 30);
                        doc.fontSize(10).fillColor("#B5453A").text("Areas of concern:");
                        drawBulletList(doc, reviewThemes.negative_themes);
                    }
                    if (Array.isArray(reviewThemes.recurring_issues) && reviewThemes.recurring_issues.length > 0) {
                        ensureSpace(doc, 30);
                        doc.fontSize(10).fillColor("#D4785A").text("Recurring issues:");
                        drawBulletList(doc, reviewThemes.recurring_issues);
                    }
                }

                // --- Strengths ---
                if (Array.isArray(analysis.strengths) && analysis.strengths.length > 0) {
                    drawSectionHeader(doc, "Your Strengths");
                    drawBulletList(doc, analysis.strengths);
                }

                // --- Revenue Leaks ---
                if (Array.isArray(analysis.revenue_leaks) && analysis.revenue_leaks.length > 0) {
                    drawSectionHeader(doc, "Revenue Leaks");
                    doc.fontSize(9).fillColor(MEDIUM_GREY).text("These issues may be costing you bookings:");
                    drawBulletList(doc, analysis.revenue_leaks, { numbered: true });
                }

                // --- Instant Fixes ---
                if (Array.isArray(analysis.instant_fixes) && analysis.instant_fixes.length > 0) {
                    drawSectionHeader(doc, "Instant Fixes (5–30 minutes)");
                    drawBulletList(doc, analysis.instant_fixes, { numbered: true });
                }

                // --- Overall Improvements ---
                if (Array.isArray(analysis.overall_improvements) && analysis.overall_improvements.length > 0) {
                    drawSectionHeader(doc, "Recommended Improvements");
                    drawBulletList(doc, analysis.overall_improvements, { numbered: true });
                }

                // --- 7-Day Action Plan ---
                const sevenDayPlan = safeJsonParse(analysis.seven_day_plan) || (Array.isArray(analysis.seven_day_plan) ? analysis.seven_day_plan : null);
                if (Array.isArray(sevenDayPlan) && sevenDayPlan.length > 0) {
                    drawSectionHeader(doc, "Your 7-Day Action Plan");
                    sevenDayPlan.forEach((day) => {
                        ensureSpace(doc, 30);
                        const dayLabel = day?.day || day?.label || "";
                        const dayFocus = day?.focus || "";
                        const dayTasks = day?.tasks || day?.actions || (typeof day === "string" ? [day] : []);
                        if (dayLabel) {
                            const focusText = dayFocus ? ` — ${dayFocus}` : "";
                            doc.fontSize(10).fillColor(DARK_GREEN).text(`${dayLabel}${focusText}`);
                        }
                        if (Array.isArray(dayTasks)) {
                            drawBulletList(doc, dayTasks);
                        } else if (typeof dayTasks === "string") {
                            doc.fontSize(9).fillColor(BODY_TEXT).text(dayTasks, 60, doc.y, { width: doc.page.width - 110 });
                        }
                    });
                }

                // ===================== PREMIUM-ONLY CONTENT =====================
                if (tier === "premium") {

                    // --- Click-Through Suggestions ---
                    if (Array.isArray(analysis.click_through_suggestions) && analysis.click_through_suggestions.length > 0) {
                        drawSectionHeader(doc, "Click-Through Optimisation");
                        doc.fontSize(9).fillColor(MEDIUM_GREY).text("How to improve your search visibility and click rate:");
                        drawBulletList(doc, analysis.click_through_suggestions, { numbered: true });
                    }

                    // --- Amenity Suggestions ---
                    const amenitySuggestions = safeJsonParse(analysis.amenity_suggestions) || (Array.isArray(analysis.amenity_suggestions) ? analysis.amenity_suggestions : null);
                    if (Array.isArray(amenitySuggestions) && amenitySuggestions.length > 0) {
                        drawSectionHeader(doc, "Amenity Suggestions");
                        amenitySuggestions.forEach((item) => {
                            const name = item?.amenity || item?.name || item?.title || (typeof item === "string" ? item : "");
                            const cost = item?.cost || item?.estimated_cost || "";
                            const reason = item?.roi_explanation || item?.reason || item?.rationale || item?.roi_note || "";
                            const market = item?.market_opened || "";
                            const priority = item?.priority || "";
                            let text = `${name}${cost ? ` — ${cost}` : ""}`;
                            if (priority) text += ` [${priority}]`;
                            if (market) text += `\n  Opens market: ${market}`;
                            if (reason) text += `\n  ${reason}`;
                            const lines = Math.ceil(text.length / 80) + (text.split("\n").length - 1);
                            ensureSpace(doc, Math.max(25, lines * 14));
                            doc.fontSize(10).fillColor(DARK_GREEN).text(text, 60, doc.y, { width: doc.page.width - 110 });
                            doc.moveDown(0.2);
                        });
                    }

                    // --- Positioning Summary ---
                    if (analysis.positioning_summary) {
                        drawSectionHeader(doc, "Positioning Strategy");
                        const posSummary = typeof analysis.positioning_summary === "string"
                            ? analysis.positioning_summary
                            : JSON.stringify(analysis.positioning_summary, null, 2);
                        doc.fontSize(10).fillColor(BODY_TEXT).text(posSummary, { width: doc.page.width - 100 });
                    }

                    // --- Rewritten Your Property ---
                    if (analysis.rewritten_your_property) {
                        drawSectionHeader(doc, "Optimised 'Your Property' Section");
                        doc.fontSize(10).fillColor(BODY_TEXT).text(analysis.rewritten_your_property, { width: doc.page.width - 100 });
                    }
                }
            }

            // ===================== CTA (Free/Pro only) =====================
            if (tier === "free") {
                ensureSpace(doc, 80);
                doc.moveDown(1);
                const ctaY = doc.y;
                doc.roundedRect(50, ctaY, doc.page.width - 100, 60, 8).fill(DEEP_GREEN);
                doc.fontSize(12).fillColor(CREAM)
                    .text("Want expert-rewritten titles, review analysis, and a 7-day action plan?", 70, ctaY + 12, { width: doc.page.width - 140, align: "center" });
                doc.fontSize(10).fillColor(GOLD)
                    .text("Upgrade to Pro at www.letgrow.co.uk", 70, ctaY + 35, { width: doc.page.width - 140, align: "center" });
            } else if (tier === "pro") {
                ensureSpace(doc, 80);
                doc.moveDown(1);
                const ctaY = doc.y;
                doc.roundedRect(50, ctaY, doc.page.width - 100, 60, 8).fill(DEEP_GREEN);
                doc.fontSize(12).fillColor(CREAM)
                    .text("Want amenity suggestions, positioning strategy, and click-through optimisation?", 70, ctaY + 12, { width: doc.page.width - 140, align: "center" });
                doc.fontSize(10).fillColor(GOLD)
                    .text("Upgrade to Premium at www.letgrow.co.uk", 70, ctaY + 35, { width: doc.page.width - 140, align: "center" });
            }

            // ===================== FINAL FOOTER =====================
            ensureSpace(doc, 40);
            doc.moveDown(0.5);
            doc.fontSize(8).fillColor(MEDIUM_GREY)
                .text("This report was generated by LetGrow. The analysis is based on publicly available listing data and our proprietary scoring algorithm. For questions or support, visit www.letgrow.co.uk.", 50, doc.y, { width: doc.page.width - 100, align: "center" });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}
