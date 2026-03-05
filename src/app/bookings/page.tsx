"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

type Booking = {
  id: string;
  created_at: string;
  renter_name: string;
  renter_phone?: string | null;
  total_amount: number;
  slip_url: string | null;
  ref_number: string | null;
  status: "confirmed" | "rejected" | "pending" | "waiting_review" | string;
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

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  confirmed:     { label: "✅ ยืนยันแล้ว",  bg: "#F0FFF4", color: "#065f46", border: "#6EE7B7" },
  rejected:      { label: "❌ ไม่อนุมัติ",  bg: "#FFF1F2", color: "#9f1239", border: "#FDA4AF" },
  pending:       { label: "⏳ รอตรวจสอบ",   bg: "#FFF9E6", color: "#92400e", border: "#FCD34D" },
  waiting_review:{ label: "🔍 รอแอดมิน",   bg: "#EFF6FF", color: "#1e40af", border: "#93C5FD" },
};
const DEFAULT_STATUS = { label: "❓ ไม่ทราบสถานะ", bg: "#F5F5F5", color: "#555", border: "#ccc" };

const doodle = {
  card: { borderRadius: "18px", border: "2.5px solid #1a1a1a", boxShadow: "4px 4px 0px #1a1a1a", background: "#fff" } as CSSProperties,
};

function formatSessionStart(startAt?: string | null) {
  if (!startAt) return "-";
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

// ✅ Toast component
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
      border: `2.5px solid ${type === "success" ? "#6EE7B7" : "#FDA4AF"}`,
      borderRadius: 16, padding: "12px 16px",
      boxShadow: "4px 4px 0px #1a1a1a",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      fontFamily: "'Mitr', 'Kanit', sans-serif",
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: type === "success" ? "#065f46" : "#9f1239" }}>
        {type === "success" ? "✅" : "⚠️"} {message}
      </span>
      <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#888", flexShrink: 0 }}>✕</button>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [slipModal, setSlipModal] = useState<string | null>(null);

  // ✅ Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [updateSlipBookingId, setUpdateSlipBookingId] = useState<string | null>(null);
  const [updateSlipFile, setUpdateSlipFile] = useState<File | null>(null);
  const [updateSlipPreview, setUpdateSlipPreview] = useState<string | null>(null);
  const [updateSlipSubmitting, setUpdateSlipSubmitting] = useState(false);
  const [updateSlipError, setUpdateSlipError] = useState<string>("");

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
        // ✅ toast error
        setToast({ message: errMsg, type: "error" });
        return;
      }
      // ✅ toast success
      setToast({ message: "เปลี่ยนสลิปสำเร็จแล้ว รอแอดมินตรวจสอบครับ", type: "success" });
      setUpdateSlipBookingId(null);
      setUpdateSlipFile(null);
      setUpdateSlipPreview(null);
      await loadMyBookings();
    } catch (e: any) {
      const errMsg = e?.message || "เกิดข้อผิดพลาด";
      setUpdateSlipError(errMsg);
      setToast({ message: errMsg, type: "error" });
    } finally {
      setUpdateSlipSubmitting(false);
    }
  };

  const loadMyBookings = async () => {
    const res = await fetch("/api/bookings/my-v2", { cache: "no-store" });
    const raw = await res.text();
    let out: any = null;
    try { out = raw ? JSON.parse(raw) : null; }
    catch { throw new Error("API not json"); }
    if (!res.ok) throw new Error(out?.error || "failed to load bookings");
    setBookings((out?.bookings ?? []) as Booking[]);
  };

  useEffect(() => {
    const run = async () => {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meRaw = await meRes.text();
      let me: any = null;
      try { me = meRaw ? JSON.parse(meRaw) : null; } catch { router.push("/login"); return; }
      if (!me?.user) { router.push("/login"); return; }
      try { await loadMyBookings(); }
      catch (e) { console.error(e); router.push("/login"); }
      finally { setLoading(false); }
    };
    run();
  }, [router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFF5F9", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: "inherit" }}>
        <div style={{ fontSize: 48 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#888" }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFF5F9", fontFamily: "'Mitr', 'Kanit', 'Segoe UI', sans-serif", display: "flex", justifyContent: "center", paddingBottom: 40 }}>
      <div style={{ width: "100%", maxWidth: 480 }}>

        {/* Header */}
        <div style={{ padding: "24px 20px 16px", position: "sticky", top: 0, background: "#FFF5F9", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, color: "#1a1a1a" }}>
            <button onClick={() => router.push("/")} style={{ background: "#fff", border: "2.5px solid #1a1a1a", borderRadius: 50, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "2px 2px 0 #1a1a1a", fontSize: 16, flexShrink: 0 }}>←</button>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#1a1a1a" }}>📋 ประวัติการจอง</div>
              <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>รายการจองทั้งหมดของคุณ</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 20px" }}>
          {bookings.length === 0 && (
            <div style={{ ...doodle.card, padding: 40, textAlign: "center", marginTop: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>ยังไม่มีประวัติการจอง</div>
              <p style={{ fontSize: 13, color: "#888", fontWeight: 600, marginBottom: 20 }}>เมื่อคุณชำระเงินแล้ว รายการจะมาแสดงที่นี่ครับ</p>
              <button onClick={() => router.push("/")} style={{ background: "#FF85B3", border: "2.5px solid #1a1a1a", borderRadius: 50, padding: "10px 24px", fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "3px 3px 0 #1a1a1a", fontFamily: "inherit" }}>
                จองเลย 📱
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4, color: "#1a1a1a" }}>
            {bookings.map((b) => {
              const st = STATUS_CONFIG[b.status] ?? DEFAULT_STATUS;
              const concertTitle = b.concert_sessions?.concerts?.title ?? "คอนเสิร์ต";
              const venueName = b.concert_sessions?.concerts?.venue_name ?? "-";
              const phoneModel = b.phones?.model_name ?? "-";
              const sessionLabel = formatSessionStart(b.concert_sessions?.start_at);

              return (
                <div key={b.id} style={{ ...doodle.card, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{concertTitle}</div>
                      <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginTop: 2 }}>
                        {phoneModel}{b.ref_number ? ` • ${b.ref_number}` : ""}
                      </div>
                    </div>
                    <span style={{ background: st.bg, color: st.color, border: `2px solid ${st.border}`, borderRadius: 20, padding: "4px 12px", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                      {st.label}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", fontSize: 13, marginBottom: 14 }}>
                    {[
                      ["🗓️", sessionLabel],
                      ["📍", venueName],
                      ["💰", `฿${b.total_amount.toLocaleString()}`],
                      ["🕐", new Date(b.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })],
                    ].map(([icon, val]) => (
                      <div key={`${b.id}-${icon}`} style={{ display: "flex", alignItems: "center", gap: 6, color: "#444", fontWeight: 600 }}>
                        <span>{icon}</span><span>{val}</span>
                      </div>
                    ))}
                  </div>

                  {b.status === "confirmed" && (
                    <div style={{ background: "#F0FFF4", border: "2px dashed #6EE7B7", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#065f46" }}>
                      ✅ การจองได้รับการยืนยันแล้ว! กรุณามารับมือถือก่อนคอนเสิร์ตครับ
                    </div>
                  )}
                  {b.status === "rejected" && (
                    <div style={{ background: "#FFF1F2", border: "2px dashed #FDA4AF", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#9f1239" }}>
                      ❌ การจองถูกปฏิเสธ กรุณาเปลี่ยนสลิปหรือติดต่อ LINE OA ครับ
                    </div>
                  )}
                  {(b.status === "pending" || b.status === "waiting_review") && (
                    <div style={{ background: "#FFF9E6", border: "2px dashed #FCD34D", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>
                      ⏳ รอแอดมินตรวจสอบสลิป กรุณารอสักครู่ครับ
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {b.slip_url && (
                      <button onClick={() => setSlipModal(b.slip_url!)} style={{ background: "#FFF9E6", border: "2px solid #1a1a1a", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "2px 2px 0 #1a1a1a", fontFamily: "inherit" }}>
                        🧾 ดูสลิป
                      </button>
                    )}
                    {(b.status === "pending" || b.status === "rejected") && (
                      <button onClick={() => { setUpdateSlipBookingId(b.id); setUpdateSlipFile(null); setUpdateSlipPreview(null); setUpdateSlipError(""); }} style={{ background: "#EFF6FF", border: "2px solid #1a1a1a", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "2px 2px 0 #1a1a1a", fontFamily: "inherit" }}>
                        🔄 เปลี่ยนสลิป
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {bookings.length > 0 && (
            <button onClick={() => router.push("/")} style={{ marginTop: 20, width: "100%", background: "#FF85B3", border: "2.5px solid #1a1a1a", borderRadius: 50, padding: "13px 0", fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: "3px 3px 0 #1a1a1a", fontFamily: "inherit" }}>
              + จองเพิ่ม 📱
            </button>
          )}
        </div>
      </div>

      {/* ✅ Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Update Slip Modal */}
      {updateSlipBookingId && (
        <div onClick={() => setUpdateSlipBookingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, border: "3px solid #1a1a1a", maxWidth: 380, width: "100%", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "2px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800 }}>🔄 เปลี่ยนสลิป</span>
              <button onClick={() => setUpdateSlipBookingId(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: 16 }}>
              {updateSlipError && (
                <div style={{ background: "#FFF1F2", border: "2px solid #FDA4AF", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#9f1239", marginBottom: 12 }}>
                  ⚠️ {updateSlipError}
                </div>
              )}
              <label style={{ cursor: "pointer", display: "block" }}>
                <div style={{ border: "2.5px dashed #1a1a1a", borderRadius: 14, padding: 16, textAlign: "center", background: updateSlipPreview ? "#F0FFF4" : "#FFFDF5" }}>
                  {updateSlipPreview ? (
                    <div>
                      <img src={updateSlipPreview} alt="slip" style={{ maxHeight: 160, borderRadius: 10, objectFit: "contain", margin: "0 auto", display: "block", border: "2px solid #1a1a1a" }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#5FD16A" }}>✅ เลือกแล้ว แตะเพื่อเปลี่ยน</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 32, marginBottom: 4 }}>📎</div>
                      <p style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>เลือกสลิปใหม่</p>
                      <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0", fontWeight: 600 }}>JPG, PNG, WEBP</p>
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
                style={{ marginTop: 12, width: "100%", background: !updateSlipFile || updateSlipSubmitting ? "#eee" : "#FF85B3", border: "2.5px solid #1a1a1a", borderRadius: 50, padding: "11px 0", fontWeight: 800, fontSize: 14, cursor: !updateSlipFile || updateSlipSubmitting ? "not-allowed" : "pointer", boxShadow: "3px 3px 0 #1a1a1a", fontFamily: "inherit", color: "#1a1a1a" }}
              >
                {updateSlipSubmitting ? "⏳ กำลังส่ง..." : "✓ ยืนยันเปลี่ยนสลิป"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slip Modal */}
      {slipModal && (
        <div onClick={() => setSlipModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, border: "3px solid #1a1a1a", overflow: "hidden", maxWidth: 380, width: "100%" }}>
            <div style={{ padding: "12px 16px", borderBottom: "2px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800 }}>🧾 สลิปการโอน</span>
              <button onClick={() => setSlipModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <img src={slipModal} alt="slip" style={{ width: "100%", display: "block" }} />
            <div style={{ padding: "10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#6366f1", fontWeight: 600 }}>เปิดในแท็บใหม่ ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}