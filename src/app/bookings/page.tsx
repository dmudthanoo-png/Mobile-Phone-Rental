"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../Navbar";

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

// ── shared design tokens (same as homepage) ──────────────────────
const ink = "#332E2C";
const sub = "#A39A93";
const accent = "#F2679E";
const accent2 = "#7A57D1";
const line = "#F0E9E2";
const navFont = "var(--font-itim), 'Kanit', 'Segoe UI', sans-serif";

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  confirmed:      { label: "✅ ยืนยันแล้ว", bg: "#F0FFF4", color: "#0F9D4E", border: "#B7EFC5" },
  rejected:       { label: "❌ ไม่อนุมัติ",  bg: "#FFF1F2", color: "#C43D5C", border: "#F9C7D1" },
  pending:        { label: "⏳ รอตรวจสอบ",   bg: "#FFFBEF", color: "#8A6D2F", border: "#F3E3B8" },
  waiting_review: { label: "🔍 รอแอดมิน",   bg: "#F1EDFC", color: "#6A4FC0", border: "#DCD2F5" },
};
const DEFAULT_STATUS = { label: "❓ ไม่ทราบสถานะ", bg: "#F5F5F5", color: sub, border: line };

const card: CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${line}`,
  boxShadow: "0 1px 2px rgba(20,20,20,0.04)",
  background: "#fff",
};

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
      background: type === "success" ? "#F0FFF4" : "#FFF1F2",
      border: `1px solid ${type === "success" ? "#B7EFC5" : "#F9C7D1"}`,
      borderRadius: 16, padding: "12px 16px",
      boxShadow: "0 8px 24px rgba(20,20,20,0.12)",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      fontFamily: navFont,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: type === "success" ? "#0F9D4E" : "#C43D5C" }}>
        {type === "success" ? "✅" : "⚠️"} {message}
      </span>
      <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: sub, flexShrink: 0 }}>✕</button>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const [meUser, setMeUser] = useState<MeUser | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [slipModal, setSlipModal] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [updateSlipBookingId, setUpdateSlipBookingId] = useState<string | null>(null);
  const [updateSlipFile, setUpdateSlipFile] = useState<File | null>(null);
  const [updateSlipPreview, setUpdateSlipPreview] = useState<string | null>(null);
  const [updateSlipSubmitting, setUpdateSlipSubmitting] = useState(false);
  const [updateSlipError, setUpdateSlipError] = useState<string>("");

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
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
      let me: { user?: MeUser } | null = null;
      try { me = meRaw ? JSON.parse(meRaw) : null; } catch { router.push("/login"); return; }
      if (!me?.user) { router.push("/login"); return; }
      setMeUser(me.user);
      try { await loadMyBookings(); }
      catch (e) { console.error(e); router.push("/login"); }
      finally { setLoading(false); }
    };
    run();
  }, [router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFFBF7", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: navFont }}>
        <img src="/crabby-logo.png" alt="Crabby" style={{ width: 56, height: "auto" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: sub }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFFBF7", fontFamily: navFont, display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 40 }}>
      <div style={{ width: "100%" }}>
        <Navbar user={meUser} onSignOut={handleSignOut} />
      </div>

      <div style={{ width: "100%", maxWidth: 640 }}>

        {/* Header */}
        <div style={{ padding: "28px 24px 16px" }}>
          <button
            onClick={() => router.push("/")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: accent2, padding: 0, marginBottom: 10 }}
          >
            ← กลับไปหน้าเลือกคอนเสิร์ต
          </button>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
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

        <div style={{ padding: "0 24px" }}>
          {bookings.length === 0 && (
            <div style={{ ...card, padding: 40, textAlign: "center", marginTop: 8 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: ink }}>ยังไม่มีประวัติการจอง</div>
              <p style={{ fontSize: 13, color: sub, fontWeight: 500, marginBottom: 20 }}>เมื่อคุณชำระเงินแล้ว รายการจะมาแสดงที่นี่ครับ</p>
              <button
                onClick={() => router.push("/")}
                style={{
                  border: "none",
                  borderRadius: 999,
                  background: `linear-gradient(135deg, ${accent}, #E1477F)`,
                  color: "#fff",
                  padding: "10px 24px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(232,85,143,0.3)",
                  fontFamily: "inherit",
                }}
              >
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
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#F1EDFC", border: `1px solid #DCD2F5`, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, color: accent2, marginBottom: 10 }}>
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
                    <div style={{ background: "#F0FFF4", border: "1px dashed #B7EFC5", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#0F9D4E" }}>
                      ✅ การจองได้รับการยืนยันแล้ว! กรุณามารับมือถือก่อนคอนเสิร์ตครับ
                    </div>
                  )}
                  {b.status === "rejected" && (
                    <div style={{ background: "#FFF1F2", border: "1px dashed #F9C7D1", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#C43D5C" }}>
                      ❌ การจองถูกปฏิเสธ กรุณาเปลี่ยนสลิปหรือติดต่อ LINE OA ครับ
                    </div>
                  )}
                  {(b.status === "pending" || b.status === "waiting_review") && (
                    <div style={{ background: "#FFFBEF", border: "1px dashed #F3E3B8", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#8A6D2F" }}>
                      ⏳ รอแอดมินตรวจสอบสลิป กรุณารอสักครู่ครับ
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {b.slip_url && (
                      <button onClick={() => setSlipModal(b.slip_url!)} style={{ background: "#FFFBEF", border: `1px solid #F3E3B8`, color: "#8A6D2F", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        🧾 ดูสลิป
                      </button>
                    )}
                    {(b.status === "pending" || b.status === "rejected") && (
                      <button onClick={() => { setUpdateSlipBookingId(b.id); setUpdateSlipFile(null); setUpdateSlipPreview(null); setUpdateSlipError(""); }} style={{ background: "#F1EDFC", border: `1px solid #DCD2F5`, color: accent2, borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        🔄 เปลี่ยนสลิป
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {bookings.length > 0 && (
            <button
              onClick={() => router.push("/")}
              style={{
                marginTop: 20,
                width: "100%",
                border: "none",
                borderRadius: 999,
                background: `linear-gradient(135deg, ${accent}, #E1477F)`,
                color: "#fff",
                padding: "13px 0",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(232,85,143,0.3)",
                fontFamily: "inherit",
              }}
            >
              + จองเพิ่ม 📱
            </button>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Update Slip Modal */}
      {updateSlipBookingId && (
        <div onClick={() => setUpdateSlipBookingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(51,46,44,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, border: `1px solid ${line}`, maxWidth: 380, width: "100%", overflow: "hidden", fontFamily: navFont }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: ink }}>🔄 เปลี่ยนสลิป</span>
              <button onClick={() => setUpdateSlipBookingId(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub }}>✕</button>
            </div>
            <div style={{ padding: 16 }}>
              {updateSlipError && (
                <div style={{ background: "#FFF1F2", border: "1px solid #F9C7D1", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#C43D5C", marginBottom: 12 }}>
                  ⚠️ {updateSlipError}
                </div>
              )}
              <label style={{ cursor: "pointer", display: "block" }}>
                <div style={{ border: `1.5px dashed ${updateSlipPreview ? "#8FD4A8" : "#D8D5CE"}`, borderRadius: 14, padding: 16, textAlign: "center", background: updateSlipPreview ? "#F3FBF5" : "#fff" }}>
                  {updateSlipPreview ? (
                    <div>
                      <img src={updateSlipPreview} alt="slip" style={{ maxHeight: 160, borderRadius: 10, objectFit: "contain", margin: "0 auto", display: "block" }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#0F9D4E" }}>เลือกแล้ว แตะเพื่อเปลี่ยน</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 32, marginBottom: 4 }}>📎</div>
                      <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: ink }}>เลือกสลิปใหม่</p>
                      <p style={{ fontSize: 11, color: "#B4B6BC", margin: "4px 0 0", fontWeight: 500 }}>JPG, PNG, WEBP</p>
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
                  marginTop: 12,
                  width: "100%",
                  border: "none",
                  borderRadius: 999,
                  background: !updateSlipFile || updateSlipSubmitting ? "#F1F0EE" : `linear-gradient(135deg, ${accent}, #E1477F)`,
                  color: !updateSlipFile || updateSlipSubmitting ? "#B4B6BC" : "#fff",
                  padding: "11px 0",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: !updateSlipFile || updateSlipSubmitting ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
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
        <div onClick={() => setSlipModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(51,46,44,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, border: `1px solid ${line}`, overflow: "hidden", maxWidth: 380, width: "100%", fontFamily: navFont }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: ink }}>🧾 สลิปการโอน</span>
              <button onClick={() => setSlipModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub }}>✕</button>
            </div>
            <img src={slipModal} alt="slip" style={{ width: "100%", display: "block" }} />
            <div style={{ padding: "10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: accent2, fontWeight: 600 }}>เปิดในแท็บใหม่ ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
