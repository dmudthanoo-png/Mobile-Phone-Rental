"use client";

import { useEffect, useState } from "react";
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

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: "รอยืนยัน", color: "#f59e0b" },
  confirmed: { label: "ยืนยันแล้ว", color: "#10b981" },
  rejected:  { label: "ปฏิเสธแล้ว", color: "#ef4444" },
};

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "confirmed" | "rejected">("pending");
  const [slipModal, setSlipModal] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
    const email = data.user?.email ?? "";
    console.log('admin check - email:', email);
    console.log('admin check - ADMIN_EMAILS:', ADMIN_EMAILS);
    console.log('admin check - includes:', ADMIN_EMAILS.includes(email));
    if (!ADMIN_EMAILS.includes(email)) {
      router.replace("/");
      return;
    }
      setUserEmail(email);
      loadBookings();
      setLoading(false);
    });
  }, []);

async function loadBookings() {
  const res = await fetch('/api/admin/get-bookings');
  const data = await res.json();
  if (Array.isArray(data)) setBookings(data as Booking[]);
}
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

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFF0F5" }}>
      <p style={{ fontFamily: "sans-serif", fontSize: 18 }}>⏳ กำลังโหลด...</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#FFF0F5", fontFamily: "sans-serif", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ maxWidth: 900, margin: "0 auto 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>🎵 Admin Panel</h1>
            <p style={{ margin: "4px 0 0", color: "#666", fontSize: 14 }}>Concert Phone Rental</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut().then(() => router.replace("/"))}
            style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 20, padding: "8px 18px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
          >
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ maxWidth: 900, margin: "0 auto 20px", display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(["pending", "all", "confirmed", "rejected"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "8px 18px", borderRadius: 50, fontWeight: 700, fontSize: 13, cursor: "pointer",
              border: "2px solid #1a1a1a",
              background: filter === f ? "#1a1a1a" : "#fff",
              color: filter === f ? "#fff" : "#1a1a1a",
            }}
          >
            {f === "pending" ? `⏳ รอยืนยัน (${counts.pending})`
              : f === "confirmed" ? `✅ ยืนยันแล้ว (${counts.confirmed})`
              : f === "rejected" ? `❌ ปฏิเสธแล้ว (${counts.rejected})`
              : `📋 ทั้งหมด (${counts.all})`}
          </button>
        ))}
      </div>

      {/* Booking Cards */}
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#888" }}>ไม่มีรายการครับ</div>
        )}
        {filtered.map(b => {
          const st = STATUS_LABEL[b.status];
          return (
            <div key={b.id} style={{
              background: "#fff", border: "2px solid #1a1a1a", borderRadius: 16,
              boxShadow: "3px 3px 0 #1a1a1a", padding: "18px 20px",
            }}>
              {/* Top row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div>
                  <span style={{ fontWeight: 900, fontSize: 17 }}>{b.renter_name}</span>
                  <span style={{ marginLeft: 10, fontSize: 13, color: "#888" }}>{b.ref_number}</span>
                </div>
                <span style={{
                  background: st.color + "22", color: st.color,
                  border: `2px solid ${st.color}`, borderRadius: 20,
                  padding: "3px 14px", fontWeight: 700, fontSize: 13,
                }}>
                  {st.label}
                </span>
              </div>

              {/* Info grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "6px 16px", fontSize: 14, color: "#444", marginBottom: 14 }}>
                <span>📱 {b.package_name}</span>
                <span>📅 {new Date(b.rental_date).toLocaleDateString("th-TH", { dateStyle: "medium" })}</span>
                <span>📍 {b.venue_name}</span>
                <span>📞 {b.renter_phone}</span>
                <span>💰 ฿{b.total_amount.toLocaleString()}</span>
                <span>🕐 {new Date(b.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {b.slip_url && (
                  <button
                    onClick={() => setSlipModal(b.slip_url)}
                    style={{ padding: "7px 16px", borderRadius: 20, border: "2px solid #1a1a1a", background: "#fff9c4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >
                    🧾 ดูสลิป
                  </button>
                )}
                {b.status === "pending" && (
                  <>
                    <button
                      onClick={() => updateStatus(b.id, "confirmed")}
                      disabled={updating === b.id}
                      style={{ padding: "7px 16px", borderRadius: 20, border: "2px solid #10b981", background: "#d1fae5", color: "#065f46", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                    >
                      {updating === b.id ? "⏳..." : "✅ ยืนยัน"}
                    </button>
                    <button
                      onClick={() => updateStatus(b.id, "rejected")}
                      disabled={updating === b.id}
                      style={{ padding: "7px 16px", borderRadius: 20, border: "2px solid #ef4444", background: "#fee2e2", color: "#991b1b", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
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

      {/* Slip Modal */}
      {slipModal && (
        <div
          onClick={() => setSlipModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, border: "3px solid #1a1a1a", overflow: "hidden", maxWidth: 420, width: "100%" }}>
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