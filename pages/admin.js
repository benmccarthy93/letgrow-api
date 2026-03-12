import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

const POLL_INTERVAL = 15000;

const STAGE_ORDER = ["submitted", "fetch_start", "fetched", "scored", "analysis", "complete", "email_queued", "email_sent"];

function stageBadge(status, pipeline, tier) {
    if (status === "failed" && tier !== "free" && pipeline?.analysis?.status !== "complete") return { label: "ANALYSIS FAILED", color: "#DC2626", bg: "#FEE2E2" };
    if (status === "failed") return { label: "FAILED", color: "#DC2626", bg: "#FEE2E2" };
    if (status === "complete" && pipeline?.email?.status === "sent") return { label: "SENT", color: "#15803D", bg: "#DCFCE7" };
    if (status === "complete" && pipeline?.email?.status === "pending") return { label: "QUEUED", color: "#B45309", bg: "#FEF3C7" };
    if (status === "complete") return { label: "READY TO SEND", color: "#15803D", bg: "#DCFCE7" };
    if (status === "scored" && tier === "free") return { label: "READY TO SEND", color: "#15803D", bg: "#DCFCE7" };
    if (status === "scored") return { label: "ANALYSING", color: "#7C3AED", bg: "#EDE9FE" };
    if (status === "fetched") return { label: "SCORING", color: "#2563EB", bg: "#DBEAFE" };
    if (status === "processing") return { label: "FETCHING", color: "#D97706", bg: "#FEF3C7" };
    if (status === "pending") return { label: "PENDING", color: "#6B7280", bg: "#F3F4F6" };
    return { label: status?.toUpperCase() || "UNKNOWN", color: "#6B7280", bg: "#F3F4F6" };
}

function tierBadge(tier) {
    if (tier === "premium") return { label: "Premium", color: "#92400E", bg: "#FDE68A" };
    if (tier === "pro") return { label: "Pro", color: "#1E40AF", bg: "#BFDBFE" };
    return { label: "Free", color: "#374151", bg: "#E5E7EB" };
}

function timeAgo(dateStr) {
    if (!dateStr) return "";
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDate(dateStr) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function PipelineSteps({ status, pipeline }) {
    const steps = [
        { key: "fetch", label: "Fetch", done: !!pipeline?.fetch },
        { key: "score", label: "Score", done: !!pipeline?.score },
        { key: "analysis", label: "Analysis", done: pipeline?.analysis?.status === "complete" },
        { key: "email", label: "Email", done: pipeline?.email?.status === "sent" },
    ];
    return (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {steps.map((step, i) => {
                let bg = "#E5E7EB";
                if (status === "failed") bg = "#FCA5A5";
                else if (step.done) bg = "#86EFAC";
                else if (
                    (step.key === "fetch" && (status === "processing")) ||
                    (step.key === "score" && status === "fetched") ||
                    (step.key === "analysis" && status === "scored") ||
                    (step.key === "email" && pipeline?.email?.status === "pending")
                ) bg = "#FDE68A";
                return (
                    <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div title={step.label} style={{
                            width: 28, height: 8, borderRadius: 4, background: bg, transition: "background 0.3s",
                        }} />
                        {i < steps.length - 1 && <span style={{ color: "#D1D5DB", fontSize: 10 }}></span>}
                    </div>
                );
            })}
        </div>
    );
}

function SubmissionRow({ sub, onForce, onDetail, onRetry, forcing, retrying, retried }) {
    const stage = stageBadge(sub.status, sub.pipeline, sub.tier);
    const tier = tierBadge(sub.tier);
    const isStuck = sub.status !== "complete" && sub.status !== "failed" && sub.duration_seconds > 900;

    return (
        <tr style={{ borderBottom: "1px solid #F3F4F6", background: isStuck ? "#FFF7ED" : "white" }}>
            <td style={td}>
                <code style={{ fontSize: 11, color: "#6B7280" }}>{sub.job_id}</code>
            </td>
            <td style={td}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{sub.full_name || "-"}</div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>{sub.email}</div>
            </td>
            <td style={{ ...td, textAlign: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 9999, color: tier.color, background: tier.bg }}>{tier.label}</span>
            </td>
            <td style={{ ...td, textAlign: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 9999, color: stage.color, background: stage.bg }}>
                    {stage.label}
                </span>
                {isStuck && <span title="Possibly stuck" style={{ marginLeft: 4, fontSize: 14 }}>&#9888;</span>}
            </td>
            <td style={td}><PipelineSteps status={sub.status} pipeline={sub.pipeline} /></td>
            <td style={{ ...td, textAlign: "center", fontSize: 12 }}>
                {sub.pipeline?.score ? <strong>{sub.pipeline.score.overall_score}</strong> : <span style={{ color: "#D1D5DB" }}>-</span>}
            </td>
            <td style={{ ...td, textAlign: "center" }}>
                {sub.pipeline?.email?.status === "pending" && sub.pipeline.email.send_at && (
                    <div style={{ fontSize: 11, color: "#92400E" }}>Sends {formatDate(sub.pipeline.email.send_at)}</div>
                )}
                {sub.pipeline?.email?.status === "sent" && (
                    <div style={{ fontSize: 11, color: "#15803D" }}>Sent {timeAgo(sub.pipeline.email.sent_at)}</div>
                )}
                {sub.pipeline?.email?.last_error && (
                    <div style={{ fontSize: 10, color: "#DC2626", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub.pipeline.email.last_error}>{sub.pipeline.email.last_error}</div>
                )}
            </td>
            <td style={{ ...td, fontSize: 11, color: "#9CA3AF" }}>{timeAgo(sub.created_at)}</td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>
                <button onClick={() => onDetail(sub.job_id)} style={btnSmall}>Detail</button>
                {(() => {
                    const reportReady = sub.status === "complete" || (sub.status === "scored" && sub.tier === "free");
                    const reportInProgress = sub.status === "scored" && sub.tier !== "free";
                    const analysisStuck = reportInProgress && sub.duration_seconds > 300;
                    const analysisFailed = sub.status === "failed" && sub.tier !== "free" && sub.pipeline?.analysis?.status !== "complete";
                    return (
                        <>
                            {(reportInProgress || reportReady) && (
                                <button
                                    onClick={reportReady ? () => onForce(sub.job_id) : undefined}
                                    disabled={!reportReady || forcing === sub.job_id}
                                    style={{
                                        ...btnSmall,
                                        marginLeft: 4,
                                        background: reportReady ? "#FEF3C7" : "#F3F4F6",
                                        color: reportReady ? "#92400E" : "#9CA3AF",
                                        cursor: reportReady ? "pointer" : "not-allowed",
                                        opacity: reportReady ? 1 : 0.6,
                                    }}
                                >
                                    {forcing === sub.job_id ? "..." : "Send Now"}
                                </button>
                            )}
                            {(analysisStuck || analysisFailed) && (
                                retried?.[sub.job_id] ? (
                                    <span style={{ marginLeft: 4, fontSize: 11, color: "#15803D", fontWeight: 500 }}>
                                        Retried — re-analysing...
                                    </span>
                                ) : (
                                    <button onClick={() => onRetry(sub.job_id)} disabled={retrying === sub.job_id} style={{ ...btnSmall, marginLeft: 4, background: "#FEE2E2", color: "#DC2626" }}>
                                        {retrying === sub.job_id ? "Retrying..." : "Retry"}
                                    </button>
                                )
                            )}
                        </>
                    );
                })()}
            </td>
        </tr>
    );
}

function DetailModal({ detail, onClose }) {
    if (!detail) return null;
    const { submission, scores, analyses, emails, fetches } = detail;
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
            <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 700, width: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>Submission Detail</h3>
                    <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}>&times;</button>
                </div>

                <Section title="Submission">
                    <KV label="Job ID" value={submission?.job_id} />
                    <KV label="Name" value={submission?.full_name} />
                    <KV label="Email" value={submission?.email} />
                    <KV label="Phone" value={submission?.phone} />
                    <KV label="Tier" value={submission?.tier} />
                    <KV label="Status" value={`${submission?.status} — ${submission?.status_message || ""}`} />
                    <KV label="URL" value={submission?.airbnb_url} />
                    <KV label="Created" value={formatDate(submission?.created_at)} />
                </Section>

                {scores?.[0] && (
                    <Section title="Score">
                        <KV label="Overall" value={`${scores[0].overall_score}/100 (${scores[0].score_label})`} />
                        <KV label="Title" value={`${scores[0].title_score}/10`} />
                        <KV label="Description" value={`${scores[0].description_score}/10`} />
                        <KV label="Photos" value={`${scores[0].photo_score}/10`} />
                        <KV label="Amenities" value={`${scores[0].amenity_score}/10`} />
                        <KV label="Trust" value={`${scores[0].trust_score}/30`} />
                        <KV label="Market" value={`${scores[0].market_score}/30`} />
                        <KV label="Scored at" value={formatDate(scores[0].scored_at)} />
                    </Section>
                )}

                {(submission?.tier === "pro" || submission?.tier === "premium") && (
                    <Section title={`Analysis (${submission?.tier})`}>
                        {analyses?.[0] ? (
                            <>
                                <KV label="Status" value={analyses[0].status} />
                                <KV label="Analysed at" value={formatDate(analyses[0].analysed_at)} />
                                {analyses[0].status === "processing" && (
                                    <div style={{ marginTop: 8, padding: 8, background: "#FEF3C7", borderRadius: 6, fontSize: 12, color: "#92400E" }}>
                                        Analysis is still processing. If stuck for more than 5 minutes, use Retry on the main table.
                                    </div>
                                )}
                                {analyses[0].status === "failed" && (
                                    <div style={{ marginTop: 8, padding: 8, background: "#FEE2E2", borderRadius: 6, fontSize: 12, color: "#DC2626" }}>
                                        Analysis failed: {analyses[0].status_message || "Unknown error"}
                                    </div>
                                )}
                                {analyses[0].status === "complete" && (
                                    <div style={{ marginTop: 8, fontSize: 12 }}>
                                        <KV label="Rewrite" value={analyses[0].rewritten_title ? "Done" : "Missing"} />
                                        <KV label="Reviews" value={analyses[0].review_themes ? "Done" : "Missing"} />
                                        <KV label="Assessment" value={analyses[0].strengths ? "Done" : "Missing"} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ padding: 8, background: "#FEF3C7", borderRadius: 6, fontSize: 12, color: "#92400E" }}>
                                No analysis record found. Analysis may not have been triggered.
                            </div>
                        )}
                    </Section>
                )}

                <Section title="Email Delivery">
                    {emails?.length > 0 ? emails.map((e, i) => {
                        const statusColor = e.status === "sent" ? "#15803D" : e.status === "failed" ? "#DC2626" : e.status === "processing" ? "#2563EB" : "#92400E";
                        const statusBg = e.status === "sent" ? "#DCFCE7" : e.status === "failed" ? "#FEE2E2" : e.status === "processing" ? "#DBEAFE" : "#FEF3C7";
                        return (
                            <div key={i} style={{ marginBottom: 8, padding: 8, background: "#F9FAFB", borderRadius: 6, fontSize: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 9999, color: statusColor, background: statusBg }}>
                                        {e.status?.toUpperCase()}
                                    </span>
                                    {e.status === "pending" && e.send_at && <span style={{ fontSize: 11, color: "#6B7280" }}>Scheduled: {formatDate(e.send_at)}</span>}
                                    {e.status === "sent" && e.sent_at && <span style={{ fontSize: 11, color: "#15803D" }}>Delivered: {formatDate(e.sent_at)}</span>}
                                </div>
                                <KV label="Attempts" value={`${e.attempts || 0}/3`} />
                                {e.last_error && (
                                    <div style={{ marginTop: 4, padding: 6, background: "#FEE2E2", borderRadius: 4, fontSize: 11, color: "#DC2626", wordBreak: "break-word" }}>
                                        {e.last_error}
                                    </div>
                                )}
                            </div>
                        );
                    }) : (
                        <div style={{ padding: 8, background: "#F9FAFB", borderRadius: 6, fontSize: 12, color: "#6B7280" }}>
                            No email queued yet
                        </div>
                    )}
                </Section>

                {fetches?.length > 0 && (
                    <Section title="Fetches">
                        {fetches.map((f, i) => (
                            <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                                <span style={{ fontWeight: 500 }}>{f.provider}</span> — {f.fetch_status} — {formatDate(f.created_at)}
                            </div>
                        ))}
                    </Section>
                )}
            </div>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{title}</div>
            {children}
        </div>
    );
}

function KV({ label, value }) {
    return (
        <div style={{ display: "flex", fontSize: 13, lineHeight: 1.8 }}>
            <span style={{ color: "#6B7280", minWidth: 100 }}>{label}</span>
            <span style={{ fontWeight: 500 }}>{value ?? "-"}</span>
        </div>
    );
}

const td = { padding: "10px 12px", fontSize: 13, verticalAlign: "middle" };
const btnSmall = { border: "1px solid #E5E7EB", background: "#F9FAFB", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" };

export default function AdminDashboard() {
    const [secret, setSecret] = useState("");
    const [authed, setAuthed] = useState(false);
    const [submissions, setSubmissions] = useState([]);
    const [stuckCount, setStuckCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState({ status: "", tier: "", limit: 50 });
    const [forcing, setForcing] = useState(null);
    const [retrying, setRetrying] = useState(null);
    const [retried, setRetried] = useState({});
    const [detail, setDetail] = useState(null);
    const [lastRefresh, setLastRefresh] = useState(null);

    const apiCall = useCallback(async (action, params = {}) => {
        const res = await fetch("/api/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-admin-secret": secret },
            body: JSON.stringify({ action, ...params }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "API error");
        return data;
    }, [secret]);

    const refresh = useCallback(async () => {
        if (!secret) return;
        setLoading(true);
        setError(null);
        try {
            const params = { limit: filter.limit };
            if (filter.status) params.status = filter.status;
            if (filter.tier) params.tier = filter.tier;

            const [statusRes, stuckRes] = await Promise.all([
                apiCall("pipeline-status", params),
                apiCall("stuck-submissions"),
            ]);
            setSubmissions(statusRes.submissions || []);
            setStuckCount(stuckRes.stuck_count || 0);
            setLastRefresh(new Date());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [secret, filter, apiCall]);

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            await apiCall("pipeline-status", { limit: 1 });
            setAuthed(true);
            sessionStorage.setItem("lg_admin_secret", secret);
        } catch {
            setError("Invalid secret");
        }
    };

    const handleRetry = async (jobId) => {
        setRetrying(jobId);
        try {
            await apiCall("retry-analysis", { job_id: jobId });
            setRetried((prev) => ({ ...prev, [jobId]: true }));
            await refresh();
        } catch (err) {
            alert(`Retry failed: ${err.message}`);
        } finally {
            setRetrying(null);
        }
    };

    const handleForce = async (jobId) => {
        setForcing(jobId);
        try {
            await apiCall("force-send", { job_id: jobId });
            await refresh();
        } catch (err) {
            alert(`Force send failed: ${err.message}`);
        } finally {
            setForcing(null);
        }
    };

    const handleDetail = async (jobId) => {
        try {
            const data = await apiCall("submission-detail", { job_id: jobId });
            setDetail(data);
        } catch (err) {
            alert(`Detail failed: ${err.message}`);
        }
    };

    useEffect(() => {
        const saved = sessionStorage.getItem("lg_admin_secret");
        if (saved) {
            setSecret(saved);
            setAuthed(true);
        }
    }, []);

    useEffect(() => {
        if (authed) refresh();
    }, [authed, filter, refresh]);

    useEffect(() => {
        if (!authed) return;
        const interval = setInterval(refresh, POLL_INTERVAL);
        return () => clearInterval(interval);
    }, [authed, refresh]);

    if (!authed) {
        return (
            <>
                <Head><title>LetGrow Admin</title></Head>
                <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F3F4F6", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
                    <form onSubmit={handleLogin} style={{ background: "white", padding: 32, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", width: 340 }}>
                        <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#1B4332" }}>LetGrow Admin</h2>
                        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6B7280" }}>Enter your admin secret to continue</p>
                        <input
                            type="password"
                            value={secret}
                            onChange={(e) => { setSecret(e.target.value); setError(null); }}
                            placeholder="Admin secret"
                            style={{ width: "100%", padding: "10px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 12 }}
                        />
                        {error && <p style={{ color: "#DC2626", fontSize: 12, margin: "0 0 12px" }}>{error}</p>}
                        <button type="submit" style={{ width: "100%", padding: "10px 0", background: "#1B4332", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Log In</button>
                    </form>
                </div>
            </>
        );
    }

    const completed = submissions.filter((s) => s.status === "complete").length;
    const inProgress = submissions.filter((s) => !["complete", "failed"].includes(s.status)).length;
    const failed = submissions.filter((s) => s.status === "failed").length;

    return (
        <>
            <Head><title>LetGrow Admin</title></Head>
            <div style={{ minHeight: "100vh", background: "#F3F4F6", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
                {/* Header */}
                <div style={{ background: "#1B4332", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <span style={{ color: "white", fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>LETGROW</span>
                        <span style={{ color: "#86EFAC", fontSize: 13, marginLeft: 12 }}>Admin Dashboard</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {lastRefresh && <span style={{ color: "#86EFAC", fontSize: 11 }}>Updated {timeAgo(lastRefresh.toISOString())}</span>}
                        <button onClick={refresh} disabled={loading} style={{ background: "#15803D", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
                            {loading ? "..." : "Refresh"}
                        </button>
                        <button onClick={() => { sessionStorage.removeItem("lg_admin_secret"); setAuthed(false); setSecret(""); }} style={{ background: "transparent", color: "#86EFAC", border: "1px solid #86EFAC", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
                            Log Out
                        </button>
                    </div>
                </div>

                <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
                    {/* Stats */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                        <StatCard label="Total" value={submissions.length} color="#1B4332" />
                        <StatCard label="In Progress" value={inProgress} color="#2563EB" />
                        <StatCard label="Completed" value={completed} color="#15803D" />
                        <StatCard label={stuckCount > 0 ? "Stuck" : "Stuck"} value={stuckCount} color={stuckCount > 0 ? "#DC2626" : "#6B7280"} alert={stuckCount > 0} />
                    </div>

                    {/* Filters */}
                    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} style={selectStyle}>
                            <option value="">All statuses</option>
                            <option value="pending">Pending</option>
                            <option value="processing">Processing</option>
                            <option value="fetched">Fetched</option>
                            <option value="scored">Scored</option>
                            <option value="complete">Complete</option>
                            <option value="failed">Failed</option>
                        </select>
                        <select value={filter.tier} onChange={(e) => setFilter({ ...filter, tier: e.target.value })} style={selectStyle}>
                            <option value="">All tiers</option>
                            <option value="free">Free</option>
                            <option value="pro">Pro</option>
                            <option value="premium">Premium</option>
                        </select>
                        <select value={filter.limit} onChange={(e) => setFilter({ ...filter, limit: Number(e.target.value) })} style={selectStyle}>
                            <option value={20}>20 rows</option>
                            <option value={50}>50 rows</option>
                            <option value={100}>100 rows</option>
                            <option value={200}>200 rows</option>
                        </select>
                        {failed > 0 && (
                            <button onClick={() => setFilter({ ...filter, status: "failed" })} style={{ ...btnSmall, background: "#FEE2E2", color: "#DC2626", borderColor: "#FECACA" }}>
                                Show {failed} failed
                            </button>
                        )}
                    </div>

                    {error && <div style={{ padding: 12, background: "#FEE2E2", color: "#DC2626", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

                    {/* Table */}
                    <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ background: "#F9FAFB", borderBottom: "2px solid #E5E7EB" }}>
                                    <th style={th}>Job ID</th>
                                    <th style={th}>Customer</th>
                                    <th style={{ ...th, textAlign: "center" }}>Tier</th>
                                    <th style={{ ...th, textAlign: "center" }}>Status</th>
                                    <th style={th}>Pipeline</th>
                                    <th style={{ ...th, textAlign: "center" }}>Score</th>
                                    <th style={{ ...th, textAlign: "center" }}>Email</th>
                                    <th style={th}>When</th>
                                    <th style={th}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {submissions.map((sub) => (
                                    <SubmissionRow key={sub.id} sub={sub} onForce={handleForce} onRetry={handleRetry} onDetail={handleDetail} forcing={forcing} retrying={retrying} retried={retried} />
                                ))}
                                {submissions.length === 0 && !loading && (
                                    <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>No submissions found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <DetailModal detail={detail} onClose={() => setDetail(null)} />
            </div>
        </>
    );
}

function StatCard({ label, value, color, alert }) {
    return (
        <div style={{
            background: "white", borderRadius: 12, padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            borderLeft: `4px solid ${color}`,
            ...(alert ? { animation: "pulse 2s infinite" } : {}),
        }}>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
        </div>
    );
}

const th = { padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" };
const selectStyle = { padding: "6px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: 13, background: "white", cursor: "pointer" };
