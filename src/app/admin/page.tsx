"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────── types ───────────────────────────────
type Booking = {
  id: string;
  created_at: string;
  renter_name: string;
  renter_phone: string;
  total_amount: number;
  slip_url: string | null;
  ref_number: string | null;
  status: "pending" | "confirmed" | "rejected";
  concert_sessions?: {
    start_at: string | null;
    note: string | null;
    concerts?: { title: string; venue_name: string | null } | null;
  } | null;
  phones?: { model_name: string } | null;
};

type Concert = { id: string; title: string; venue_name: string | null; poster_url: string | null; description: string | null; archived: boolean | null };
type Session = { id: string; start_at: string | null; end_at: string | null; note: string | null };
type Phone   = { id: string; model_name: string; price: number; deposit: number; qty: number; image_url: string | null; active: boolean };
type Summary = { total: number; pending: number; confirmed: number; rejected: number; revenue: number };

// ─────────────────────────────── helpers ───────────────────────────────
const money = (n: number | null | undefined) => n != null ? `฿${n.toLocaleString("th-TH")}` : "-";
const fmtDT = (iso: string | null | undefined) => {
  if (!iso) return "-";
  try {
    const normalized = /Z|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "Z";
    return new Date(normalized).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  } catch { return "-"; }
};

const localToUTC = (localDT: string) => {
  if (!localDT) return null;
  return new Date(localDT).toISOString();
};

const STATUS_META = {
  pending:   { label: "⏳ รอยืนยัน",  pillBg: "#FFF9E6", pillBorder: "#FCD34D", text: "#7A4B00" },
  confirmed: { label: "✅ ยืนยันแล้ว", pillBg: "#EFFFF2", pillBorder: "#6EE7B7", text: "#0B6B2C" },
  rejected:  { label: "❌ ปฏิเสธ",     pillBg: "#FFF1F2", pillBorder: "#FDA4AF", text: "#9F1239" },
};

// ─────────────────────────────── UI tokens ───────────────────────────────
const UI = {
  bg: "#FFF5F9", ink: "#111", muted: "#4b5563", border: "#1a1a1a",
  font: "'Mitr','Kanit','Segoe UI',sans-serif",
  shadow: "4px 4px 0 #1a1a1a", shadowSm: "2px 2px 0 #1a1a1a", radius: 18,
};

const btnStyle = (variant: "white"|"dark"|"green"|"red"|"blue" = "white", disabled = false): React.CSSProperties => {
  const colors = { white: ["#fff","#111"], dark: ["#111","#fff"], green: ["#25C06D","#fff"], red: ["#FF4B4B","#fff"], blue: ["#3B82F6","#fff"] };
  const [bg, color] = colors[variant];
  return {
    borderRadius: 999, border: `2px solid ${UI.border}`, boxShadow: disabled ? "none" : UI.shadowSm,
    padding: "9px 14px", fontWeight: 900, cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "#eee" : bg, color: disabled ? "#9ca3af" : color,
    fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
    fontFamily: UI.font,
  };
};

const inputStyle: React.CSSProperties = {
  borderRadius: 12, border: `2px solid ${UI.border}`, padding: "9px 12px",
  fontSize: 13, outline: "none", background: "#fff", color: UI.ink, fontWeight: 700,
  fontFamily: UI.font, width: "100%", boxSizing: "border-box",
};

const card: React.CSSProperties = {
  background: "#fff", borderRadius: UI.radius, border: `2.5px solid ${UI.border}`,
  boxShadow: UI.shadow, overflow: "hidden",
};

// ── InfoCell: label + value ──
function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#9d174d", background: "#FFE4F0", border: "1.5px solid #fbcfe8", borderRadius: 999, padding: "1px 8px", display: "inline-block" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 900, color: UI.ink }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────── component ───────────────────────────────
export default function AdminPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<"bookings"|"concerts"|"phones">("bookings");

  // bookings
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bStatus, setBStatus] = useState<"pending"|"confirmed"|"rejected"|"all">("pending");
  const [bQ, setBQ] = useState("");
  const [summary, setSummary] = useState<Summary>({ total:0, pending:0, confirmed:0, rejected:0, revenue:0 });
  const [slipModal, setSlipModal] = useState<string|null>(null);

  // concerts
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [expandedConcert, setExpandedConcert] = useState<string|null>(null);
  const [concertForm, setConcertForm] = useState({ title:"", venue_name:"", description:"" });
  const [concertPoster, setConcertPoster] = useState<File|null>(null);
  const [sessionForm, setSessionForm] = useState({ start_at:"", note:"" });
  const [showArchived, setShowArchived] = useState(false);
  const [editConcert, setEditConcert] = useState<Concert|null>(null);
  const [editConcertForm, setEditConcertForm] = useState({ title:"", venue_name:"", description:"" });
  const [editConcertPoster, setEditConcertPoster] = useState<File|null>(null);
  const [editSession, setEditSession] = useState<Session|null>(null);
  const [editSessionForm, setEditSessionForm] = useState({ start_at:"", note:"" });
  const [editSessionConcertId, setEditSessionConcertId] = useState<string>("");

  // phones + inventory
  const [phones, setPhones] = useState<Phone[]>([]);
  const [phoneForm, setPhoneForm] = useState({ model_name:"", price:"", deposit:"", qty:"0" });
  const [phoneImage, setPhoneImage] = useState<File|null>(null);
  const [editPhone, setEditPhone] = useState<Phone|null>(null);
  const [editForm, setEditForm] = useState({ model_name:"", price:"", deposit:"", qty:"" });
  const [editImage, setEditImage] = useState<File|null>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{text:string; ok:boolean}|null>(null);
  const showMsg = (text: string, ok = true) => { setMsg({text,ok}); setTimeout(()=>setMsg(null),3000); };

  // ── auth ──
  const handleLogin = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/login", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({password}) });
    setLoading(false);
    if (!res.ok) { showMsg("รหัสไม่ถูกต้อง", false); return; }
    setIsAuthed(true); setPassword("");
    loadAll();
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method:"POST" });
    setIsAuthed(false); setBookings([]); setConcerts([]); setPhones([]);
  };

  const loadAll = () => { fetchBookings(); fetchSummary(); fetchConcerts(); fetchPhones(); };

  // ── bookings ──
  const fetchBookings = async () => {
    setLoading(true);
    const sp = new URLSearchParams({ status: bStatus });
    if (bQ.trim()) sp.set("q", bQ.trim());
    const res = await fetch(`/api/admin/bookings?${sp}`, { cache:"no-store" });
    if (!res.ok) { setLoading(false); return; }
    const out = await res.json();
    setBookings(out.bookings ?? []);
    setLoading(false);
  };

  const fetchSummary = async () => {
    const res = await fetch("/api/admin/bookings/summary", { cache:"no-store" });
    if (res.ok) setSummary(await res.json());
  };

  const setBookingStatus = async (id: string, status: "confirmed"|"rejected") => {
    const res = await fetch(`/api/admin/bookings/${id}/status`, {
      method:"PATCH", headers:{"content-type":"application/json"},
      body: JSON.stringify({status}), cache:"no-store",
    });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error || "ไม่สำเร็จ", false); return; }
    showMsg(status === "confirmed" ? "✅ ยืนยันแล้ว" : "❌ ปฏิเสธแล้ว");
    fetchBookings(); fetchSummary();
  };

  // ── concerts ──
  const fetchConcerts = async () => {
    const res = await fetch("/api/admin/concerts", { cache:"no-store" });
    if (res.ok) setConcerts((await res.json()).concerts ?? []);
  };

  const fetchSessions = async (concertId: string) => {
    const res = await fetch(`/api/admin/concerts/${concertId}/sessions`, { cache:"no-store" });
    if (res.ok) {
      const data = await res.json();
      setSessions(prev => ({ ...prev, [concertId]: data.sessions ?? [] }));
    }
  };

  const createConcert = async () => {
    if (!concertForm.title.trim()) { showMsg("กรุณากรอกชื่อคอนเสิร์ต", false); return; }
    const form = new FormData();
    form.append("title", concertForm.title.trim());
    form.append("venue_name", concertForm.venue_name.trim());
    form.append("description", concertForm.description.trim());
    if (concertPoster) form.append("poster", concertPoster);
    const res = await fetch("/api/admin/concerts", { method:"POST", body:form, cache:"no-store" });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error || "ไม่สำเร็จ", false); return; }
    showMsg("เพิ่มคอนเสิร์ตแล้ว");
    setConcertForm({ title:"", venue_name:"", description:"" }); setConcertPoster(null);
    fetchConcerts();
  };

  const archiveConcert = async (id: string, archive: boolean) => {
    const res = await fetch(`/api/admin/concerts/${id}`, { method: archive ? "DELETE" : "PATCH",
      body: archive ? undefined : (() => { const f = new FormData(); f.append("archived","false"); return f; })(),
      cache:"no-store" });
    if (!res.ok) { showMsg(archive ? "archive ไม่สำเร็จ" : "restore ไม่สำเร็จ", false); return; }
    showMsg(archive ? "📦 archive แล้ว" : "✅ restore แล้ว");
    fetchConcerts();
  };

  const createSession = async (concertId: string) => {
    if (!sessionForm.start_at) { showMsg("กรุณาเลือกวันเวลาเริ่ม", false); return; }
    const res = await fetch(`/api/admin/concerts/${concertId}/sessions`, {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ start_at: localToUTC(sessionForm.start_at), end_at: null, note: sessionForm.note||null }),
      cache:"no-store",
    });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"ไม่สำเร็จ", false); return; }
    showMsg("เพิ่มรอบแล้ว");
    setSessionForm({ start_at:"", note:"" });
    fetchSessions(concertId);
  };

  const saveEditConcert = async () => {
    if (!editConcert) return;
    const form = new FormData();
    form.append("title", editConcertForm.title.trim());
    form.append("venue_name", editConcertForm.venue_name.trim());
    form.append("description", editConcertForm.description.trim());
    if (editConcertPoster) form.append("poster", editConcertPoster);
    const res = await fetch(`/api/admin/concerts/${editConcert.id}`, { method:"PATCH", body:form, cache:"no-store" });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"แก้ไขไม่สำเร็จ", false); return; }
    showMsg("แก้ไขคอนเสิร์ตแล้ว");
    setEditConcert(null); setEditConcertPoster(null);
    fetchConcerts();
  };

  const saveEditSession = async () => {
    if (!editSession || !editSessionConcertId) return;
    if (!editSessionForm.start_at) { showMsg("กรุณาเลือกวันเวลาเริ่ม", false); return; }
    const res = await fetch(`/api/admin/concerts/${editSessionConcertId}/sessions/${editSession.id}`, {
      method:"PATCH", headers:{"content-type":"application/json"},
      body: JSON.stringify({ session_id: editSession.id, start_at: localToUTC(editSessionForm.start_at), note: editSessionForm.note||null }),
      cache:"no-store",
    });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"แก้ไขไม่สำเร็จ", false); return; }
    showMsg("แก้ไขรอบแล้ว");
    setEditSession(null);
    fetchSessions(editSessionConcertId);
  };

  const deleteSession = async (concertId: string, sessionId: string) => {
    if (!confirm("ลบรอบนี้?")) return;
    const res = await fetch(`/api/admin/concerts/${concertId}/sessions?session_id=${sessionId}`, { method:"DELETE", cache:"no-store" });
    if (!res.ok) { showMsg("ลบไม่สำเร็จ", false); return; }
    showMsg("ลบรอบแล้ว"); fetchSessions(concertId);
  };

  // ── phones ──
  const fetchPhones = async () => {
    const res = await fetch("/api/admin/phones", { cache:"no-store" });
    if (res.ok) setPhones((await res.json()).phones ?? []);
  };

  const createPhone = async () => {
    if (!phoneForm.model_name.trim()) { showMsg("กรุณากรอกชื่อรุ่น", false); return; }
    const form = new FormData();
    form.append("model_name", phoneForm.model_name.trim());
    form.append("price", phoneForm.price || "0");
    form.append("deposit", phoneForm.deposit || "0");
    form.append("qty", phoneForm.qty || "0");
    if (phoneImage) form.append("image", phoneImage);
    const res = await fetch("/api/admin/phones", { method:"POST", body:form, cache:"no-store" });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"ไม่สำเร็จ", false); return; }
    showMsg("เพิ่มมือถือแล้ว");
    setPhoneForm({ model_name:"", price:"", deposit:"", qty:"0" }); setPhoneImage(null);
    fetchPhones();
  };

  const openEditPhone = (p: Phone) => {
    setEditPhone(p);
    setEditForm({ model_name: p.model_name, price: String(p.price), deposit: String(p.deposit ?? ""), qty: String(p.qty ?? 0) });
    setEditImage(null);
  };

  const saveEditPhone = async () => {
    if (!editPhone) return;
    const form = new FormData();
    form.append("id", editPhone.id);
    if (editForm.model_name.trim()) form.append("model_name", editForm.model_name.trim());
    if (editForm.price) form.append("price", editForm.price);
    if (editForm.deposit) form.append("deposit", editForm.deposit);
    if (editForm.qty !== "") form.append("qty", editForm.qty);
    if (editImage) form.append("image", editImage);
    const res = await fetch("/api/admin/phones", { method:"PATCH", body:form, cache:"no-store" });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"แก้ไขไม่สำเร็จ", false); return; }
    showMsg("แก้ไขแล้ว");
    setEditPhone(null); setEditImage(null);
    fetchPhones();
  };

  const deletePhone = async (id: string) => {
    if (!confirm("ลบมือถือนี้?")) return;
    const res = await fetch(`/api/admin/phones?id=${id}`, { method:"DELETE", cache:"no-store" });
    if (!res.ok) { showMsg("ลบไม่สำเร็จ", false); return; }
    showMsg("ลบแล้ว"); fetchPhones();
  };

  // ── auto-check session ──
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/bookings?status=pending", { cache:"no-store" });
      if (res.ok) {
        setIsAuthed(true);
        const out = await res.json();
        setBookings(out.bookings ?? []);
        fetchBookings();
        fetchSummary();
        fetchConcerts();
        fetchPhones();
      }
    })();
  }, []);

  useEffect(() => { if (isAuthed) fetchBookings(); }, [bStatus]);

  // ─────────── login screen ───────────
  if (!isAuthed) return (
    <div style={{ minHeight:"100vh", background:UI.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:UI.font, color:UI.ink }}>
      <div style={{ ...card, width:"100%", maxWidth:400, padding:24 }}>
        <div style={{ fontWeight:900, fontSize:22, marginBottom:6 }}>🔐 Admin Login</div>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleLogin()}
          placeholder="ADMIN_PASSWORD" style={{ ...inputStyle, marginBottom:12 }} />
        <button onClick={handleLogin} disabled={loading||!password} style={btnStyle("dark", loading||!password)}>
          {loading ? "⏳..." : "เข้าใช้งาน"}
        </button>
      </div>
    </div>
  );

  // ─────────── main ───────────
  return (
    <div style={{ minHeight:"100vh", background:UI.bg, padding:"14px 16px", fontFamily:UI.font, color:UI.ink }}>
      <div style={{ maxWidth:1100, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:24, fontWeight:900, color:"#FF5CA8" }}>หน้าต่างแอดมิน</div>
            <div style={{ fontSize:12, color:UI.muted, fontWeight:800 }}>ระบบเช่ามือถือ</div>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button onClick={loadAll} style={btnStyle("white")}>🔄 รีเฟรช</button>
            <button onClick={handleLogout} style={btnStyle("dark")}>ออกจากระบบ</button>
          </div>
        </div>

        {/* Toast */}
        {msg && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", zIndex:9999,
            background: msg.ok ? "#F0FFF4" : "#FFF1F2",
            border:`2.5px solid ${msg.ok?"#6EE7B7":"#FDA4AF"}`,
            borderRadius:14, padding:"10px 18px", fontWeight:800, fontSize:13,
            color: msg.ok ? "#065f46" : "#9f1239", boxShadow:UI.shadow, whiteSpace:"nowrap" }}>
            {msg.text}
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:14 }}>
          {[
            { icon:"⏳", val:summary.pending,   label:"รอยืนยัน",    bg:"#FFF9E6" },
            { icon:"✅", val:summary.confirmed,  label:"ยืนยันแล้ว",  bg:"#EFFFF2" },
            { icon:"❌", val:summary.rejected,   label:"ปฏิเสธแล้ว", bg:"#FFF1F2" },
            { icon:"💰", val:money(summary.revenue), label:"รายได้รวม", bg:"#FFEFF7" },
          ].map(s => (
            <div key={s.label} style={{ flex:"1 1 160px", background:s.bg, borderRadius:14, border:`2px solid ${UI.border}`, boxShadow:UI.shadowSm, padding:"10px 14px" }}>
              <div style={{ fontSize:20 }}>{s.icon}</div>
              <div style={{ fontWeight:900, fontSize:20 }}>{s.val}</div>
              <div style={{ fontSize:11, fontWeight:800, color:UI.muted }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          {(["bookings","concerts","phones"] as const).map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{
              ...btnStyle("white"), background: tab===t ? "#FF85B3" : "#fff",
              boxShadow: tab===t ? UI.shadow : UI.shadowSm,
            }}>
              {t==="bookings"?"📋 จัดการการจอง": t==="concerts"?"🎫 คอนเสิร์ต & รอบ":"📱 มือถือ & Inventory"}
            </button>
          ))}
        </div>

        {/* ═══════════════ TAB: BOOKINGS ═══════════════ */}
        {tab === "bookings" && (
          <div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
              {(["pending","all","confirmed","rejected"] as const).map(s => (
                <button key={s} onClick={()=>setBStatus(s)} style={{
                  ...btnStyle("white"), background: bStatus===s ? "#FF85B3" : "#fff", fontSize:12,
                }}>
                  {s==="pending"?`⏳ รอยืนยัน (${summary.pending})`:s==="all"?`📋 ทั้งหมด (${summary.total})`:s==="confirmed"?`✅ ยืนยัน (${summary.confirmed})`:`❌ ปฏิเสธ (${summary.rejected})`}
                </button>
              ))}
              <div style={{ flex:1 }} />
              <input value={bQ} onChange={e=>setBQ(e.target.value)} placeholder="ค้นหา ref/ชื่อ..." style={{ ...inputStyle, maxWidth:200 }} />
              <button onClick={fetchBookings} style={btnStyle("white")}>🔎</button>
            </div>

            {loading && <div style={{ fontWeight:800, color:UI.muted }}>⏳ กำลังโหลด...</div>}
            {!loading && bookings.length===0 && <div style={{ ...card, padding:20, fontWeight:800, color:UI.muted }}>ไม่มีรายการ</div>}

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {bookings.map(b => {
                const meta = STATUS_META[b.status] ?? STATUS_META.pending;
                const pending = b.status === "pending";
                const concertTitle = b.concert_sessions?.concerts?.title ?? "-";
                const sessionTime = fmtDT(b.concert_sessions?.start_at);
                const venue = b.concert_sessions?.concerts?.venue_name ?? "-";
                const phoneModel = b.phones?.model_name ?? "-";
                const firstChar = (b.renter_name || "U").trim()[0]?.toUpperCase() ?? "U";

                return (
                  <div key={b.id} style={card}>
                    <div style={{ padding:14 }}>

                      {/* Header row */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:10 }}>
                        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                          <div style={{ width:36, height:36, borderRadius:"50%", background:"#FF85B3", border:`2px solid ${UI.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:16, flexShrink:0 }}>
                            {firstChar}
                          </div>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15 }}>{b.renter_name}</div>
                            <div style={{ fontSize:11, color:UI.muted, fontWeight:800 }}>REF: {b.ref_number ?? "-"}</div>
                          </div>
                        </div>
                        <div style={{ borderRadius:999, border:`2px solid ${meta.pillBorder}`, background:meta.pillBg, padding:"5px 12px", fontWeight:900, color:meta.text, fontSize:12 }}>
                          {meta.label}
                        </div>
                      </div>

                      <div style={{ height:1, background:"#f0f0f0", marginBottom:12 }} />

                      {/* Info grid with labels */}
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:"10px 16px" }}>
                        <InfoCell label="คอนเสิร์ต"        value={concertTitle} />
                        <InfoCell label="เวลาคอนเสิร์ต"    value={sessionTime} />
                        <InfoCell label="สถานที่"           value={venue} />
                        <InfoCell label="รุ่นมือถือ"        value={phoneModel} />
                        <InfoCell label="ยอดชำระ"          value={money(b.total_amount)} />
                        <InfoCell label="เบอร์โทร"         value={b.renter_phone ?? "-"} />
                        <InfoCell label="วันที่จอง"        value={fmtDT(b.created_at)} />
                      </div>

                      <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
                        <button onClick={()=>b.slip_url?setSlipModal(b.slip_url):showMsg("ไม่มีสลิป",false)} style={btnStyle("white")}>🧾 ดูสลิป</button>
                        <button disabled={!pending||loading} onClick={()=>setBookingStatus(b.id,"confirmed")} style={btnStyle("green",!pending||loading)}>✅ ยืนยัน</button>
                        <button disabled={!pending||loading} onClick={()=>setBookingStatus(b.id,"rejected")} style={btnStyle("red",!pending||loading)}>❌ ปฏิเสธ</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════════ TAB: CONCERTS ═══════════════ */}
        {tab === "concerts" && (
          <div>
            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ fontWeight:900, fontSize:15, marginBottom:12 }}>➕ เพิ่มคอนเสิร์ต</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <input placeholder="ชื่อคอนเสิร์ต *" value={concertForm.title} onChange={e=>setConcertForm(p=>({...p,title:e.target.value}))} style={inputStyle} />
                <input placeholder="สถานที่" value={concertForm.venue_name} onChange={e=>setConcertForm(p=>({...p,venue_name:e.target.value}))} style={inputStyle} />
              </div>
              <textarea placeholder="รายละเอียด" value={concertForm.description} onChange={e=>setConcertForm(p=>({...p,description:e.target.value}))}
                style={{ ...inputStyle, minHeight:60, resize:"vertical", marginBottom:10 }} />
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <label style={{ ...btnStyle("white"), cursor:"pointer" }}>
                  🖼 {concertPoster ? concertPoster.name : "เลือกโปสเตอร์"}
                  <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>setConcertPoster(e.target.files?.[0]||null)} />
                </label>
                <button onClick={createConcert} style={btnStyle("dark")}>บันทึก</button>
              </div>
            </div>

            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <button onClick={()=>setShowArchived(false)} style={{ ...btnStyle("white"), background: !showArchived?"#FF85B3":"#fff", fontSize:12 }}>🎫 คอนเสิร์ตปัจจุบัน</button>
              <button onClick={()=>setShowArchived(true)}  style={{ ...btnStyle("white"), background: showArchived?"#FF85B3":"#fff", fontSize:12 }}>📦 ที่ archive แล้ว</button>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {concerts.filter(c => (c.archived ?? false) === showArchived).map(c => (
                <div key={c.id} style={card}>
                  <div style={{ padding:14 }}>
                    <div style={{ display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
                      {c.poster_url && <img src={c.poster_url} alt="" style={{ width:60, height:60, objectFit:"cover", borderRadius:10, border:`2px solid ${UI.border}`, flexShrink:0 }} />}
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:900, fontSize:15 }}>{c.title}</div>
                        {c.venue_name && <div style={{ fontSize:12, color:UI.muted, fontWeight:700 }}>📍 {c.venue_name}</div>}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        {!(c.archived ?? false) && <>
                          <button onClick={()=>{ setEditConcert(c); setEditConcertForm({ title:c.title, venue_name:c.venue_name||"", description:c.description||"" }); setEditConcertPoster(null); }} style={btnStyle("white")}>✏️ แก้ไข</button>
                          <button onClick={()=>{ setExpandedConcert(expandedConcert===c.id?null:c.id); if(expandedConcert!==c.id) fetchSessions(c.id); }} style={btnStyle("white")}>
                            {expandedConcert===c.id?"▲ ซ่อนรอบ":"▼ จัดการรอบ"}
                          </button>
                        </>}
                        <button onClick={()=>archiveConcert(c.id, !(c.archived ?? false))} style={btnStyle((c.archived ?? false)?"green":"red")}>
                          {(c.archived ?? false) ? "♻️ Restore" : "📦 Archive"}
                        </button>
                      </div>
                    </div>

                    {expandedConcert===c.id && (
                      <div style={{ marginTop:12, background:"#FFFDF5", borderRadius:12, border:`2px dashed ${UI.border}`, padding:12 }}>
                        <div style={{ fontWeight:900, fontSize:13, marginBottom:10 }}>รอบการแสดง</div>

                        {(sessions[c.id]??[]).map(s => (
                          <div key={s.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px dashed #eee", fontSize:13, fontWeight:700 }}>
                            <span>⏰ {fmtDT(s.start_at)}{s.note?` — ${s.note}`:""}</span>
                            <div style={{ display:"flex", gap:6 }}>
                              <button onClick={()=>{ setEditSession(s); setEditSessionConcertId(c.id); setEditSessionForm({ start_at: s.start_at?.slice(0,16)||"", note: s.note||"" }); }} style={{ ...btnStyle("white"), padding:"4px 10px", fontSize:12 }}>✏️</button>
                              <button onClick={()=>deleteSession(c.id, s.id)} style={{ ...btnStyle("red"), padding:"4px 10px", fontSize:12 }}>🗑</button>
                            </div>
                          </div>
                        ))}
                        {(sessions[c.id]??[]).length===0 && <div style={{ fontSize:12, color:UI.muted, fontWeight:700, marginBottom:8 }}>ยังไม่มีรอบ</div>}

                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, marginTop:10, alignItems:"end" }}>
                          <div>
                            <div style={{ fontSize:11, fontWeight:800, marginBottom:4 }}>วันเวลาเริ่ม *</div>
                            <input type="datetime-local" value={sessionForm.start_at} onChange={e=>setSessionForm(p=>({...p,start_at:e.target.value}))} style={inputStyle} />
                          </div>
                          <div>
                            <div style={{ fontSize:11, fontWeight:800, marginBottom:4 }}>หมายเหตุ (เช่น รอบเช้า)</div>
                            <input placeholder="ไม่บังคับ" value={sessionForm.note} onChange={e=>setSessionForm(p=>({...p,note:e.target.value}))} style={inputStyle} />
                          </div>
                          <button onClick={()=>createSession(c.id)} style={btnStyle("green")}>+ เพิ่ม</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {concerts.filter(c => (c.archived ?? false) === showArchived).length === 0 && (
                <div style={{ ...card, padding:20, fontWeight:800, color:UI.muted }}>
                  {showArchived ? "ไม่มีคอนเสิร์ตที่ archive" : "ยังไม่มีคอนเสิร์ต"}
                </div>
              )}
            </div>

            {/* Edit Concert Modal */}
            {editConcert && (
              <div onClick={()=>setEditConcert(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:480, padding:20 }}>
                  <div style={{ fontWeight:900, fontSize:16, marginBottom:14 }}>✏️ แก้ไขคอนเสิร์ต</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
                    {[
                      { label:"ชื่อคอนเสิร์ต *", key:"title", val: editConcertForm.title },
                      { label:"สถานที่", key:"venue_name", val: editConcertForm.venue_name },
                    ].map(f => (
                      <div key={f.key}>
                        <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>{f.label}</div>
                        <input value={f.val} onChange={e=>setEditConcertForm(p=>({...p,[f.key]:e.target.value}))} style={inputStyle} />
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>รายละเอียด</div>
                      <textarea value={editConcertForm.description} onChange={e=>setEditConcertForm(p=>({...p,description:e.target.value}))}
                        style={{ ...inputStyle, minHeight:60, resize:"vertical" }} />
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>โปสเตอร์</div>
                      <label style={{ ...btnStyle("white"), cursor:"pointer", width:"100%", justifyContent:"center", boxSizing:"border-box" }}>
                        🖼 {editConcertPoster ? editConcertPoster.name : "เปลี่ยนโปสเตอร์ (ไม่บังคับ)"}
                        <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>setEditConcertPoster(e.target.files?.[0]||null)} />
                      </label>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={saveEditConcert} style={{ ...btnStyle("dark"), flex:1, justifyContent:"center" }}>💾 บันทึก</button>
                    <button onClick={()=>setEditConcert(null)} style={btnStyle("white")}>ยกเลิก</button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit Session Modal */}
            {editSession && (
              <div onClick={()=>setEditSession(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:400, padding:20 }}>
                  <div style={{ fontWeight:900, fontSize:16, marginBottom:14 }}>✏️ แก้ไขรอบ</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>วันเวลาเริ่ม *</div>
                      <input type="datetime-local" value={editSessionForm.start_at} onChange={e=>setEditSessionForm(p=>({...p,start_at:e.target.value}))} style={inputStyle} />
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>หมายเหตุ</div>
                      <input placeholder="เช่น รอบเช้า" value={editSessionForm.note} onChange={e=>setEditSessionForm(p=>({...p,note:e.target.value}))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={saveEditSession} style={{ ...btnStyle("dark"), flex:1, justifyContent:"center" }}>💾 บันทึก</button>
                    <button onClick={()=>setEditSession(null)} style={btnStyle("white")}>ยกเลิก</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TAB: PHONES ═══════════════ */}
        {tab === "phones" && (
          <div>
            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ fontWeight:900, fontSize:15, marginBottom:12 }}>➕ เพิ่มมือถือ</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginBottom:10 }}>
                <input placeholder="ชื่อรุ่น *" value={phoneForm.model_name} onChange={e=>setPhoneForm(p=>({...p,model_name:e.target.value}))} style={inputStyle} />
                <input placeholder="ราคาเช่า" type="number" value={phoneForm.price} onChange={e=>setPhoneForm(p=>({...p,price:e.target.value}))} style={inputStyle} />
                <input placeholder="มัดจำ" type="number" value={phoneForm.deposit} onChange={e=>setPhoneForm(p=>({...p,deposit:e.target.value}))} style={inputStyle} />
                <input placeholder="จำนวนเครื่อง" type="number" min={0} value={phoneForm.qty} onChange={e=>setPhoneForm(p=>({...p,qty:e.target.value}))} style={inputStyle} />
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <label style={{ ...btnStyle("white"), cursor:"pointer" }}>
                  📷 {phoneImage ? phoneImage.name : "เลือกรูปมือถือ"}
                  <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>setPhoneImage(e.target.files?.[0]||null)} />
                </label>
                <button onClick={createPhone} style={btnStyle("dark")}>บันทึก</button>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
              {phones.map(p => (
                <div key={p.id} style={{ ...card, padding:12 }}>
                  {p.image_url && <img src={p.image_url} alt={p.model_name} style={{ width:"100%", aspectRatio:"1/1", objectFit:"cover", borderRadius:10, border:`2px solid ${UI.border}`, marginBottom:8 }} />}
                  <div style={{ fontWeight:900, fontSize:14 }}>{p.model_name}</div>
                  <div style={{ fontSize:12, color:UI.muted, fontWeight:700 }}>เช่า {money(p.price)}{p.deposit ? ` · มัดจำ ${money(p.deposit)}` : ""}</div>
                  <div style={{ fontSize:12, fontWeight:900, color: (p.qty ?? 0) > 0 ? "#0B6B2C" : "#9F1239", marginTop:4, marginBottom:10 }}>
                    คงเหลือ {p.qty ?? 0} เครื่อง
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>openEditPhone(p)} style={{ ...btnStyle("white"), flex:1, justifyContent:"center" }}>✏️ แก้ไข</button>
                    <button onClick={()=>deletePhone(p.id)} style={btnStyle("red")}>🗑</button>
                  </div>
                </div>
              ))}
              {phones.length===0 && <div style={{ ...card, padding:20, fontWeight:800, color:UI.muted }}>ยังไม่มีมือถือ</div>}
            </div>

            {/* Edit Phone Modal */}
            {editPhone && (
              <div onClick={()=>setEditPhone(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:420, padding:20 }}>
                  <div style={{ fontWeight:900, fontSize:16, marginBottom:14 }}>✏️ แก้ไข {editPhone.model_name}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
                    {[
                      { label:"ชื่อรุ่น", type:"text",   val: editForm.model_name, key:"model_name" },
                      { label:"ราคาเช่า (฿)", type:"number", val: editForm.price,      key:"price" },
                      { label:"มัดจำ (฿)",    type:"number", val: editForm.deposit,    key:"deposit" },
                      { label:"จำนวนเครื่อง (stock รวม)", type:"number", val: editForm.qty, key:"qty" },
                    ].map(f => (
                      <div key={f.key}>
                        <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>{f.label}</div>
                        <input type={f.type} min={f.type==="number"?0:undefined} value={f.val}
                          onChange={e=>setEditForm(p=>({...p,[f.key]:e.target.value}))}
                          style={inputStyle} />
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color:UI.muted, marginBottom:4 }}>รูปมือถือ</div>
                      <label style={{ ...btnStyle("white"), cursor:"pointer", width:"100%", justifyContent:"center", boxSizing:"border-box" }}>
                        📷 {editImage ? editImage.name : "เปลี่ยนรูป (ไม่บังคับ)"}
                        <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>setEditImage(e.target.files?.[0]||null)} />
                      </label>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={saveEditPhone} style={{ ...btnStyle("dark"), flex:1, justifyContent:"center" }}>💾 บันทึก</button>
                    <button onClick={()=>setEditPhone(null)} style={btnStyle("white")}>ยกเลิก</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slip Modal */}
      {slipModal && (
        <div onClick={()=>setSlipModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, border:`3px solid ${UI.border}`, overflow:"hidden", maxWidth:520, width:"100%", boxShadow:UI.shadow }}>
            <div style={{ padding:"12px 16px", borderBottom:"2px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:900 }}>🧾 สลิปการโอน</span>
              <button onClick={()=>setSlipModal(null)} style={{ border:"none", background:"none", fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            <img src={slipModal} alt="slip" style={{ width:"100%", display:"block" }} />
            <div style={{ padding:"10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize:13, color:"#111", fontWeight:900 }}>เปิดในแท็บใหม่ ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}