"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../Navbar";
import Footer from "../Footer";

type MeUser = {
  line_sub: string;
  name?: string | null;
  picture?: string | null;
};

type ConfirmedBooking = {
  id: string;
  status: string;
  concert_sessions: {
    start_at: string | null;
    note: string | null;
    concerts: { title: string | null } | null;
  } | null;
};

const ink = "#241F1C";
const sub = "#7A6D61";
const muted = "#AB9C8D";
const accent = "#F2467E";
const accentStrong = "#D81F5E";
const accent2 = "#8354E8";
const line = "#F2E4D6";
const borderStrong = "#E2CDB6";
const good = "#14B866";
const goodSoft = "#E1FAEC";

const glass = "rgba(255,255,255,0.55)";
const glassBorder = "rgba(255,255,255,0.65)";
const glassHighlight = "rgba(255,255,255,0.55)";
const glassBlur = "blur(18px) saturate(170%)";
const accentGlow = "rgba(242,70,126,0.40)";
const uiFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, Roboto, sans-serif";

const card: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${glassBorder}`,
  boxShadow: `0 1px 2px rgba(35,32,31,0.04), 0 8px 24px -14px rgba(35,32,31,0.16), inset 0 1px 0 ${glassHighlight}`,
  background: glass,
  backdropFilter: glassBlur,
  WebkitBackdropFilter: glassBlur,
};

const btnPrimary: React.CSSProperties = {
  border: "none",
  borderRadius: 999,
  boxShadow: `0 10px 26px -10px ${accentGlow}, inset 0 1px 0 rgba(255,255,255,0.35)`,
  fontWeight: 700,
  cursor: "pointer",
  background: `linear-gradient(135deg, ${accent}, ${accentStrong})`,
  color: "#fff",
  fontFamily: uiFont,
};

function AmbientGlow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        background:
          "radial-gradient(60vw 60vw circle at 12% 0%, rgba(242,70,126,0.30), rgba(242,70,126,0) 70%)," +
          "radial-gradient(55vw 55vw circle at 100% 15%, rgba(131,84,232,0.26), rgba(131,84,232,0) 70%)," +
          "radial-gradient(60vw 60vw circle at 82% 100%, rgba(35,201,214,0.22), rgba(35,201,214,0) 72%)",
      }}
    />
  );
}

function formatSessionLabel(b: ConfirmedBooking) {
  const s = b.concert_sessions;
  if (!s?.start_at) return s?.note ?? "-";
  const dt = new Date(s.start_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  return `${s.note ?? "รอบ"} • ${dt}`;
}

export default function ReviewPage() {
  const router = useRouter();
  const [meUser, setMeUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<ConfirmedBooking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const meRes = await fetch("/api/me", { cache: "no-store" });
        const me = await meRes.json();
        if (!me.user) {
          router.push(me?.error === "banned" ? "/login?error=banned" : "/login");
          return;
        }
        setMeUser(me.user);
        if (me.user.name) setDisplayName(me.user.name);

        const bRes = await fetch("/api/bookings/my-v2", { cache: "no-store" });
        const bOut = await bRes.json().catch(() => null);
        const confirmed = ((bOut?.bookings ?? []) as ConfirmedBooking[]).filter(
          (b) => b.status === "confirmed"
        );
        setBookings(confirmed);
        if (confirmed.length === 1) setSelectedBookingId(confirmed[0].id);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router]);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const canSubmit =
    !submitting && !!selectedBookingId && displayName.trim().length > 0 && rating > 0 && comment.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          booking_id: selectedBookingId,
          display_name: displayName.trim(),
          rating,
          comment: comment.trim(),
        }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        if (out?.error === "already_reviewed") {
          setError("การจองนี้เคยรีวิวไปแล้วครับ");
        } else {
          setError(out?.error || "ส่งรีวิวไม่สำเร็จ");
        }
        return;
      }
      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "ส่งรีวิวไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFF9F3", fontFamily: uiFont, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <img src="/crabby-logo.png" alt="Crabby" style={{ width: 56, height: "auto" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: sub }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFF9F3", fontFamily: uiFont, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", isolation: "isolate" }}>
      <AmbientGlow />
      <div style={{ width: "100%" }}>
        <Navbar user={meUser} onSignOut={handleSignOut} />
      </div>

      <div style={{ width: "100%", maxWidth: 640, padding: "28px 32px 40px", flex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>
            <span style={{ color: ink }}>เขียน</span>{" "}
            <span style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              รีวิว
            </span>
          </div>
          <div style={{ fontSize: 13, color: sub, fontWeight: 500, marginTop: 4 }}>
            แชร์ประสบการณ์การเช่ามือถือกับ Crabby ให้เพื่อนๆ ฟังหน่อย
          </div>
        </div>

        {submitted ? (
          <div style={{ ...card, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: ink, marginBottom: 6 }}>ขอบคุณสำหรับรีวิว!</div>
            <p style={{ fontSize: 13, color: sub, fontWeight: 500, lineHeight: 1.6, marginBottom: 20 }}>
              ทีมงานได้รับรีวิวของคุณแล้ว ขอบคุณที่สละเวลาแชร์ประสบการณ์ให้เราครับ
            </p>
            <button onClick={() => router.push("/")} style={{ ...btnPrimary, padding: "12px 28px", fontSize: 14 }}>
              กลับหน้าแรก
            </button>
          </div>
        ) : bookings.length === 0 ? (
          <div style={{ ...card, padding: 32, textAlign: "center", color: ink }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎫</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>ยังไม่มีการจองที่ยืนยันแล้ว</div>
            <p style={{ fontSize: 13, color: sub, fontWeight: 500, lineHeight: 1.6 }}>
              รีวิวได้เฉพาะการจองที่แอดมินยืนยันแล้วเท่านั้นครับ ลองกลับมาใหม่หลังรับเครื่องแล้วนะครับ
            </p>
          </div>
        ) : (
          <div style={{ ...card, padding: 20 }}>
            {error && (
              <div style={{ background: "#FFE4E9", border: "1px solid #F9C7D1", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "#C43D5C", marginBottom: 16 }}>
                ⚠️ {error}
              </div>
            )}

            {bookings.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: ink, marginBottom: 8 }}>
                  เลือกการจองที่ต้องการรีวิว
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {bookings.map((b) => {
                    const sel = selectedBookingId === b.id;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBookingId(b.id)}
                        style={{
                          textAlign: "left",
                          padding: "10px 14px",
                          borderRadius: 12,
                          border: `1.5px solid ${sel ? accent2 : line}`,
                          background: sel ? "#EFE6FF" : "#fff",
                          cursor: "pointer",
                          fontFamily: uiFont,
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13, color: ink }}>
                          {b.concert_sessions?.concerts?.title ?? "-"}
                        </div>
                        <div style={{ fontSize: 11, color: sub, fontWeight: 500 }}>{formatSessionLabel(b)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {bookings.length === 1 && (
              <div style={{ background: goodSoft, border: `1px solid ${good}`, borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: sub, fontWeight: 600 }}>กำลังรีวิว</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: ink }}>
                  {bookings[0].concert_sessions?.concerts?.title ?? "-"}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: ink, marginBottom: 8 }}>
                ให้คะแนน
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`ให้ ${n} ดาว`}
                    style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 32, padding: 0, lineHeight: 1, color: n <= (hoverRating || rating) ? "#F5B93F" : "#EDE7E1" }}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: ink, marginBottom: 8 }}>
                ชื่อที่จะแสดง
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                placeholder="เช่น มิ้นท์, ต้นหอม"
                style={{ width: "100%", borderRadius: 12, border: `1px solid ${borderStrong}`, padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: uiFont, color: ink, boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: ink, marginBottom: 8 }}>
                เล่าประสบการณ์ของคุณ
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                rows={5}
                placeholder="เครื่องเป็นยังไงบ้าง บริการดีไหม อยากบอกอะไรเพื่อนๆ ที่กำลังตัดสินใจ..."
                style={{ width: "100%", borderRadius: 12, border: `1px solid ${borderStrong}`, padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: uiFont, color: ink, resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ textAlign: "right", fontSize: 11, color: muted, marginTop: 4 }}>{comment.length}/1000</div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                ...(canSubmit ? btnPrimary : { ...btnPrimary, background: "#F1F0EE", color: muted, boxShadow: "none", cursor: "not-allowed" }),
                width: "100%",
                padding: "14px 0",
                fontSize: 15,
              }}
            >
              {submitting ? "กำลังส่ง..." : "ส่งรีวิว"}
            </button>
          </div>
        )}
      </div>

      <div style={{ width: "100%" }}>
        <Footer />
      </div>
    </div>
  );
}
