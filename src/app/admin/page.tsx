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
  qty?: number;
  add_lens?: boolean;       // ← เพิ่ม
  lens_price?: number;      // ← เพิ่ม
  slip_verified?: boolean | null;
  slip_verify_message?: string | null;
  slip_verify_amount?: number | null;
  slip_verify_ref?: string | null;
  slip_verified_at?: string | null;
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
type Lens    = { id: string; name: string; focal_mm: number | null; price: number; qty: number; active: boolean };
type Announcement = { id: string; title: string | null; subtitle: string | null; emoji: string | null; image_url: string | null; active: boolean };
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
  pending:   { label: "⏳ รอยืนยัน",  pillBg: "#FFFBEF", pillBorder: "#F3E3B8", text: "#8A6D2F" },
  confirmed: { label: "✅ ยืนยันแล้ว", pillBg: "#F0FFF4", pillBorder: "#B7EFC5", text: "#0F9D4E" },
  rejected:  { label: "❌ ปฏิเสธ",     pillBg: "#FFF1F2", pillBorder: "#F9C7D1", text: "#C43D5C" },
};

// ─────────────────────────────── UI tokens ───────────────────────────────
const UI = {
  bg: "#FFFBF7", ink: "#332E2C", muted: "#A39A93", border: "#F0E9E2",
  accent: "#F2679E", accent2: "#7A57D1", accentSoft: "#FDF0F5",
  font: "var(--font-itim), 'Kanit', 'Segoe UI', sans-serif",
  shadow: "0 4px 16px rgba(51,46,44,0.06)", shadowSm: "0 1px 3px rgba(51,46,44,0.05)", radius: 16,
};

const btnStyle = (variant: "white"|"dark"|"green"|"red"|"blue" = "white", disabled = false): React.CSSProperties => {
  const colors: Record<string, [string, string]> = {
    white: ["#fff", UI.ink],
    dark: [`linear-gradient(135deg, ${UI.accent}, #E1477F)`, "#fff"],
    green: ["#06C755", "#fff"],
    red: ["#FFF1F2", "#C43D5C"],
    blue: [UI.accent2, "#fff"],
  };
  const [bg, color] = colors[variant];
  return {
    borderRadius: 999,
    border: variant === "white" ? `1px solid ${UI.border}` : "none",
    boxShadow: disabled ? "none" : variant === "white" ? "none" : "0 3px 10px rgba(51,46,44,0.12)",
    padding: "9px 14px", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "#F1F0EE" : bg, color: disabled ? "#B4B6BC" : color,
    fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
    fontFamily: UI.font,
  };
};

const inputStyle: React.CSSProperties = {
  borderRadius: 12, border: `1px solid ${UI.border}`, padding: "9px 12px",
  fontSize: 13, outline: "none", background: "#fff", color: UI.ink, fontWeight: 500,
  fontFamily: UI.font, width: "100%", boxSizing: "border-box",
};

const card: React.CSSProperties = {
  background: "#fff", borderRadius: UI.radius, border: `1px solid ${UI.border}`,
  boxShadow: UI.shadow, overflow: "hidden",
};

// ── InfoCell: label + value ──
function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: UI.accent, background: UI.accentSoft, borderRadius: 999, padding: "1px 8px", display: "inline-block" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────── component ───────────────────────────────
export default function AdminPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<"bookings"|"concerts"|"phones"|"lenses"|"announcement">("bookings");

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

  // lenses (stock แยกจากมือถือ) + การผูกเลนส์เข้ากับมือถือแต่ละรุ่น
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [lensForm, setLensForm] = useState({ name:"", focal_mm:"", price:"", qty:"0" });
  const [editLens, setEditLens] = useState<Lens|null>(null);
  const [editLensForm, setEditLensForm] = useState({ name:"", focal_mm:"", price:"", qty:"" });
  const [managingPhoneLenses, setManagingPhoneLenses] = useState<Phone|null>(null);
  const [phoneLensIds, setPhoneLensIds] = useState<string[]>([]);

  // ประกาศ/แบนเนอร์หน้าแรก
  const [announcement, setAnnouncement] = useState<Announcement|null>(null);
  const [annForm, setAnnForm] = useState({ title:"", subtitle:"", emoji:"🔥", active:true });
  const [annImage, setAnnImage] = useState<File|null>(null);
  const [annImagePreview, setAnnImagePreview] = useState<string|null>(null);
  const [annSaving, setAnnSaving] = useState(false);

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

  const loadAll = () => { fetchBookings(); fetchSummary(); fetchConcerts(); fetchPhones(); fetchLenses(); fetchAnnouncement(); };

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

  const [verifyingId, setVerifyingId] = useState<string|null>(null);
  const verifySlip = async (id: string) => {
    setVerifyingId(id);
    try {
      const res = await fetch("/api/admin/verify-slip", {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ booking_id: id }), cache:"no-store",
      });
      const out = await res.json().catch(()=>null);
      if (!res.ok) { showMsg(out?.error || "ตรวจสอบสลิปไม่สำเร็จ", false); return; }
      showMsg(out.verified ? "✅ SlipOK: สลิปถูกต้อง" : `⚠️ SlipOK: ${out.message || "ไม่ผ่าน"}`, out.verified);
      fetchBookings();
    } finally {
      setVerifyingId(null);
    }
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
    form.append("price",   phoneForm.price   || "0");
    form.append("deposit", phoneForm.deposit || "0");
    form.append("qty",     phoneForm.qty     || "0");
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
    setEditForm({
      model_name: p.model_name,
      price:      String(p.price),
      deposit:    String(p.deposit ?? ""),
      qty:        String(p.qty ?? 0),
    });
    setEditImage(null);
  };

  const saveEditPhone = async () => {
    if (!editPhone) return;
    const form = new FormData();
    form.append("id", editPhone.id);
    if (editForm.model_name.trim()) form.append("model_name", editForm.model_name.trim());
    if (editForm.price)   form.append("price",   editForm.price);
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

  // ── lenses (stock แยก) ──
  const fetchLenses = async () => {
    const res = await fetch("/api/admin/lenses", { cache:"no-store" });
    if (res.ok) setLenses((await res.json()).lenses ?? []);
  };

  const createLens = async () => {
    if (!lensForm.name.trim()) { showMsg("กรุณากรอกชื่อเลนส์", false); return; }
    const res = await fetch("/api/admin/lenses", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({
        name: lensForm.name.trim(),
        focal_mm: lensForm.focal_mm.trim() || null,
        price: Number(lensForm.price || 0),
        qty: Number(lensForm.qty || 0),
      }),
      cache:"no-store",
    });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"ไม่สำเร็จ", false); return; }
    showMsg("เพิ่มเลนส์แล้ว");
    setLensForm({ name:"", focal_mm:"", price:"", qty:"0" });
    fetchLenses();
  };

  const openEditLens = (l: Lens) => {
    setEditLens(l);
    setEditLensForm({
      name: l.name,
      focal_mm: l.focal_mm != null ? String(l.focal_mm) : "",
      price: String(l.price),
      qty: String(l.qty ?? 0),
    });
  };

  const saveEditLens = async () => {
    if (!editLens) return;
    const res = await fetch("/api/admin/lenses", {
      method:"PATCH", headers:{"content-type":"application/json"},
      body: JSON.stringify({
        id: editLens.id,
        name: editLensForm.name.trim(),
        focal_mm: editLensForm.focal_mm.trim() || null,
        price: Number(editLensForm.price || 0),
        qty: Number(editLensForm.qty || 0),
      }),
      cache:"no-store",
    });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error||"แก้ไขไม่สำเร็จ", false); return; }
    showMsg("แก้ไขแล้ว");
    setEditLens(null);
    fetchLenses();
  };

  const deleteLens = async (id: string) => {
    if (!confirm("ลบเลนส์นี้? (จะเลิกผูกกับมือถือทุกรุ่นด้วย)")) return;
    const res = await fetch(`/api/admin/lenses?id=${id}`, { method:"DELETE", cache:"no-store" });
    if (!res.ok) { showMsg("ลบไม่สำเร็จ", false); return; }
    showMsg("ลบแล้ว"); fetchLenses();
  };

  // ── ผูกเลนส์เข้ากับมือถือแต่ละรุ่น ──
  const openManagePhoneLenses = async (p: Phone) => {
    setManagingPhoneLenses(p);
    const res = await fetch(`/api/admin/phone-lenses?phone_id=${p.id}`, { cache:"no-store" });
    if (res.ok) {
      const out = await res.json();
      setPhoneLensIds((out.lenses ?? []).map((l: Lens) => l.id));
    } else {
      setPhoneLensIds([]);
    }
  };

  const togglePhoneLens = async (lensId: string, linked: boolean) => {
    if (!managingPhoneLenses) return;
    if (linked) {
      setPhoneLensIds((ids) => ids.filter((id) => id !== lensId));
      await fetch(`/api/admin/phone-lenses?phone_id=${managingPhoneLenses.id}&lens_id=${lensId}`, { method:"DELETE", cache:"no-store" });
    } else {
      setPhoneLensIds((ids) => [...ids, lensId]);
      await fetch("/api/admin/phone-lenses", {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ phone_id: managingPhoneLenses.id, lens_id: lensId }),
        cache:"no-store",
      });
    }
  };

  // ── ประกาศ/แบนเนอร์หน้าแรก ──
  const fetchAnnouncement = async () => {
    const res = await fetch("/api/admin/announcement", { cache:"no-store" });
    if (!res.ok) return;
    const out = await res.json();
    const a = out.announcement as Announcement | null;
    setAnnouncement(a);
    if (a) {
      setAnnForm({ title: a.title ?? "", subtitle: a.subtitle ?? "", emoji: a.emoji ?? "🔥", active: a.active });
    }
  };

  const saveAnnouncement = async () => {
    setAnnSaving(true);
    const form = new FormData();
    if (announcement?.id) form.append("id", announcement.id);
    form.append("title", annForm.title.trim());
    form.append("subtitle", annForm.subtitle.trim());
    form.append("emoji", annForm.emoji.trim());
    form.append("active", String(annForm.active));
    if (annImage) form.append("image", annImage);
    const res = await fetch("/api/admin/announcement", { method:"POST", body:form, cache:"no-store" });
    const out = await res.json().catch(()=>null);
    setAnnSaving(false);
    if (!res.ok) { showMsg(out?.error||"บันทึกไม่สำเร็จ", false); return; }
    showMsg("บันทึกประกาศแล้ว");
    setAnnImage(null); setAnnImagePreview(null);
    setAnnouncement(out.announcement);
  };

  const removeAnnouncementImage = async () => {
    if (!announcement?.id) return;
    setAnnSaving(true);
    const form = new FormData();
    form.append("id", announcement.id);
    form.append("title", annForm.title.trim());
    form.append("subtitle", annForm.subtitle.trim());
    form.append("emoji", annForm.emoji.trim());
    form.append("active", String(annForm.active));
    form.append("remove_image", "true");
    const res = await fetch("/api/admin/announcement", { method:"POST", body:form, cache:"no-store" });
    const out = await res.json().catch(()=>null);
    setAnnSaving(false);
    if (!res.ok) { showMsg(out?.error||"ลบรูปไม่สำเร็จ", false); return; }
    showMsg("ลบรูป banner แล้ว");
    setAnnouncement(out.announcement);
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
        <div style={{ fontWeight:700, fontSize:22, marginBottom:6 }}>🔐 Admin Login</div>
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
            <div style={{ fontSize:24, fontWeight:700, color:UI.accent }}>หน้าต่างแอดมิน</div>
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
            border:`1px solid ${msg.ok?"#B7EFC5":"#F9C7D1"}`,
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
            <div key={s.label} style={{ flex:"1 1 160px", background:s.bg, borderRadius:14, border:`1px solid ${UI.border}`, boxShadow:UI.shadowSm, padding:"10px 14px" }}>
              <div style={{ fontSize:20 }}>{s.icon}</div>
              <div style={{ fontWeight:700, fontSize:20 }}>{s.val}</div>
              <div style={{ fontSize:11, fontWeight:800, color:UI.muted }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          {(["bookings","concerts","phones","lenses","announcement"] as const).map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{
              ...btnStyle("white"), background: tab===t ? UI.accent : "#fff",
              boxShadow: tab===t ? UI.shadow : UI.shadowSm,
            }}>
              {t==="bookings"?"📋 จัดการการจอง": t==="concerts"?"🎫 คอนเสิร์ต & รอบ": t==="phones"?"📱 มือถือ & Inventory": t==="lenses"?"🔭 เลนส์":"📣 ประกาศ"}
            </button>
          ))}
        </div>

        {/* ═══════════════ TAB: BOOKINGS ═══════════════ */}
        {tab === "bookings" && (
          <div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
              {(["pending","all","confirmed","rejected"] as const).map(s => (
                <button key={s} onClick={()=>setBStatus(s)} style={{
                  ...btnStyle("white"), background: bStatus===s ? UI.accent : "#fff", fontSize:12,
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
                const sessionTime  = fmtDT(b.concert_sessions?.start_at);
                const venue        = b.concert_sessions?.concerts?.venue_name ?? "-";
                const phoneModel   = b.phones?.model_name ?? "-";
                const firstChar    = (b.renter_name || "U").trim()[0]?.toUpperCase() ?? "U";

                return (
                  <div key={b.id} style={card}>
                    <div style={{ padding:14 }}>

                      {/* Header row */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:10 }}>
                        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                          <div style={{ width:36, height:36, borderRadius:"50%", background:UI.accent, border:`1px solid ${UI.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:16, flexShrink:0 }}>
                            {firstChar}
                          </div>
                          <div>
                            <div style={{ fontWeight:700, fontSize:15 }}>{b.renter_name}</div>
                            <div style={{ fontSize:11, color:UI.muted, fontWeight:800 }}>REF: {b.ref_number ?? "-"}</div>
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                          {/* ── Lens badge ── */}
                          {b.add_lens && (
                            <div style={{ borderRadius:999, border:"1.5px solid #a78bfa", background:"#f5f3ff", padding:"4px 10px", fontWeight:700, color:"#6d28d9", fontSize:11 }}>
                              🔭 Lens +{money(b.lens_price)}
                            </div>
                          )}
                          <div style={{ borderRadius:999, border:`1px solid ${meta.pillBorder}`, background:meta.pillBg, padding:"5px 12px", fontWeight:700, color:meta.text, fontSize:12 }}>
                            {meta.label}
                          </div>
                        </div>
                      </div>

                      <div style={{ height:1, background:"#f0f0f0", marginBottom:12 }} />

                      {/* Info grid with labels */}
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:"10px 16px" }}>
                        <InfoCell label="คอนเสิร์ต"      value={concertTitle} />
                        <InfoCell label="เวลาคอนเสิร์ต"  value={sessionTime} />
                        <InfoCell label="สถานที่"         value={venue} />
                        <InfoCell label="รุ่นมือถือ"      value={phoneModel} />
                        <InfoCell label="ยอดชำระ"        value={money(b.total_amount)} />
                        <InfoCell label="เบอร์โทร"       value={b.renter_phone ?? "-"} />
                        <InfoCell label="วันที่จอง"      value={fmtDT(b.created_at)} />
                      </div>

                      {/* SlipOK verification result */}
                      {b.slip_verified != null && (
                        <div style={{
                          marginTop:12,
                          borderRadius:12,
                          border: `1px solid ${b.slip_verified ? "#B7EFC5" : "#F9C7D1"}`,
                          background: b.slip_verified ? "#F0FFF4" : "#FFF1F2",
                          padding:"8px 12px",
                          fontSize:12,
                          fontWeight:700,
                          color: b.slip_verified ? "#0F9D4E" : "#C43D5C",
                        }}>
                          {b.slip_verified ? "✅ SlipOK: ตรวจสอบผ่าน" : `⚠️ SlipOK: ${b.slip_verify_message || "ไม่ผ่าน"}`}
                          {b.slip_verify_amount != null && (
                            <span style={{ fontWeight:500, marginLeft:6 }}>(ยอดที่อ่านได้ ฿{b.slip_verify_amount})</span>
                          )}
                        </div>
                      )}

                      <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
                        <button onClick={()=>b.slip_url?setSlipModal(b.slip_url):showMsg("ไม่มีสลิป",false)} style={btnStyle("white")}>🧾 ดูสลิป</button>
                        <button
                          disabled={!b.slip_url || verifyingId===b.id}
                          onClick={()=>verifySlip(b.id)}
                          style={btnStyle("blue", !b.slip_url || verifyingId===b.id)}
                        >
                          {verifyingId===b.id ? "⏳ กำลังตรวจสอบ..." : b.slip_verified != null ? "🔄 ตรวจสอบสลิปอีกครั้ง" : "🔍 ตรวจสอบสลิปด้วย SlipOK"}
                        </button>
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
              <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>➕ เพิ่มคอนเสิร์ต</div>
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
              <button onClick={()=>setShowArchived(false)} style={{ ...btnStyle("white"), background: !showArchived?UI.accent:"#fff", fontSize:12 }}>🎫 คอนเสิร์ตปัจจุบัน</button>
              <button onClick={()=>setShowArchived(true)}  style={{ ...btnStyle("white"), background: showArchived?UI.accent:"#fff", fontSize:12 }}>📦 ที่ archive แล้ว</button>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {concerts.filter(c => (c.archived ?? false) === showArchived).map(c => (
                <div key={c.id} style={card}>
                  <div style={{ padding:14 }}>
                    <div style={{ display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
                      {c.poster_url && <img src={c.poster_url} alt="" style={{ width:60, height:60, objectFit:"cover", borderRadius:10, border:`1px solid ${UI.border}`, flexShrink:0 }} />}
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:15 }}>{c.title}</div>
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
                      <div style={{ marginTop:12, background:"#fff", borderRadius:12, border:`1.5px dashed #D8D5CE`, padding:12 }}>
                        <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>รอบการแสดง</div>

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
              <div onClick={()=>setEditConcert(null)} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:480, padding:20 }}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>✏️ แก้ไขคอนเสิร์ต</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
                    {[
                      { label:"ชื่อคอนเสิร์ต *", key:"title",      val: editConcertForm.title },
                      { label:"สถานที่",           key:"venue_name", val: editConcertForm.venue_name },
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
              <div onClick={()=>setEditSession(null)} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:400, padding:20 }}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>✏️ แก้ไขรอบ</div>
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
            {/* ── Add Phone Form ── */}
            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>➕ เพิ่มมือถือ</div>
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
                  {p.image_url && <img src={p.image_url} alt={p.model_name} style={{ width:"100%", aspectRatio:"1/1", objectFit:"cover", borderRadius:10, border:`1px solid ${UI.border}`, marginBottom:8 }} />}
                  <div style={{ fontWeight:700, fontSize:14 }}>{p.model_name}</div>
                  <div style={{ fontSize:12, color:UI.muted, fontWeight:700 }}>เช่า {money(p.price)}{p.deposit ? ` · มัดจำ ${money(p.deposit)}` : ""}</div>
                  <div style={{ fontSize:12, fontWeight:700, color: (p.qty ?? 0) > 0 ? "#0F9D4E" : "#C43D5C", marginTop:4, marginBottom:10 }}>
                    คงเหลือ {p.qty ?? 0} เครื่อง
                  </div>
                  <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                    <button onClick={()=>openEditPhone(p)} style={{ ...btnStyle("white"), flex:1, justifyContent:"center" }}>✏️ แก้ไข</button>
                    <button onClick={()=>deletePhone(p.id)} style={btnStyle("red")}>🗑</button>
                  </div>
                  <button onClick={()=>openManagePhoneLenses(p)} style={{ ...btnStyle("blue"), width:"100%", justifyContent:"center" }}>
                    🔭 จัดการเลนส์ที่ใช้ได้
                  </button>
                </div>
              ))}
              {phones.length===0 && <div style={{ ...card, padding:20, fontWeight:800, color:UI.muted }}>ยังไม่มีมือถือ</div>}
            </div>

            {/* Edit Phone Modal */}
            {editPhone && (
              <div onClick={()=>setEditPhone(null)} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:420, padding:20 }}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>✏️ แก้ไข {editPhone.model_name}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
                    {[
                      { label:"ชื่อรุ่น",                       type:"text",   val: editForm.model_name,       key:"model_name" },
                      { label:"ราคาเช่า (฿)",                   type:"number", val: editForm.price,            key:"price" },
                      { label:"มัดจำ (฿)",                      type:"number", val: editForm.deposit,          key:"deposit" },
                      { label:"จำนวนเครื่อง (stock รวม)",       type:"number", val: editForm.qty,             key:"qty" },
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

            {/* Manage Phone Lenses Modal */}
            {managingPhoneLenses && (
              <div onClick={()=>setManagingPhoneLenses(null)} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:420, padding:20 }}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>🔭 เลนส์ที่ใช้ได้กับ {managingPhoneLenses.model_name}</div>
                  <div style={{ fontSize:12, color:UI.muted, fontWeight:600, marginBottom:14 }}>
                    ติ๊กเลนส์ที่ลูกค้าเลือกซื้อเพิ่มกับมือถือรุ่นนี้ได้ (ไม่ติ๊ก = เลือกเลนส์ไม่ได้เลย)
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16, maxHeight:320, overflowY:"auto" }}>
                    {lenses.map(l => {
                      const linked = phoneLensIds.includes(l.id);
                      return (
                        <label key={l.id} style={{
                          display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
                          padding:"10px 12px", borderRadius:12, border:`1px solid ${linked ? UI.accent2 : UI.border}`,
                          background: linked ? "#F1EDFC" : "#fff", cursor:"pointer",
                        }}>
                          <div>
                            <div style={{ fontWeight:700, fontSize:13 }}>{l.name}</div>
                            <div style={{ fontSize:11, color:UI.muted, fontWeight:600 }}>
                              ราคา {money(l.price)} · คงเหลือ {l.qty} ชิ้น
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={linked}
                            onChange={()=>togglePhoneLens(l.id, linked)}
                            style={{ width:18, height:18, flexShrink:0 }}
                          />
                        </label>
                      );
                    })}
                    {lenses.length === 0 && (
                      <div style={{ fontSize:13, fontWeight:600, color:UI.muted }}>
                        ยังไม่มีเลนส์ในระบบ — ไปเพิ่มที่แท็บ &quot;🔭 เลนส์&quot; ก่อน
                      </div>
                    )}
                  </div>
                  <button onClick={()=>setManagingPhoneLenses(null)} style={{ ...btnStyle("dark"), width:"100%", justifyContent:"center" }}>เสร็จแล้ว</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TAB: LENSES ═══════════════ */}
        {tab === "lenses" && (
          <div>
            {/* ── Add Lens Form ── */}
            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>➕ เพิ่มเลนส์</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginBottom:10 }}>
                <input placeholder="ชื่อเลนส์ * เช่น เลนส์ซูม 200mm" value={lensForm.name} onChange={e=>setLensForm(p=>({...p,name:e.target.value}))} style={inputStyle} />
                <input placeholder="ระยะ mm (ไม่บังคับ)" type="number" value={lensForm.focal_mm} onChange={e=>setLensForm(p=>({...p,focal_mm:e.target.value}))} style={inputStyle} />
                <input placeholder="ราคาเช่าเพิ่ม" type="number" value={lensForm.price} onChange={e=>setLensForm(p=>({...p,price:e.target.value}))} style={inputStyle} />
                <input placeholder="จำนวน stock" type="number" min={0} value={lensForm.qty} onChange={e=>setLensForm(p=>({...p,qty:e.target.value}))} style={inputStyle} />
              </div>
              <button onClick={createLens} style={btnStyle("dark")}>บันทึก</button>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
              {lenses.map(l => (
                <div key={l.id} style={{ ...card, padding:14 }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>{l.name}</div>
                  {l.focal_mm != null && <div style={{ fontSize:12, color:UI.muted, fontWeight:700 }}>ระยะ {l.focal_mm}mm</div>}
                  <div style={{ fontSize:12, fontWeight:700, color:UI.accent2, marginTop:2 }}>+{money(l.price)}</div>
                  <div style={{ fontSize:12, fontWeight:700, color: (l.qty ?? 0) > 0 ? "#0F9D4E" : "#C43D5C", marginTop:4, marginBottom:10 }}>
                    คงเหลือ {l.qty ?? 0} ชิ้น
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>openEditLens(l)} style={{ ...btnStyle("white"), flex:1, justifyContent:"center" }}>✏️ แก้ไข</button>
                    <button onClick={()=>deleteLens(l.id)} style={btnStyle("red")}>🗑</button>
                  </div>
                </div>
              ))}
              {lenses.length===0 && <div style={{ ...card, padding:20, fontWeight:700, color:UI.muted }}>ยังไม่มีเลนส์</div>}
            </div>

            {/* Edit Lens Modal */}
            {editLens && (
              <div onClick={()=>setEditLens(null)} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:400, padding:20 }}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>✏️ แก้ไข {editLens.name}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
                    {[
                      { label:"ชื่อเลนส์",        type:"text",   val: editLensForm.name,     key:"name" },
                      { label:"ระยะ mm",           type:"number", val: editLensForm.focal_mm, key:"focal_mm" },
                      { label:"ราคาเช่าเพิ่ม (฿)", type:"number", val: editLensForm.price,    key:"price" },
                      { label:"จำนวน stock",       type:"number", val: editLensForm.qty,      key:"qty" },
                    ].map(f => (
                      <div key={f.key}>
                        <div style={{ fontSize:11, fontWeight:700, color:UI.muted, marginBottom:4 }}>{f.label}</div>
                        <input type={f.type} min={f.type==="number"?0:undefined} value={f.val}
                          onChange={e=>setEditLensForm(p=>({...p,[f.key]:e.target.value}))}
                          style={inputStyle} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={saveEditLens} style={{ ...btnStyle("dark"), flex:1, justifyContent:"center" }}>💾 บันทึก</button>
                    <button onClick={()=>setEditLens(null)} style={btnStyle("white")}>ยกเลิก</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TAB: ANNOUNCEMENT ═══════════════ */}
        {tab === "announcement" && (
          <div>
            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div style={{ fontWeight:700, fontSize:15 }}>📣 ประกาศ/แบนเนอร์หน้าแรก</div>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>
                  <input type="checkbox" checked={annForm.active} onChange={e=>setAnnForm(p=>({...p,active:e.target.checked}))} style={{ width:18, height:18 }} />
                  เปิดใช้งาน
                </label>
              </div>

              {announcement?.image_url && !annImagePreview && (
                <div style={{ marginBottom:14 }}>
                  <img src={announcement.image_url} alt="banner" style={{ width:"100%", borderRadius:12, border:`1px solid ${UI.border}`, display:"block", marginBottom:8 }} />
                  <button onClick={removeAnnouncementImage} disabled={annSaving} style={btnStyle("red", annSaving)}>🗑 ลบรูป banner (กลับไปใช้ข้อความ)</button>
                </div>
              )}

              {annImagePreview && (
                <img src={annImagePreview} alt="preview" style={{ width:"100%", borderRadius:12, border:`1px solid ${UI.border}`, display:"block", marginBottom:14 }} />
              )}

              <div style={{ fontSize:12, fontWeight:700, color:UI.muted, marginBottom:10 }}>
                อัปโหลดรูป banner จะแสดงแทนข้อความด้านล่างทั้งหมด (ถ้าไม่อยากใช้รูป ไม่ต้องอัปโหลด)
              </div>
              <label style={{ ...btnStyle("white"), cursor:"pointer", marginBottom:16, display:"inline-flex" }}>
                📷 {annImage ? annImage.name : "เลือกรูป banner"}
                <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{
                  const f = e.target.files?.[0] || null;
                  setAnnImage(f);
                  setAnnImagePreview(f ? URL.createObjectURL(f) : null);
                }} />
              </label>

              <div style={{ height:1, background:UI.border, margin:"4px 0 16px" }} />

              <div style={{ fontSize:12, fontWeight:700, color:UI.muted, marginBottom:10 }}>
                หรือใช้ข้อความ (จะไม่แสดงถ้ามีการอัปโหลดรูป banner ไว้)
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
                <input placeholder="อิโมจิ เช่น 🔥" value={annForm.emoji} onChange={e=>setAnnForm(p=>({...p,emoji:e.target.value}))} style={inputStyle} />
                <input placeholder="หัวข้อประกาศ" value={annForm.title} onChange={e=>setAnnForm(p=>({...p,title:e.target.value}))} style={{ ...inputStyle, gridColumn:"span 2" }} />
                <input placeholder="ข้อความรอง" value={annForm.subtitle} onChange={e=>setAnnForm(p=>({...p,subtitle:e.target.value}))} style={{ ...inputStyle, gridColumn:"span 3" }} />
              </div>

              <button onClick={saveAnnouncement} disabled={annSaving} style={btnStyle("dark", annSaving)}>
                {annSaving ? "⏳ กำลังบันทึก..." : "💾 บันทึกประกาศ"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slip Modal */}
      {slipModal && (
        <div onClick={()=>setSlipModal(null)} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, border:`1px solid ${UI.border}`, overflow:"hidden", maxWidth:520, width:"100%", boxShadow:UI.shadow }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${UI.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:700 }}>🧾 สลิปการโอน</span>
              <button onClick={()=>setSlipModal(null)} style={{ border:"none", background:"none", fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            <img src={slipModal} alt="slip" style={{ width:"100%", display:"block" }} />
            <div style={{ padding:"10px 16px" }}>
              <a href={slipModal} target="_blank" rel="noreferrer" style={{ fontSize:13, color:UI.accent2, fontWeight:700 }}>เปิดในแท็บใหม่ ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}