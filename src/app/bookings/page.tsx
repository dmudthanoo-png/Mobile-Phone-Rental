"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "../Navbar";
import Footer from "../Footer";

type MeUser = {
  line_sub: string;
  name?: string | null;
  picture?: string | null;
};

type Booking = {
  id: string;
  created_at: string;
  renter_name: string;
  renter_phone?: string | null;
  total_amount: number;
  slip_url: string | null;
  ref_number: string | null;
  status: "confirmed" | "rejected" | "pending" | "waiting_review" | string;
  add_lens?: boolean;
  lens_price?: number;
  concert_sessions?: {
    id: string;
    start_at: string;
    end_at: string | null;
    note: string | null;
    concerts?: {
      id: string;
      title: string;
      venue_name: string | null;
      poster_url: string | null;
    } | null;
  } | null;
  phones?: {
    id: string;
    model_name: string;
    image_url: string | null;
    price: number | null;
  } | null;
};

// ── shared design tokens (same as homepage / how-to-book) ──────────────────────
const ink = "#241F1C";
const sub = "#7A6D61";
const accent = "#F2467E";
const accentStrong = "#D81F5E";
const accent2 = "#8354E8";
const line = "#F2E4D6";
const good = "#14B866";
const goodSoft = "#E1FAEC";
const goodBorder = "#B7EFC5";
const critical = "#EF4463";
const criticalSoft = "#FFE4E9";
const criticalBorder = "#F9C7D1";
const warningSoft = "#FFF3D6";
const warningBorder = "#F3E3B8";
const warningText = "#8A6D2F";
const violetSoft = "#EFE6FF";
const violetBorder = "#DCD2F5";

const glass = "rgba(255,255,255,0.55)";
const glassBorder = "rgba(255,255,255,0.65)";
const glassHighlight = "rgba(255,255,255,0.55)";
const glassBlur = "blur(18px) saturate(170%)";
const accentGlow = "rgba(242,70,126,0.40)";
const uiFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, Roboto, sans-serif";

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  confirmed:      { label: "✅ ยืนยันแล้ว", bg: goodSoft, color: good, border: goodBorder },
  rejected:       { label: "❌ ไม่อนุมัติ",  bg: criticalSoft, color: critical, border: criticalBorder },
  pending:        { label: "⏳ รอตรวจสอบ",   bg: warningSoft, color: warningText, border: warningBorder },
  waiting_review: { label: "🔍 รอแอดมิน",   bg: violetSoft, color: accent2, border: violetBorder },
};
const DEFAULT_STATUS = { label: "❓ ไม่ทราบสถานะ", bg: "#F5F5F5", color: sub, border: line };

const card: CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${glassBorder}`,
  boxShadow: `0 1px 2px rgba(35,32,31,0.04), 0 8px 24px -14px rgba(35,32,31,0.16), inset 0 1px 0 ${glassHighlight}`,
  background: glass,
  backdropFilter: glassBlur,
  WebkitBackdropFilter: glassBlur,
};

const btnPrimary: CSSProperties = {
  border: "none",
  borderRadius: 999,
  boxShadow: `0 10px 26px -10px ${accentGlow}, inset 0 1px 0 rgba(255,255,255,0.35)`,
  fontWeight: 700,
  cursor: "pointer",
  // Gradient stops biased so accentStrong (#D81F5E, 4.91:1 on white text) covers the
  // center where the label sits; accent (#F2467E, 3.53:1) only shows at the far edge.
  // Keeps the brand gradient look while fixing sub-19px bold white label contrast.
  background: `linear-gradient(135deg, ${accentStrong}, ${accentStrong} 55%, ${accent})`,
  color: "#fff",
  fontFamily: uiFont,
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
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
          "radial-gradient(60vw circle at 12% 0%, rgba(242,70,126,0.30), rgba(242,70,126,0) 70%)," +
          "radial-gradient(55vw circle at 100% 15%, rgba(131,84,232,0.26), rgba(131,84,232,0) 70%)," +
          "radial-gradient(60vw circle at 82% 100%, rgba(35,201,214,0.22), rgba(35,201,214,0) 72%)",
      }}
    />
  );
}

function formatSessionStart(startAt?: string | null) {
  if (!startAt) return "-";
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      zIndex: 9999, maxWidth: 340, width: "calc(100% - 40px)",
      background: type === "success" ? goodSoft : criticalSoft,
      border: `1px solid ${type === "success" ? goodBorder : criticalBorder}`,
      borderRadius: 16, padding: "12px 16px",
      boxShadow: "0 8px 24px rgba(35,32,31,0.14)",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      fontFamily: uiFont,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: type === "success" ? good : critical }}>
        {type === "success" ? "✅" : "⚠️"} {message}
      </span>
      <button
        onClick={onClose}
        aria-label="ปิดการแจ้งเตือน"
        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: sub, flexShrink: 0, minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >✕</button>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const [meUser, setMeUser] = useState<MeUser | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [slipModal, setSlipModal] = useState<string | null>(null);
  const [viewingSlipId, setViewingSlipId] = useState<string | null>(null);

  const viewSlip = async (bookingId: string) => {
    setViewingSlipId(bookingId);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/slip-url`, { cache: "no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) { setToast({ message: out?.error || "ไม่มีสลิป", type: "error" }); return; }
      setSlipModal(out.url);
    } finally {
      setViewingSlipId(null);
    }
  };

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [updateSlipBookingId, setUpdateSlipBookingId] = useState<string | null>(null);
  const [updateSlipFile, setUpdateSlipFile] = useState<File | null>(null);
  const [updateSlipPreview, setUpdateSlipPreview] = useState<string | null>(null);
  const [updateSlipSubmitting, setUpdateSlipSubmitting] = useState(false);
  const [updateSlipError, setUpdateSlipError] = useState<string>("");

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.error(e);
    } finally {
      router.push("/login");
    }
  };

  const handleUpdateSlip = async () => {
    if (!updateSlipBookingId || !updateSlipFile) return;
    setUpdateSlipSubmitting(true);
    setUpdateSlipError("");
    try {
      const form = new FormData();
      form.append("booking_id", updateSlipBookingId);
      form.append("slip", updateSlipFile);
      const res = await fetch("/api/bookings/update-slip", { method: "POST", body: form, cache: "no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        const errMsg = out?.message || out?.error || "เปลี่ยนสลิปไม่สำเร็จ";
        setUpdateSlipError(errMsg);
        setToast({ message: errMsg, type: "error" });
        return;
      }
      setToast({ message: "เปลี่ยนสลิปสำเร็จแล้ว รอแอดมินตรวจสอบครับ", type: "success" });
      setUpdateSlipBookingId(null);
      setUpdateSlipFile(null);
      setUpdateSlipPreview(null);
      await loadMyBookings();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
      setUpdateSlipError(errMsg);
      setToast({ message: errMsg, type: "error" });
    } finally {
      setUpdateSlipSubmitting(false);
    }
  };

  const loadMyBookings = async () => {
    const res = await fetch("/api/bookings/my-v2", { cache: "no-store" });
    const raw = await res.text();
    let out: { bookings?: Booking[]; error?: string } | null = null;
    try { out = raw ? JSON.parse(raw) : null; } catch { throw new Error("API not json"); }
    if (!res.ok) throw new Error(out?.error || "failed to load bookings");
    setBookings((out?.bookings ?? []) as Booking[]);
  };

  useEffect(() => {
    const run = async () => {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meRaw = await meRes.text();
      let me: { user?: MeUser; error?: string } | null = null;
      try { me = meRaw ? JSON.parse(meRaw) : null; } catch { router.push("/login"); return; }
      if (!me?.user) {
        router.push(me?.error === "banned" ? "/login?error=banned" : "/login");
        return;
      }
      setMeUser(me.user);
      try { await loadMyBookings(); }
      catch (e) { console.error(e); router.push("/login"); }
      finally { setLoading(false); }
    };
    run();
  }, [router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFF9F3", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: uiFont }}>
        <Image src="/crabby-logo.png" alt="Crabby" width={835} height={771} style={{ width: 56, height: "auto" }} priority />
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

      <div style={{ width: "100%", maxWidth: 760, flex: 1 }}>

        {/* Header */}
        <div style={{ padding: "28px 32px 16px" }}>
          <button
            onClick={() => router.push("/")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: accent2, padding: "10px 0", marginBottom: 2, marginTop: -10, fontFamily: uiFont, display: "inline-flex", alignItems: "center", minHeight: 44 }}
          >
            ← กลับไปหน้าเลือกคอนเสิร์ต
          </button>
          <div style={{ fontSize: 26, fontWeight: 800 }}>
            <span style={{ color: ink }}>ประวัติ</span>{" "}
            <span
              style={{
                background: `linear-gradient(135deg, ${accent}, ${accent2})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              การจอง
            </span>
          </div>
          <div style={{ fontSize: 13, color: sub, fontWeight: 500, marginTop: 2 }}>รายการจองทั้งหมดของคุณ</div>
        </div>

        <div style={{ padding: "0 32px" }}>
          {bookings.length === 0 && (
            <div style={{ ...card, padding: 40, textAlign: "center", marginTop: 8 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: ink }}>ยังไม่มีประวัติการจอง</div>
              <p style={{ fontSize: 13, color: sub, fontWeight: 500, marginBottom: 20 }}>เมื่อคุณชำระเงินแล้ว รายการจะมาแสดงที่นี่ครับ</p>
              <button onClick={() => router.push("/")} style={{ ...btnPrimary, padding: "10px 24px", fontSize: 14 }}>
                จองเลย 📱
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
            {bookings.map((b) => {
              const st           = STATUS_CONFIG[b.status] ?? DEFAULT_STATUS;
              const concertTitle = b.concert_sessions?.concerts?.title ?? "คอนเสิร์ต";
              const venueName    = b.concert_sessions?.concerts?.venue_name ?? "-";
              const phoneModel   = b.phones?.model_name ?? "-";
              const sessionLabel = formatSessionStart(b.concert_sessions?.start_at);

              return (
                <div key={b.id} style={{ ...card, padding: 18 }}>
                  {/* Title row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: ink }}>{concertTitle}</div>
                      <div style={{ fontSize: 12, color: sub, fontWeight: 500, marginTop: 2 }}>
                        {phoneModel}{b.ref_number ? ` • ${b.ref_number}` : ""}
                      </div>
                    </div>
                    <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}`, borderRadius: 20, padding: "4px 12px", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                      {st.label}
                    </span>
                  </div>

                  {/* Lens badge */}
                  {b.add_lens && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: violetSoft, border: `1px solid ${violetBorder}`, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, color: accent2, marginBottom: 10 }}>
                      🔭 Lens ซูม +฿{(b.lens_price ?? 0).toLocaleString()}
                    </div>
                  )}

                  {/* Info grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", fontSize: 13, marginBottom: 14 }}>
                    {[
                      ["🗓️", "วันเวลาคอนเสิร์ต", sessionLabel],
                      ["📍", "สถานที่",            venueName],
                      ["💰", "ยอดชำระ",            `฿${b.total_amount.toLocaleString()}`],
                      ["🕐", "วันที่จอง",          new Date(b.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })],
                    ].map(([icon, label, val]) => (
                      <div key={`${b.id}-${label}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: sub }}>{icon} {label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: ink }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {b.status === "confirmed" && (
                    <div style={{ background: goodSoft, border: `1px dashed ${goodBorder}`, borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: good }}>
                      ✅ การจองได้รับการยืนยันแล้ว! กรุณามารับมือถือก่อนคอนเสิร์ตครับ
                    </div>
                  )}
                  {b.status === "rejected" && (
                    <div style={{ background: criticalSoft, border: `1px dashed ${criticalBorder}`, borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: critical }}>
                      ❌ การจองถูกปฏิเสธ กรุณาเปลี่ยนสลิปหรือติดต่อ LINE OA ครับ
                    </div>
                  )}
                  {(b.status === "pending" || b.status === "waiting_review") && (
                    <div style={{ background: warningSoft, border: `1px dashed ${warningBorder}`, borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: warningText }}>
                      ⏳ รอแอดมินตรวจสอบสลิป กรุณารอสักครู่ครับ
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {b.slip_url && (
                      <button
                        disabled={viewingSlipId === b.id}
                        onClick={() => viewSlip(b.id)}
                        style={{ background: warningSoft, border: `1px solid ${warningBorder}`, color: warningText, borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: viewingSlipId === b.id ? "default" : "pointer", fontFamily: uiFont, minHeight: 44, display: "inline-flex", alignItems: "center", opacity: viewingSlipId === b.id ? 0.6 : 1 }}
                      >
                        {viewingSlipId === b.id ? "⏳ กำลังโหลด..." : "🧾 ดูสลิป"}
                      </button>
                    )}
                    {(b.status === "pending" || b.status === "rejected") && (
                      <button onClick={() => { setUpdateSlipBookingId(b.id); setUpdateSlipFile(null); setUpdateSlipPreview(null); setUpdateSlipError(""); }} style={{ background: violetSoft, border: `1px solid ${violetBorder}`, color: accent2, borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: uiFont, minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                        🔄 เปลี่ยนสลิป
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {bookings.length > 0 && (
            <button onClick={() => router.push("/")} style={{ ...btnPrimary, marginTop: 20, width: "100%", padding: "13px 0", fontSize: 15 }}>
              + จองเพิ่ม 📱
            </button>
          )}
        </div>
      </div>

      <div style={{ width: "100%" }}>
        <Footer />
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Update Slip Modal */}
      {updateSlipBookingId && (
        <div onClick={() => setUpdateSlipBookingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(36,31,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20, cursor: "pointer" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, border: `1px solid ${line}`, maxWidth: 380, width: "100%", overflow: "hidden", fontFamily: uiFont, cursor: "default" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: ink }}>🔄 เปลี่ยนสลิป</span>
              <button
                onClick={() => setUpdateSlipBookingId(null)}
                aria-label="ปิดหน้าต่างเปลี่ยนสลิป"
                style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub, minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >✕</button>
            </div>
            <div style={{ padding: 16 }}>
              {updateSlipError && (
                <div style={{ background: criticalSoft, border: `1px solid ${criticalBorder}`, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: critical, marginBottom: 12 }}>
                  ⚠️ {updateSlipError}
                </div>
              )}
              <label style={{ cursor: "pointer", display: "block" }}>
                <div style={{ border: `1.5px dashed ${updateSlipPreview ? goodBorder : "#D8D5CE"}`, borderRadius: 14, padding: 16, textAlign: "center", background: updateSlipPreview ? goodSoft : "#fff" }}>
                  {updateSlipPreview ? (
                    <div>
                      <img src={updateSlipPreview} alt="slip" style={{ maxHeight: 160, borderRadius: 10, objectFit: "contain", margin: "0 auto", display: "block" }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: good }}>เลือกแล้ว แตะเพื่อเปลี่ยน</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 32, marginBottom: 4 }}>📎</div>
                      <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: ink }}>เลือกสลิปใหม่</p>
                      <p style={{ fontSize: 11, color: sub, margin: "4px 0 0", fontWeight: 500 }}>JPG, PNG, WEBP</p>
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setUpdateSlipFile(f); setUpdateSlipPreview(URL.createObjectURL(f)); }
                }} />
              </label>
              <button
                onClick={handleUpdateSlip}
                disabled={!updateSlipFile || updateSlipSubmitting}
                style={{
                  ...btnPrimary,
                  marginTop: 12,
                  width: "100%",
                  padding: "11px 0",
                  fontSize: 14,
                  ...(!updateSlipFile || updateSlipSubmitting
                    ? { background: "#F1F0EE", color: "#B4B6BC", cursor: "not-allowed", boxShadow: "none" }
                    : {}),
                }}
              >
                {updateSlipSubmitting ? "กำลังส่ง..." : "✓ ยืนยันเปลี่ยนสลิป"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slip Modal */}
      {slipModal && (
        <div onClick={() => setSlipModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(36,31,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20, cursor: "pointer" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, border: `1px solid ${line}`, overflow: "hidden", maxWidth: 380, width: "100%", fontFamily: uiFont, cursor: "default" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: ink }}>🧾 สลิปการโอน</span>
              <button
                onClick={() => setSlipModal(null)}
                aria-label="ปิดหน้าต่างดูสลิป"
                style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub, minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >✕</button>
            </div>
            <img src={slipModal} alt="slip" style={{ width: "100%", display: "block" }} />
            <div style={{ padding: "10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: accent2, fontWeight: 600, display: "inline-block", padding: "8px 0" }}>เปิดในแท็บใหม่ ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
