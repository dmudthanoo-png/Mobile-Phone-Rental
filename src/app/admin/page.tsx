"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAILS = process.env.NEXT_PUBLIC_ADMIN_EMAILS?.split(',').map(e => e.trim()) ?? [];

type Booking = {
  id: string;
  created_at: string;
  renter_name: string;
  renter_phone: string;
  renter_email: string;
  package_name: string;
  rental_date: string;
  venue_name: string;
  total_amount: number;
  slip_url: string;
  ref_number: string;
  status: "pending" | "confirmed" | "rejected";
};

const THAI_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

function formatThaiDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function formatThaiDateTime(dateStr: string) {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}, ${time}`;
}

const doodle = {
  card: { borderRadius: 18, border: "2.5px solid #1a1a1a", boxShadow: "4px 4px 0px #1a1a1a", background: "#fff" } as React.CSSProperties,
  cardPink: { borderRadius: 18, border: "2.5px solid #1a1a1a", boxShadow: "4px 4px 0px #1a1a1a", background: "#FFE8F0" } as React.CSSProperties,
  cardYellow: { borderRadius: 18, border: "2.5px solid #1a1a1a", boxShadow: "4px 4px 0px #1a1a1a", background: "#FFF9E6" } as React.CSSProperties,
  cardGreen: { borderRadius: 18, border: "2.5px solid #1a1a1a", boxShadow: "4px 4px 0px #1a1a1a", background: "#EDFFF3" } as React.CSSProperties,
  btn: (bg: string, color = "#1a1a1a") => ({
    borderRadius: 50, border: "2.5px solid #1a1a1a", boxShadow: "3px 3px 0px #1a1a1a",
    fontWeight: 800, cursor: "pointer", background: bg, color,
    padding: "7px 16px", fontSize: 13, transition: "all .1s",
  } as React.CSSProperties),
};

function WiggleLine() {
  return (
    <svg width="100%" height="8" viewBox="0 0 300 8" preserveAspectRatio="none" style={{ display: "block", margin: "4px 0" }}>
      <path d="M0,4 Q15,0 30,4 Q45,8 60,4 Q75,0 90,4 Q105,8 120,4 Q135,0 150,4 Q165,8 180,4 Q195,0 210,4 Q225,8 240,4 Q255,0 270,4 Q285,8 300,4"
        fill="none" stroke="#FFB3D1" strokeWidth="2.5" />
    </svg>
  );
}

const STATUS_CONFIG = {
  pending:   { label: "รอยืนยัน",   emoji: "⏳", bg: "#FFF9E6", border: "#f59e0b", color: "#92400e" },
  confirmed: { label: "ยืนยันแล้ว", emoji: "✅", bg: "#EDFFF3", border: "#10b981", color: "#065f46" },
  rejected:  { label: "ปฏิเสธแล้ว", emoji: "❌", bg: "#FFF0F0", border: "#ef4444", color: "#991b1b" },
};

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "confirmed" | "rejected">("pending");
  const [slipModal, setSlipModal] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [newCount, setNewCount] = useState(0); // จำนวนรายการใหม่หลัง refresh

  const loadBookings = useCallback(async (isAuto = false) => {
    const res = await fetch("/api/admin/get-bookings");
    const data = await res.json();
    if (Array.isArray(data)) {
      if (isAuto) {
        // เช็คว่ามีรายการ pending ใหม่เพิ่มขึ้นไหม
        setBookings(prev => {
          const prevPending = prev.filter(b => b.status === "pending").length;
          const newPending = (data as Booking[]).filter(b => b.status === "pending").length;
          if (newPending > prevPending) setNewCount(newPending - prevPending);
          return data as Booking[];
        });
      } else {
        setBookings(data as Booking[]);
      }
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? "";
      if (!ADMIN_EMAILS.includes(email)) {
        router.replace("/");
        return;
      }
      setUserEmail(email);
      loadBookings().then(() => setLoading(false));
    });
  }, []);

  // ── Auto refresh ทุก 30 วินาที ──
  useEffect(() => {
    const interval = setInterval(() => loadBookings(true), 30000);
    return () => clearInterval(interval);
  }, [loadBookings]);

  // ── ล้าง newCount หลัง 5 วินาที ──
  useEffect(() => {
    if (newCount > 0) {
      const t = setTimeout(() => setNewCount(0), 5000);
      return () => clearTimeout(t);
    }
  }, [newCount]);

  async function updateStatus(bookingId: string, status: string) {
    setUpdating(bookingId);
    await fetch("/api/admin/update-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, status, userEmail }),
    });
    await loadBookings();
    setUpdating(null);
  }

  const filtered = filter === "all" ? bookings : bookings.filter(b => b.status === filter);
  const counts = {
    all: bookings.length,
    pending: bookings.filter(b => b.status === "pending").length,
    confirmed: bookings.filter(b => b.status === "confirmed").length,
    rejected: bookings.filter(b => b.status === "rejected").length,
  };

  // ── Summary totals ──
  const totalRevenue = bookings.filter(b => b.status === "confirmed").reduce((s, b) => s + b.total_amount, 0);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#FFF5F9", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: "'Mitr','Kanit','Segoe UI',sans-serif" }}>
      <div style={{ fontSize: 48 }}>🎵</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#888" }}>กำลังโหลด...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#FFF5F9", fontFamily: "'Mitr','Kanit','Segoe UI',sans-serif", padding: "24px 16px 60px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>
                  
                <span style={{ color: "#FF85B3" }}>หน้าต่างแอดมิน</span>
              </div>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>ระบบจอง</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Auto-refresh indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "2px solid #1a1a1a", borderRadius: 50, padding: "5px 12px" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#5FD16A", border: "1.5px solid #1a1a1a", animation: "pulse 2s infinite" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>
                  อัปเดตล่าสุด {lastUpdated.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <button
                onClick={() => loadBookings()}
                style={doodle.btn("#FFF9E6")}
              >
                🔄 รีเฟรช
              </button>
              <button
                onClick={() => supabase.auth.signOut().then(() => router.replace("/"))}
                style={doodle.btn("#1a1a1a", "#fff")}
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
          <WiggleLine />
        </div>

        {/* ── New booking toast ── */}
        {newCount > 0 && (
          <div style={{ ...doodle.cardPink, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            <span style={{ fontWeight: 800, fontSize: 14 }}>มีการจองใหม่ {newCount} รายการ!</span>
          </div>
        )}

        {/* ── Summary Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 ,color: "#1a1a1a"}}>
          {[
            { label: "รอยืนยัน", value: counts.pending, emoji: "⏳", style: doodle.cardYellow },
            { label: "ยืนยันแล้ว", value: counts.confirmed, emoji: "✅", style: doodle.cardGreen },
            { label: "ปฏิเสธแล้ว", value: counts.rejected, emoji: "❌", style: { ...doodle.card, background: "#FFF0F0" } },
            { label: "รายได้รวม", value: `฿${totalRevenue.toLocaleString()}`, emoji: "💰", style: doodle.cardPink },
          ].map(c => (
            <div key={c.label} style={{ ...c.style, padding: "14px 16px" }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{c.emoji}</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{c.value}</div>
              <div style={{ fontSize: 12, color: "#000000", fontWeight: 600 }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* ── Filter Tabs ── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {(["pending", "all", "confirmed", "rejected"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...doodle.btn(filter === f ? "#FF85B3" : "#fff"),
                boxShadow: filter === f ? "3px 3px 0 #1a1a1a" : "2px 2px 0 #ccc",
                border: filter === f ? "2.5px solid #1a1a1a" : "2px solid #ccc",
                color: "#1a1a1a",
              }}
            >
              {f === "pending"   ? `⏳ รอยืนยัน (${counts.pending})`
               : f === "confirmed" ? `✅ ยืนยัน (${counts.confirmed})`
               : f === "rejected"  ? `❌ ปฏิเสธ (${counts.rejected})`
               : `📋 ทั้งหมด (${counts.all})`}
            </button>
          ))}
        </div>

        {/* ── Booking Cards ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filtered.length === 0 && (
            <div style={{ ...doodle.card, padding: 40, textAlign: "center", color: "#aaa", fontWeight: 700 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
              ไม่มีรายการครับ
            </div>
          )}
          {filtered.map(b => {
            const st = STATUS_CONFIG[b.status];
            return (
              <div key={b.id} style={{ ...doodle.card, padding: "18px 20px" }}>

                {/* Top row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#FF85B3", border: "2.5px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#fff", flexShrink: 0 }}>
                      {b.renter_name[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 16, color: "#1a1a1a" }}>{b.renter_name}</div>
                      <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>{b.ref_number}</div>
                    </div>
                  </div>
                  <div style={{ background: st.bg, border: `2px solid ${st.border}`, borderRadius: 50, padding: "4px 14px", fontWeight: 700, fontSize: 13, color: st.color }}>
                    {st.emoji} {st.label}
                  </div>
                </div>

                <div style={{ height: 1, background: "#f0f0f0", margin: "10px 0" }} />

                {/* Info grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px 16px", fontSize: 13, fontWeight: 700, color: "#444", marginBottom: 14 }}>
                  <span>📱 {b.package_name}</span>
                  <span>📅 {formatThaiDate(b.rental_date)}</span>
                  <span>📍 {b.venue_name}</span>
                  <span>📞 {b.renter_phone}</span>
                  <span>💰 ฿{b.total_amount.toLocaleString()}</span>
                  <span>🕐 {formatThaiDateTime(b.created_at)}</span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {b.slip_url && (
                    <button onClick={() => setSlipModal(b.slip_url)} style={doodle.btn("#FFF9E6")}>
                      🧾 ดูสลิป
                    </button>
                  )}
                  {b.status === "pending" && (
                    <>
                      <button
                        onClick={() => updateStatus(b.id, "confirmed")}
                        disabled={updating === b.id}
                        style={{ ...doodle.btn("#EDFFF3"), border: "2.5px solid #10b981", color: "#065f46", boxShadow: "3px 3px 0 #10b981" }}
                      >
                        {updating === b.id ? "⏳..." : "✅ ยืนยัน"}
                      </button>
                      <button
                        onClick={() => updateStatus(b.id, "rejected")}
                        disabled={updating === b.id}
                        style={{ ...doodle.btn("#FFF0F0"), border: "2.5px solid #ef4444", color: "#991b1b", boxShadow: "3px 3px 0 #ef4444" }}
                      >
                        {updating === b.id ? "⏳..." : "❌ ปฏิเสธ"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Slip Modal ── */}
      {slipModal && (
        <div
          onClick={() => setSlipModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, border: "3px solid #1a1a1a", boxShadow: "6px 6px 0 #1a1a1a", overflow: "hidden", maxWidth: 420, width: "100%" }}>
            <div style={{ padding: "12px 16px", borderBottom: "2px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 900, fontSize: 15 }}>🧾 สลิปการโอน</span>
              <button onClick={() => setSlipModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", fontWeight: 900 }}>✕</button>
            </div>
            <img src={slipModal} alt="slip" style={{ width: "100%", display: "block" }} />
            <div style={{ padding: "10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#FF85B3", fontWeight: 700 }}>เปิดในแท็บใหม่ ↗</a>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}