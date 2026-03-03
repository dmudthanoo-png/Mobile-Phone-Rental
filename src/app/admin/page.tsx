"use client";

import { useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  created_at: string;
  renter_name: string;
  renter_phone: string;
  package_name: string;
  rental_date: string;
  venue_name: string;
  total_amount: number;
  slip_url: string | null;
  ref_number: string;
  status: "pending" | "confirmed" | "rejected";
  line_sub?: string;
};

const THAI_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
];

const formatThaiDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(d)} ${THAI_MONTHS[parseInt(m) - 1]} ${parseInt(y) + 543}`;
};

const STATUS_META: Record<Booking["status"], { label: string; pillBg: string; pillBorder: string; text: string }> = {
  pending: { label: "⏳ รอยืนยัน", pillBg: "#FFF9E6", pillBorder: "#FCD34D", text: "#7A4B00" },
  confirmed: { label: "✅ ยืนยันแล้ว", pillBg: "#EFFFF2", pillBorder: "#6EE7B7", text: "#0B6B2C" },
  rejected: { label: "❌ ปฏิเสธ", pillBg: "#FFF1F2", pillBorder: "#FDA4AF", text: "#9F1239" },
};

const money = (n: number) => `฿${n.toLocaleString("th-TH")}`;

export default function AdminPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [password, setPassword] = useState("");

  const [summary, setSummary] = useState({ total: 0, pending: 0, confirmed: 0, rejected: 0, revenue: 0 });

  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [status, setStatus] = useState<"pending" | "confirmed" | "rejected" | "all">("pending");
  const [q, setQ] = useState("");
  const [slipModal, setSlipModal] = useState<string | null>(null);

  // ✅ responsive
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---------- shared UI tokens ----------
  const UI = {
    bg: "#FFF5F9",
    ink: "#111111",
    muted: "#4b5563",
    faint: "#6b7280",
    border: "#1a1a1a",
    shadow: isMobile ? "4px 4px 0 #1a1a1a" : "6px 6px 0 #1a1a1a",
    shadowSm: isMobile ? "2px 2px 0 #1a1a1a" : "3px 3px 0 #1a1a1a",
    radius: 18,
    radiusPill: 999,
    font: "'Mitr','Kanit','Segoe UI',sans-serif",
  };

  const btn = (variant: "white" | "dark" | "green" | "red" = "white", disabled = false) => {
    const base: React.CSSProperties = {
      borderRadius: UI.radiusPill,
      border: `2.5px solid ${UI.border}`,
      boxShadow: UI.shadowSm,
      padding: isMobile ? "10px 12px" : "10px 14px",
      fontWeight: 900,
      cursor: disabled ? "not-allowed" : "pointer",
      transform: "translateY(0)",
      transition: "transform 0.06s ease",
      userSelect: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      fontSize: isMobile ? 13 : 14,
      lineHeight: 1,
    };

    const styles: Record<string, React.CSSProperties> = {
      white: { background: "#fff", color: UI.ink },
      dark: { background: "#111", color: "#fff" },
      green: { background: "#25C06D", color: "#fff" },
      red: { background: "#FF4B4B", color: "#fff" },
    };

    const s = { ...base, ...(styles[variant] || styles.white) };

    if (disabled) {
      return {
        ...s,
        background: "#eee",
        color: "#9ca3af",
        boxShadow: "none",
      };
    }
    return s;
  };

  const inputStyle: React.CSSProperties = {
    width: isMobile ? "100%" : undefined,
    minWidth: isMobile ? undefined : 260,
    borderRadius: 14,
    border: `2.5px solid ${UI.border}`,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
    color: UI.ink,
    fontWeight: 700,
  };

  // ---------- data ----------
  const fetchSummary = async () => {
    try {
      const res = await fetch("/api/admin/bookings/summary", { cache: "no-store" });
      const out = await res.json();
      if (res.ok) setSummary(out);
    } catch (e) {
      console.error("fetchSummary failed:", e);
    }
  };

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("status", status);
      if (q.trim()) sp.set("q", q.trim());

      const res = await fetch(`/api/admin/bookings?${sp.toString()}`, { cache: "no-store" });
      const raw = await res.text();

      if (raw.trim().startsWith("<")) {
        console.error("API returned HTML");
        console.error("status:", res.status);
        console.error("url:", res.url);
        console.error("raw head:", raw.slice(0, 300));
        alert(`Admin API คืน HTML (status ${res.status}) ดู console`);
        return;
      }

      const out = raw ? JSON.parse(raw) : null;

      if (!res.ok) {
        console.error("admin bookings error:", out);
        setIsAuthed(false);
        setBookings([]);
        return;
      }

      setBookings((out?.bookings ?? []) as Booking[]);
    } catch (e) {
      console.error("fetchBookings failed:", e);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        alert("รหัสไม่ถูกต้อง");
        return;
      }
      setIsAuthed(true);
      setPassword("");
      await fetchBookings();
      await fetchSummary();
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAuthed(false);
    setBookings([]);
    setSummary({ total: 0, pending: 0, confirmed: 0, rejected: 0 , revenue: 0});
  };

  const setBookingStatus = async (id: string, next: "confirmed" | "rejected") => {
    try {
      const res = await fetch(`/api/admin/bookings/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
        cache: "no-store",
      });

      const raw = await res.text();

      if (raw.trim().startsWith("<")) {
        console.error("Admin status API returned HTML");
        console.error("status:", res.status);
        console.error("url:", res.url);
        console.error("raw head:", raw.slice(0, 300));
        alert(`เปลี่ยนสถานะไม่สำเร็จ (API คืน HTML, status ${res.status})`);
        return;
      }

      let out: any = null;
      try {
        out = raw ? JSON.parse(raw) : null;
      } catch {
        console.error("Non-JSON response:", raw);
        alert(`เปลี่ยนสถานะไม่สำเร็จ (API ไม่ได้คืน JSON, status ${res.status})`);
        return;
      }

      if (!res.ok) {
        console.error("update status failed:", res.status, out);
        alert(out?.error || `เปลี่ยนสถานะไม่สำเร็จ (status ${res.status})`);
        return;
      }

      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: next } : b)));
      fetchSummary();

      if (status === "pending") {
        fetchBookings();
      }
    } catch (e) {
      console.error("update status network error:", e);
      alert("เปลี่ยนสถานะไม่สำเร็จ (network error)");
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/bookings?status=pending`, { cache: "no-store" });
        if (res.ok) {
          setIsAuthed(true);
          const out = await res.json();
          setBookings((out?.bookings ?? []) as Booking[]);
          await fetchSummary();
        } else {
          setIsAuthed(false);
        }
      } catch {
        setIsAuthed(false);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchBookings();
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const totalRevenue = useMemo(() => {
    const sum = bookings
      .filter((b) => b.status === "confirmed")
      .reduce((acc, b) => acc + (b.total_amount || 0), 0);
    return sum;
  }, [bookings]);

  const CardStat = ({
    icon,
    value,
    label,
    bg,
  }: {
    icon: string;
    value: string;
    label: string;
    bg: string;
  }) => (
    <div
      style={{
        flex: isMobile ? "1 1 calc(50% - 10px)" : "1 1 220px",
        background: bg,
        borderRadius: 16,
        border: `2.5px solid ${UI.border}`,
        boxShadow: UI.shadow,
        padding: isMobile ? 12 : 14,
        minWidth: isMobile ? 0 : 210,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 22 }}>{icon}</div>
        <div>
          <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, lineHeight: 1.1, color: UI.ink }}>
            {value}
          </div>
          <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>{label}</div>
        </div>
      </div>
    </div>
  );

  const Pill = ({
    active,
    label,
    onClick,
    tone,
  }: {
    active: boolean;
    label: string;
    onClick: () => void;
    tone?: "pink" | "gray";
  }) => (
    <button
      onClick={onClick}
      style={{
        borderRadius: UI.radiusPill,
        border: `2px solid ${UI.border}`,
        padding: isMobile ? "9px 12px" : "8px 12px",
        fontWeight: 900,
        cursor: "pointer",
        background: active ? "#FF85B3" : tone === "gray" ? "#F3F4F6" : "#fff",
        boxShadow: active ? UI.shadowSm : "2px 2px 0 #1a1a1a",
        fontSize: isMobile ? 13 : 14,
        color: UI.ink,
      }}
    >
      {label}
    </button>
  );

  // ---------- Login ----------
  if (!isAuthed) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: UI.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          fontFamily: UI.font,
          color: UI.ink,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#fff",
            borderRadius: UI.radius,
            border: `2.5px solid ${UI.border}`,
            boxShadow: UI.shadow,
            padding: 22,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 6, color: UI.ink }}>
            🔐 Admin Login
          </div>
          <div style={{ fontSize: 12, color: UI.muted, fontWeight: 700, marginBottom: 14 }}>
            ใส่รหัสเพื่อเข้าหน้าแอดมิน
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="ADMIN_PASSWORD"
            style={{
              width: "100%",
              borderRadius: 14,
              border: `2.5px solid ${UI.border}`,
              padding: "10px 14px",
              fontSize: 14,
              outline: "none",
              color: UI.ink,
              fontWeight: 700,
            }}
          />

          <button
            onClick={handleLogin}
            disabled={loading || !password}
            style={btn("white", loading || !password)}
          >
            {loading ? "⏳ กำลังเข้าสู่ระบบ..." : "เข้าใช้งาน"}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Admin ----------
  return (
    <div style={{ minHeight: "100vh", background: UI.bg, padding: isMobile ? 14 : 20, fontFamily: UI.font, color: UI.ink }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: isMobile ? "1 1 100%" : undefined }}>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: "#FF5CA8" }}>หน้าต่างแอดมิน</div>
            <div style={{ fontSize: 12, color: UI.muted, fontWeight: 800 }}>ระบบจอง</div>
            <div style={{ height: 6, width: isMobile ? 220 : 260, borderBottom: "3px solid #FFB4D3", marginTop: 6, borderRadius: 999 }} />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
            <div
              style={{
                borderRadius: 999,
                border: `2px solid ${UI.border}`,
                background: "#fff",
                padding: "8px 12px",
                fontWeight: 900,
                boxShadow: "2px 2px 0 #1a1a1a",
                fontSize: 12,
                flex: isMobile ? "1 1 100%" : undefined,
              }}
            >
              🕒 อัปเดตล่าสุด {new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </div>

            <button
              onClick={() => {
                fetchBookings();
                fetchSummary();
              }}
              style={{ ...btn("white"), flex: isMobile ? "1 1 auto" : undefined }}
            >
              🔄 รีเฟรช
            </button>

            <button onClick={handleLogout} style={{ ...btn("dark"), flex: isMobile ? "1 1 auto" : undefined }}>
              ออกจากระบบ
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
          <CardStat icon="⏳" value={`${summary.pending}`} label="รอยืนยัน" bg="#FFF9E6" />
          <CardStat icon="✅" value={`${summary.confirmed}`} label="ยืนยันแล้ว" bg="#EFFFF2" />
          <CardStat icon="❌" value={`${summary.rejected}`} label="ปฏิเสธแล้ว" bg="#FFF1F2" />
          <CardStat icon="💰" value={money(summary.revenue || 0)} label="รายได้รวม" bg="#FFEFF7" />
        </div>

        {/* Pills + Search */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
          <Pill active={status === "pending"} onClick={() => setStatus("pending")} label={`🏆 รอยืนยัน (${summary.pending})`} />
          <Pill active={status === "all"} onClick={() => setStatus("all")} label={`📋 ทั้งหมด (${summary.total})`} tone="gray" />
          <Pill active={status === "confirmed"} onClick={() => setStatus("confirmed")} label={`✅ ยืนยัน (${summary.confirmed})`} tone="gray" />
          <Pill active={status === "rejected"} onClick={() => setStatus("rejected")} label={`❌ ปฏิเสธ (${summary.rejected})`} tone="gray" />

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา ref หรือชื่อ..." style={inputStyle} />
            <button onClick={fetchBookings} style={{ ...btn("white"), flex: isMobile ? "1 1 auto" : undefined }}>
              🔎 ค้นหา
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ marginTop: 14 }}>
          {loading && <div style={{ fontWeight: 900, color: UI.ink, marginBottom: 8 }}>⏳ กำลังโหลด...</div>}

          {!loading && bookings.length === 0 && (
            <div
              style={{
                background: "#fff",
                borderRadius: UI.radius,
                border: `2.5px solid ${UI.border}`,
                boxShadow: UI.shadow,
                padding: 16,
                fontWeight: 900,
                color: UI.muted,
              }}
            >
              ไม่มีรายการ
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {bookings.map((b) => {
              const meta = STATUS_META[b.status];
              const pending = b.status === "pending";

              return (
                <div
                  key={b.id}
                  style={{
                    background: "#fff",
                    borderRadius: UI.radius,
                    border: `2.5px solid ${UI.border}`,
                    boxShadow: UI.shadow,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: isMobile ? 12 : 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: "50%",
                            background: "#FF85B3",
                            border: `2px solid ${UI.border}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 900,
                            color: UI.ink,
                          }}
                        >
                          {(b.renter_name || "U").trim().slice(0, 1).toUpperCase()}
                        </div>

                        <div>
                          <div style={{ fontWeight: 900, fontSize: 16, color: UI.ink }}>{b.renter_name}</div>
                          <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>{b.ref_number}</div>
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: UI.radiusPill,
                          border: `2px solid ${meta.pillBorder}`,
                          background: meta.pillBg,
                          padding: "6px 12px",
                          fontWeight: 900,
                          color: meta.text,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          height: 34,
                        }}
                      >
                        {meta.label}
                      </div>
                    </div>

                    <div style={{ height: 1, background: "#f0f0f0", margin: "12px 0" }} />

                    {/* Info blocks: บนมือถือให้เรียงเป็น 2 คอลัมน์ */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(180px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>📦 แพ็กเกจ</div>
                        <div style={{ fontWeight: 900, color: UI.ink }}>{b.package_name}</div>
                        <div style={{ fontWeight: 900, color: UI.ink, marginTop: 6 }}>{money(b.total_amount)}</div>
                      </div>

                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>📅 วันรับ</div>
                        <div style={{ fontWeight: 900, color: UI.ink }}>{formatThaiDate(b.rental_date)}</div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted, marginTop: 6 }}>
                          🕒 {new Date(b.created_at).toLocaleString("th-TH")}
                        </div>
                      </div>

                      <div style={{ gridColumn: isMobile ? "1 / -1" : undefined }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>📍 สถานที่</div>
                        <div style={{ fontWeight: 900, color: UI.ink }}>{b.venue_name}</div>
                      </div>

                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>📞 โทร</div>
                        <div style={{ fontWeight: 900, color: UI.ink }}>{b.renter_phone}</div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                      <button
                        onClick={() => (b.slip_url ? setSlipModal(b.slip_url) : alert("ไม่มีสลิป"))}
                        style={{ ...btn("white"), flex: isMobile ? "1 1 100%" : undefined }}
                      >
                        🧾 ดูสลิป
                      </button>

                      <button
                        disabled={loading || !pending}
                        onClick={() => setBookingStatus(b.id, "confirmed")}
                        style={{ ...btn("green", loading || !pending), flex: isMobile ? "1 1 48%" : undefined }}
                      >
                        ✅ ยืนยัน
                      </button>

                      <button
                        disabled={loading || !pending}
                        onClick={() => setBookingStatus(b.id, "rejected")}
                        style={{ ...btn("red", loading || !pending), flex: isMobile ? "1 1 48%" : undefined }}
                      >
                        ❌ ปฏิเสธ
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
            style={{
              background: "#fff",
              borderRadius: 16,
              border: `3px solid ${UI.border}`,
              overflow: "hidden",
              maxWidth: 520,
              width: "100%",
              boxShadow: UI.shadow,
            }}
          >
            <div style={{ padding: "12px 16px", borderBottom: "2px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 900, color: UI.ink }}>🧾 สลิปการโอน</span>
              <button onClick={() => setSlipModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: UI.ink }}>
                ✕
              </button>
            </div>
            <img src={slipModal} alt="slip" style={{ width: "100%", display: "block" }} />
            <div style={{ padding: "10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#111", fontWeight: 900 }}>
                เปิดในแท็บใหม่ ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}