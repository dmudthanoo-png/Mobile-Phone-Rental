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
  ref_number: string;
  status: "pending" | "confirmed" | "rejected";
  pending_expires_at?: string | null;

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

const STATUS_CONFIG = {
  pending: { label: "⏳ รอยืนยัน", bg: "#FFF9E6", color: "#b45309", border: "#FCD34D" },
  confirmed: { label: "✅ ยืนยันแล้ว", bg: "#F0FFF4", color: "#065f46", border: "#6EE7B7" },
  rejected: { label: "❌ ไม่อนุมัติ", bg: "#FFF1F2", color: "#9f1239", border: "#FDA4AF" },
};

const doodle = {
  card: {
    borderRadius: "18px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "4px 4px 0px #1a1a1a",
    background: "#fff",
  } as CSSProperties,
};

function formatSessionStart(startAt?: string | null) {
  if (!startAt) return "-";
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export default function BookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [slipModal, setSlipModal] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newSlipFile, setNewSlipFile] = useState<File | null>(null);
  const [newSlipPreview, setNewSlipPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadMyBookings = async () => {
    // ✅ ใช้ v2 (join session+concert+phone)
    const res = await fetch("/api/bookings/my-v2", { cache: "no-store" });
    const raw = await res.text();

    let out: any = null;
    try {
      out = raw ? JSON.parse(raw) : null;
    } catch {
      console.error("Non-JSON /api/bookings/my-v2:", raw);
      throw new Error("API not json");
    }

    if (!res.ok) {
      throw new Error(out?.error || "failed to load bookings");
    }

    setBookings((out?.bookings ?? []) as Booking[]);
  };

  useEffect(() => {
    const run = async () => {
      // เช็ค login จาก cookie
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const meRaw = await meRes.text();
      let me: any = null;

      try {
        me = meRaw ? JSON.parse(meRaw) : null;
      } catch {
        console.error("Non-JSON /api/me:", meRaw);
        router.push("/login");
        return;
      }

      if (!me?.user) {
        router.push("/login");
        return;
      }

      try {
        await loadMyBookings();
      } catch (e) {
        console.error(e);
        router.push("/login");
        return;
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [router]);

  const handleUploadNewSlip = async (bookingId: string) => {
    if (!newSlipFile) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("booking_id", bookingId);
      form.append("slip", newSlipFile);

      const res = await fetch("/api/bookings/update-slip", { method: "POST", body: form });
      const raw = await res.text();

      let out: any = null;
      try {
        out = raw ? JSON.parse(raw) : null;
      } catch {
        console.error("Non-JSON /api/bookings/update-slip:", raw);
        throw new Error("API not json");
      }

      if (!res.ok) {
        alert(out?.error || "เกิดข้อผิดพลาด กรุณาลองใหม่ครับ");
        return;
      }

      const newUrl = out.slip_url as string;
      setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, slip_url: newUrl } : b)));

      setEditingId(null);
      setNewSlipFile(null);
      setNewSlipPreview(null);
      alert("✅ อัปเดตสลิปเรียบร้อยแล้วครับ!");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาด กรุณาลองใหม่ครับ");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#FFF5F9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
          fontFamily: "inherit",
        }}
      >
        <div style={{ fontSize: 48 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#888" }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FFF5F9",
        fontFamily: "'Mitr', 'Kanit', 'Segoe UI', sans-serif",
        display: "flex",
        justifyContent: "center",
        paddingBottom: 40,
      }}
    >
      <div style={{ width: "100%", maxWidth: 480 }}>
        {/* Header */}
        <div style={{ padding: "24px 20px 16px", position: "sticky", top: 0, background: "#FFF5F9", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, color: "#1a1a1a" }}>
            <button
              onClick={() => router.push("/")}
              style={{
                background: "#fff",
                border: "2.5px solid #1a1a1a",
                borderRadius: 50,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "2px 2px 0 #1a1a1a",
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              ←
            </button>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#1a1a1a" }}>📋 ประวัติการจอง</div>
              <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>รายการจองทั้งหมดของคุณ</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 20px" }}>
          {/* Empty state */}
          {bookings.length === 0 && (
            <div style={{ ...doodle.card, padding: 40, textAlign: "center", marginTop: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>ยังไม่มีการจอง</div>
              <p style={{ fontSize: 13, color: "#888", fontWeight: 600, marginBottom: 20 }}>เริ่มจองมือถือสำหรับคอนเสิร์ตได้เลยครับ!</p>
              <button
                onClick={() => router.push("/")}
                style={{
                  background: "#FF85B3",
                  border: "2.5px solid #1a1a1a",
                  borderRadius: 50,
                  padding: "10px 24px",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "3px 3px 0 #1a1a1a",
                  fontFamily: "inherit",
                }}
              >
                จองเลย 📱
              </button>
            </div>
          )}

          {/* Booking Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4, color: "#1a1a1a" }}>
            {bookings.map((b) => {
              const st = STATUS_CONFIG[b.status];

              const concertTitle = b.concert_sessions?.concerts?.title ?? "คอนเสิร์ต";
              const venueName = b.concert_sessions?.concerts?.venue_name ?? "-";
              const phoneModel = b.phones?.model_name ?? "-";
              const sessionLabel = formatSessionStart(b.concert_sessions?.start_at);

              return (
                <div key={b.id} style={{ ...doodle.card, padding: 18 }}>
                  {/* Top row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{concertTitle}</div>
                      <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginTop: 2 }}>
                        {phoneModel} • {b.ref_number}
                      </div>
                    </div>
                    <span
                      style={{
                        background: st.bg,
                        color: st.color,
                        border: `2px solid ${st.border}`,
                        borderRadius: 20,
                        padding: "4px 12px",
                        fontWeight: 700,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {st.label}
                    </span>
                  </div>

                  {/* Info */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", fontSize: 13, marginBottom: 14 }}>
                    {[
                      ["🗓️", sessionLabel],
                      ["📍", venueName],
                      ["💰", `฿${b.total_amount.toLocaleString()}`],
                      ["🕐", new Date(b.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })],
                    ].map(([icon, val]) => (
                      <div key={`${b.id}-${icon}`} style={{ display: "flex", alignItems: "center", gap: 6, color: "#444", fontWeight: 600 }}>
                        <span>{icon}</span>
                        <span>{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Status message */}
                  {b.status === "pending" && (
                    <div style={{ background: "#FFF9E6", border: "2px dashed #FCD34D", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>
                      ⏳ รอ admin ตรวจสอบสลิปและยืนยันการจองครับ
                    </div>
                  )}
                  {b.status === "confirmed" && (
                    <div style={{ background: "#F0FFF4", border: "2px dashed #6EE7B7", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#065f46" }}>
                      ✅ การจองได้รับการยืนยันแล้ว! กรุณามารับมือถือก่อนคอนเสิร์ตครับ
                    </div>
                  )}
                  {b.status === "rejected" && (
                    <div style={{ background: "#FFF1F2", border: "2px dashed #FDA4AF", borderRadius: 12, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#9f1239" }}>
                      ❌ การจองถูกปฏิเสธ กรุณาติดต่อ LINE OA เพื่อสอบถามครับ
                    </div>
                  )}

                  {/* Slip buttons */}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {b.slip_url && (
                      <button
                        onClick={() => setSlipModal(b.slip_url!)}
                        style={{
                          background: "#FFF9E6",
                          border: "2px solid #1a1a1a",
                          borderRadius: 20,
                          padding: "6px 14px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          boxShadow: "2px 2px 0 #1a1a1a",
                          fontFamily: "inherit",
                        }}
                      >
                        🧾 ดูสลิป
                      </button>
                    )}

                    {b.status === "pending" && (
                      <button
                        onClick={() => {
                          setEditingId(editingId === b.id ? null : b.id);
                          setNewSlipFile(null);
                          setNewSlipPreview(null);
                        }}
                        style={{
                          background: "#EEF2FF",
                          border: "2px solid #1a1a1a",
                          borderRadius: 20,
                          padding: "6px 14px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          boxShadow: "2px 2px 0 #1a1a1a",
                          fontFamily: "inherit",
                        }}
                      >
                        ✏️ เปลี่ยนสลิป
                      </button>
                    )}
                  </div>

                  {/* Upload new slip */}
                  {editingId === b.id && (
                    <div style={{ marginTop: 12, background: "#F8F8FF", border: "2px dashed #6366f1", borderRadius: 14, padding: 14 }}>
                      <label style={{ cursor: "pointer", display: "block" }}>
                        <div style={{ textAlign: "center", marginBottom: newSlipPreview ? 10 : 0 }}>
                          {newSlipPreview ? (
                            <img
                              src={newSlipPreview}
                              alt="new slip"
                              style={{ maxHeight: 120, borderRadius: 10, objectFit: "contain", margin: "0 auto", display: "block", border: "2px solid #1a1a1a" }}
                            />
                          ) : (
                            <div style={{ padding: "10px 0", fontSize: 13, fontWeight: 700, color: "#6366f1" }}>📎 แตะเพื่อเลือกสลิปใหม่</div>
                          )}
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              setNewSlipFile(f);
                              setNewSlipPreview(URL.createObjectURL(f));
                            }
                          }}
                        />
                      </label>

                      {newSlipPreview && (
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button
                            onClick={() => handleUploadNewSlip(b.id)}
                            disabled={uploading}
                            style={{
                              flex: 1,
                              background: "#5FD16A",
                              border: "2px solid #1a1a1a",
                              borderRadius: 20,
                              padding: "8px 0",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              color: "#fff",
                              opacity: uploading ? 0.7 : 1,
                            }}
                          >
                            {uploading ? "⏳ กำลังอัปโหลด..." : "✅ บันทึกสลิปใหม่"}
                          </button>
                          <button
                            onClick={() => {
                              setNewSlipFile(null);
                              setNewSlipPreview(null);
                            }}
                            style={{
                              background: "#FFF1F2",
                              border: "2px solid #ef4444",
                              borderRadius: 20,
                              padding: "8px 14px",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              color: "#ef4444",
                            }}
                          >
                            ยกเลิก
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* New booking button */}
          {bookings.length > 0 && (
            <button
              onClick={() => router.push("/")}
              style={{
                marginTop: 20,
                width: "100%",
                background: "#FF85B3",
                border: "2.5px solid #1a1a1a",
                borderRadius: 50,
                padding: "13px 0",
                fontWeight: 800,
                fontSize: 15,
                cursor: "pointer",
                boxShadow: "3px 3px 0 #1a1a1a",
                fontFamily: "inherit",
              }}
            >
              + จองเพิ่ม 📱
            </button>
          )}
        </div>
      </div>

      {/* Slip Modal */}
      {slipModal && (
        <div
          onClick={() => setSlipModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, border: "3px solid #1a1a1a", overflow: "hidden", maxWidth: 380, width: "100%" }}
          >
            <div style={{ padding: "12px 16px", borderBottom: "2px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800 }}>🧾 สลิปการโอน</span>
              <button onClick={() => setSlipModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <img src={slipModal} alt="slip" style={{ width: "100%", display: "block" }} />
            <div style={{ padding: "10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#6366f1", fontWeight: 600 }}>
                เปิดในแท็บใหม่ ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}