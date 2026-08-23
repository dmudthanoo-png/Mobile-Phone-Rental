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
  line_message_status?: "sent" | "failed" | "quota_exceeded" | null;
  line_message_error?: string | null;
  line_message_attempted_at?: string | null;
  line_message_sent_at?: string | null;
  line_message_attempt_count?: number | null;
  line_message_http_status?: number | null;
  line_message_error_detail?: string | null;
  line_message_request_id?: string | null;
  user_id?: string | null;
  line_sub?: string | null;
  is_banned?: boolean;
  concert_sessions?: {
    start_at: string | null;
    note: string | null;
    concerts?: { title: string; venue_name: string | null } | null;
  } | null;
  phones?: { model_name: string } | null;
};

type Concert = { id: string; title: string; venue_name: string | null; poster_url: string | null; description: string | null; archived: boolean | null };
type Session = { id: string; start_at: string | null; end_at: string | null; note: string | null };
type PhoneQuotaInfo = {
  phone_id: string;
  model_name: string;
  total_qty: number;
  allocated_elsewhere: number;
  available_to_allocate: number;
  current_quota: number | null;
  already_booked: number;
};
type Phone   = { id: string; model_name: string; price: number; deposit: number; qty: number; image_url: string | null; active: boolean };
type Lens    = { id: string; name: string; focal_mm: number | null; price: number; qty: number; active: boolean };
type Announcement = { id: string; title: string | null; subtitle: string | null; emoji: string | null; image_url: string | null; active: boolean };
type Review = { id: string; booking_id: string; concert_title: string | null; display_name: string; rating: number; comment: string; is_published: boolean; created_at: string };
type AdminAccount = { id: string; username: string; created_at: string };
type AuditLogEntry = { id: string; admin_username: string; action: string; detail: string | null; created_at: string };
type AdminUser = {
  id: string;
  line_sub: string | null;
  name: string | null;
  picture: string | null;
  is_banned: boolean;
  banned_at: string | null;
  ban_reason: string | null;
  booking_count: number;
  total_spent: number;
};
type Summary = { total: number; pending: number; confirmed: number; rejected: number; revenue: number };
type LineQuota = {
  status: "loading" | "connected" | "not_configured" | "error";
  quotaType?: "limited" | "none";
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  refreshedAt?: string;
  loading?: boolean;
};

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

const LINE_MESSAGE_META = {
  sent: { label: "ส่งสำเร็จ", bg: "#F0FFF4", border: "#B7EFC5", color: "#0F9D4E" },
  failed: { label: "ส่งไม่สำเร็จ", bg: "#FFF1F2", border: "#F9C7D1", color: "#C43D5C" },
  quota_exceeded: { label: "โควต้าหมด", bg: "#FFF7E6", border: "#F5D5A7", color: "#B56600" },
  unknown: { label: "ยังไม่มีข้อมูลการส่ง", bg: "#F7F7F6", border: "#E5E1DD", color: "#776F68" },
};

function getLineMessageMeta(status: Booking["line_message_status"]) {
  if (status === "sent") return LINE_MESSAGE_META.sent;
  if (status === "failed") return LINE_MESSAGE_META.failed;
  if (status === "quota_exceeded") return LINE_MESSAGE_META.quota_exceeded;
  return LINE_MESSAGE_META.unknown;
}

function lineMessageFailureText(reason: string | null | undefined) {
  switch (reason) {
    case "not_configured": return "ยังไม่ได้ตั้งค่า Token";
    case "missing_recipient": return "ไม่พบ LINE ของผู้จอง";
    case "invalid_recipient": return "LINE ID ไม่ถูกต้อง";
    case "recipient_unavailable": return "LINE ของผู้จองใช้กับ OA นี้ไม่ได้";
    case "timed_out": return "LINE ตอบกลับช้าเกินกำหนด";
    case "quota_exceeded": return "โควต้ารายเดือนเต็ม";
    case "delivery_failed": return "LINE ปฏิเสธการส่ง";
    default: return null;
  }
}

function lineMessageDiagnostic(booking: Booking) {
  const parts: string[] = [];
  const reason = lineMessageFailureText(booking.line_message_error);
  if (reason) parts.push(reason);

  if (Number.isInteger(booking.line_message_http_status)) {
    parts.push(`HTTP ${booking.line_message_http_status}`);
  }

  const detail = booking.line_message_error_detail?.replace(/\s+/g, " ").trim();
  if (detail) parts.push(detail.slice(0, 180));

  const requestId = booking.line_message_request_id?.trim();
  if (requestId) parts.push(`Request ID: ${requestId.slice(0, 100)}`);

  return parts.join(" · ");
}

function lineNotificationDiagnostic(notification: {
  httpStatus?: unknown;
  errorDetail?: unknown;
}) {
  const parts: string[] = [];
  if (typeof notification.httpStatus === "number") {
    parts.push(`HTTP ${notification.httpStatus}`);
  }
  if (typeof notification.errorDetail === "string") {
    const detail = notification.errorDetail.replace(/\s+/g, " ").trim();
    if (detail) parts.push(detail.slice(0, 120));
  }
  return parts.join(" · ");
}

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

const TAB_ITEMS = [
  { key: "bookings" as const, icon: "📋", label: "จัดการการจอง" },
  { key: "users" as const, icon: "👤", label: "ผู้ใช้" },
  { key: "concerts" as const, icon: "🎫", label: "คอนเสิร์ต & รอบ" },
  { key: "phones" as const, icon: "📱", label: "มือถือ & Inventory" },
  { key: "lenses" as const, icon: "🔭", label: "เลนส์" },
  { key: "reviews" as const, icon: "⭐", label: "รีวิว" },
  { key: "announcement" as const, icon: "📣", label: "ประกาศ" },
  { key: "admins" as const, icon: "🛡️", label: "จัดการแอดมิน" },
  { key: "auditlog" as const, icon: "📜", label: "ประวัติการดำเนินการ" },
];

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
  const [loginUsername, setLoginUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [bootstrapPassword2, setBootstrapPassword2] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [currentAdminUsername, setCurrentAdminUsername] = useState("");
  const [pendingTotpToken, setPendingTotpToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [currentTotpEnabled, setCurrentTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr_data_url: string } | null>(null);
  const [totpSetupCode, setTotpSetupCode] = useState("");
  const [totpDisableCode, setTotpDisableCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpShowDisableForm, setTotpShowDisableForm] = useState(false);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [deletingAdminId, setDeletingAdminId] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState("");
  const [tab, setTab] = useState<"bookings"|"users"|"concerts"|"phones"|"lenses"|"reviews"|"announcement"|"admins"|"auditlog">("bookings");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // bookings
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bStatus, setBStatus] = useState<"pending"|"confirmed"|"rejected"|"all">("pending");
  const [bQ, setBQ] = useState("");
  const [summary, setSummary] = useState<Summary>({ total:0, pending:0, confirmed:0, rejected:0, revenue:0 });
  const [slipModal, setSlipModal] = useState<string|null>(null);
  const [viewingSlipId, setViewingSlipId] = useState<string|null>(null);
  const [lineQuota, setLineQuota] = useState<LineQuota>({ status:"loading", loading:true });

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

  const [quotaSession, setQuotaSession] = useState<Session|null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [quotaData, setQuotaData] = useState<PhoneQuotaInfo[]>([]);
  const [quotaInputs, setQuotaInputs] = useState<Record<string, string>>({});

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
  const [reviews, setReviews] = useState<Review[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [uQ, setUQ] = useState("");
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
    setLoginError(null);
    const res = await fetch("/api/admin/login", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ username: loginUsername.trim(), password }),
    });
    const out = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) { setLoginError(out?.error || "เข้าสู่ระบบไม่สำเร็จ"); return; }

    if (out?.needs2fa) {
      setPendingTotpToken(out.pending_token);
      setLoginError(null);
      return;
    }

    setIsAuthed(true); setPassword(""); setLoginError(null);
    setCurrentAdminUsername(out?.username ?? loginUsername.trim().toLowerCase());
    loadAll();
    fetchMe();
  };

  const handleVerify2fa = async () => {
    setLoading(true);
    setLoginError(null);
    const res = await fetch("/api/admin/login/verify-2fa", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ pending_token: pendingTotpToken, code: totpCode.trim() }),
    });
    const out = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) { setLoginError(out?.error || "ยืนยันไม่สำเร็จ"); return; }
    setIsAuthed(true); setPassword(""); setLoginError(null);
    setPendingTotpToken(null); setTotpCode("");
    setCurrentAdminUsername(out?.username ?? "");
    loadAll();
    fetchMe();
  };

  const cancelVerify2fa = () => {
    setPendingTotpToken(null); setTotpCode(""); setLoginError(null); setPassword("");
  };

  const handleBootstrap = async () => {
    setLoginError(null);
    if (password !== bootstrapPassword2) { setLoginError("ยืนยันรหัสผ่านไม่ตรงกัน"); return; }
    setLoading(true);
    const res = await fetch("/api/admin/admins", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ username: loginUsername.trim(), password, bootstrap_secret: bootstrapSecret.trim() }),
    });
    const out = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) { setLoginError(out?.error || "สร้างบัญชีไม่สำเร็จ"); return; }
    setNeedsBootstrap(false);
    showMsg("✅ สร้างบัญชีแอดมินคนแรกแล้ว กรุณาเข้าสู่ระบบ");
    setPassword(""); setBootstrapPassword2(""); setBootstrapSecret("");
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method:"POST" });
    setIsAuthed(false); setBookings([]); setConcerts([]); setPhones([]);
    setCurrentAdminUsername(""); setCurrentTotpEnabled(false);
    setLineQuota({ status:"loading", loading:true });
    // เพิ่งออกจากระบบสำเร็จ = ต้องมีบัญชีแอดมินอยู่แล้วแน่ๆ ไม่ต้องเช็ค bootstrap ซ้ำ
    setNeedsBootstrap(false);
  };

  const fetchMe = async () => {
    const res = await fetch("/api/admin/me", { cache:"no-store" });
    if (res.ok) {
      const me = await res.json();
      setCurrentAdminUsername(me.username ?? "");
      setCurrentTotpEnabled(Boolean(me.totp_enabled));
    }
  };

  const loadAll = () => { fetchBookings(); fetchSummary(); fetchConcerts(); fetchPhones(); fetchLenses(); fetchReviews(); fetchUsers(); fetchAnnouncement(); fetchSettings(); fetchLineQuota(); fetchAdmins(); fetchAuditLog(); };

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

  const fetchLineQuota = async () => {
    setLineQuota(current => ({ ...current, loading:true }));
    try {
      const res = await fetch("/api/admin/line/message-quota", { cache:"no-store" });
      const out = await res.json().catch(() => null);
      if (out?.status) {
        setLineQuota({ ...out, loading:false });
      } else {
        setLineQuota({ status:"error", loading:false });
      }
    } catch {
      setLineQuota({ status:"error", loading:false });
    }
  };

  const setBookingStatus = async (id: string, status: "confirmed"|"rejected") => {
    const res = await fetch(`/api/admin/bookings/${id}/status`, {
      method:"PATCH", headers:{"content-type":"application/json"},
      body: JSON.stringify({status}), cache:"no-store",
    });
    const out = await res.json().catch(()=>null);
    if (!res.ok) { showMsg(out?.error || "ไม่สำเร็จ", false); return; }
    if (status === "confirmed") {
      const lineSent = out?.notification?.sent === true;
      const lineReason = out?.notification?.reason;
      const recorded = out?.notification?.recorded !== false;
      if (lineSent) {
        showMsg(
          recorded
            ? "✅ ยืนยันแล้ว และส่งข้อความแจ้งเตือนผ่าน LINE แล้ว"
            : "✅ LINE รับข้อความแล้ว แต่บันทึกสถานะการส่งไม่สำเร็จ",
          recorded
        );
      } else if (lineReason === "quota_exceeded") {
        showMsg("✅ ยืนยันแล้ว แต่ LINE ส่งไม่ผ่าน: โควต้ารายเดือนเต็ม", false);
      } else {
        const diagnostic = lineNotificationDiagnostic(out?.notification ?? {});
        showMsg(
          `✅ ยืนยันแล้ว แต่ส่งข้อความแจ้งเตือนผ่าน LINE ไม่สำเร็จ${diagnostic ? ` (${diagnostic})` : ""}`,
          false
        );
      }
    } else {
      showMsg("❌ ปฏิเสธแล้ว");
    }
    fetchBookings(); fetchSummary();
    if (status === "confirmed") fetchLineQuota();
  };

  const [banningUserId, setBanningUserId] = useState<string|null>(null);
  const toggleUserBan = async (userId: string, banned: boolean) => {
    if (banned && !window.confirm("แบนผู้ใช้นี้? ผู้ใช้จะถูกเตะออกจาก session ทันทีและล็อกอินไม่ได้อีก")) return;
    setBanningUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ banned }), cache: "no-store",
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "ไม่สำเร็จ", false); return; }
      showMsg(banned ? "🚫 แบนผู้ใช้แล้ว" : "✅ ปลดแบนแล้ว");
      fetchBookings();
      fetchUsers();
    } finally {
      setBanningUserId(null);
    }
  };

  const [retryingLineBookingId, setRetryingLineBookingId] = useState<string|null>(null);
  const retryLineNotification = async (id: string) => {
    setRetryingLineBookingId(id);
    try {
      const res = await fetch(`/api/admin/bookings/${id}/line-notification`, {
        method:"POST", cache:"no-store",
      });
      const out = await res.json().catch(()=>null);
      if (!res.ok) { showMsg(out?.error || "ส่ง LINE ซ้ำไม่สำเร็จ", false); return; }

      const lineSent = out?.notification?.sent === true;
      const recorded = out?.notification?.recorded !== false;
      if (lineSent) {
        showMsg(
          recorded
            ? "✅ ส่งข้อความ LINE ซ้ำสำเร็จ"
            : "✅ LINE รับข้อความแล้ว แต่บันทึกสถานะการส่งไม่สำเร็จ",
          recorded
        );
      } else if (out?.notification?.reason === "quota_exceeded") {
        showMsg("⛔ ส่ง LINE ไม่ผ่าน: โควต้ารายเดือนเต็ม", false);
      } else {
        const diagnostic = lineNotificationDiagnostic(out?.notification ?? {});
        showMsg(`🔴 ส่งข้อความ LINE ซ้ำไม่สำเร็จ${diagnostic ? ` (${diagnostic})` : ""}`, false);
      }
      fetchBookings(); fetchLineQuota();
    } catch {
      showMsg("ส่ง LINE ซ้ำไม่สำเร็จ", false);
    } finally {
      setRetryingLineBookingId(null);
    }
  };

  const viewSlip = async (bookingId: string) => {
    setViewingSlipId(bookingId);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/slip-url`, { cache:"no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "ไม่มีสลิป", false); return; }
      setSlipModal(out.url);
    } finally {
      setViewingSlipId(null);
    }
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

  // ── toggle เปิด/ปิดตรวจสอบสลิปอัตโนมัติ (เผื่อโควต้า SlipOK หมด) ──
  const [slipOkEnabled, setSlipOkEnabled] = useState(true);
  const fetchSettings = async () => {
    const res = await fetch("/api/admin/settings", { cache:"no-store" });
    if (res.ok) {
      const out = await res.json();
      setSlipOkEnabled(out.slipok_enabled ?? true);
    }
  };
  const toggleSlipOk = async () => {
    const next = !slipOkEnabled;
    setSlipOkEnabled(next); // optimistic update
    const res = await fetch("/api/admin/settings", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ slipok_enabled: next }), cache:"no-store",
    });
    if (!res.ok) {
      setSlipOkEnabled(!next); // revert ถ้าพลาด
      showMsg("เปลี่ยนการตั้งค่าไม่สำเร็จ", false);
      return;
    }
    showMsg(next ? "✅ เปิดตรวจสอบสลิปอัตโนมัติแล้ว" : "⏸️ ปิดตรวจสอบสลิปอัตโนมัติแล้ว");
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
    const res = await fetch(`/api/admin/concerts/${editSessionConcertId}/sessions`, {
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

  // ── โควต้ามือถือรายรอบ ──
  const openQuotaManager = async (session: Session) => {
    setQuotaSession(session);
    setQuotaLoading(true);
    try {
      const res = await fetch(`/api/admin/sessions/${session.id}/quota`, { cache:"no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "โหลดโควต้าไม่สำเร็จ", false); setQuotaSession(null); return; }
      const list: PhoneQuotaInfo[] = out.phones ?? [];
      setQuotaData(list);
      // ถ้ายังไม่เคยตั้งโควต้ารุ่นนี้มาก่อน ให้ค่าเริ่มต้นเป็น "เหลือให้จัดสรรได้อีกเท่าไหร่" เลย
      // (ปกติรอบเดียวไม่ชนกับใคร ก็จะเท่ากับจำนวนรวมร้านพอดี) แอดมินแค่มาลดตัวเลขเอาถ้าต้องการแบ่งให้รอบอื่น
      const inputs: Record<string, string> = {};
      for (const p of list) {
        inputs[p.phone_id] = String(p.current_quota != null ? p.current_quota : p.available_to_allocate);
      }
      setQuotaInputs(inputs);
    } finally {
      setQuotaLoading(false);
    }
  };

  const closeQuotaManager = () => { setQuotaSession(null); setQuotaData([]); setQuotaInputs({}); };

  const saveQuota = async () => {
    if (!quotaSession) return;
    const items = Object.entries(quotaInputs)
      .filter(([, v]) => v.trim() !== "")
      .map(([phone_id, v]) => ({ phone_id, qty: Number(v) }));
    if (items.length === 0) { showMsg("ยังไม่ได้กรอกจำนวนเลย", false); return; }

    setQuotaSaving(true);
    try {
      const res = await fetch(`/api/admin/sessions/${quotaSession.id}/quota`, {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ items }), cache:"no-store",
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "บันทึกไม่สำเร็จ", false); return; }
      showMsg("✅ บันทึกโควต้าแล้ว");
      openQuotaManager(quotaSession);
    } finally {
      setQuotaSaving(false);
    }
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

  // ── ผู้ใช้ (แบน/ปลดแบน) ──
  const fetchUsers = async () => {
    const res = await fetch("/api/admin/users", { cache:"no-store" });
    if (res.ok) {
      const out = await res.json();
      setUsers(out.users ?? []);
    }
  };

  // ── บัญชีแอดมิน ──
  const fetchAdmins = async () => {
    const res = await fetch("/api/admin/admins", { cache:"no-store" });
    if (res.ok) {
      const out = await res.json();
      setAdmins(out.admins ?? []);
    }
  };

  const createAdmin = async () => {
    if (!newAdminUsername.trim() || !newAdminPassword) { showMsg("กรอกให้ครบ", false); return; }
    setCreatingAdmin(true);
    try {
      const res = await fetch("/api/admin/admins", {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ username: newAdminUsername.trim(), password: newAdminPassword }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "สร้างไม่สำเร็จ", false); return; }
      showMsg("✅ สร้างบัญชีแอดมินแล้ว");
      setNewAdminUsername(""); setNewAdminPassword("");
      fetchAdmins(); fetchAuditLog();
    } finally {
      setCreatingAdmin(false);
    }
  };

  const deleteAdmin = async (id: string, username: string) => {
    if (!window.confirm(`ลบบัญชีแอดมิน "${username}"?`)) return;
    setDeletingAdminId(id);
    try {
      const res = await fetch(`/api/admin/admins/${id}`, { method:"DELETE", cache:"no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "ลบไม่สำเร็จ", false); return; }
      showMsg("🗑 ลบบัญชีแล้ว");
      fetchAdmins(); fetchAuditLog();
    } finally {
      setDeletingAdminId(null);
    }
  };

  // ── 2FA ของบัญชีตัวเอง ──
  const startTotpSetup = async () => {
    setTotpBusy(true);
    try {
      const res = await fetch("/api/admin/2fa/setup", { method:"POST", cache:"no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "เริ่มตั้งค่าไม่สำเร็จ", false); return; }
      setTotpSetup({ secret: out.secret, qr_data_url: out.qr_data_url });
      setTotpSetupCode("");
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmTotpSetup = async () => {
    if (!totpSetupCode.trim()) { showMsg("กรอกรหัส 6 หลัก", false); return; }
    setTotpBusy(true);
    try {
      const res = await fetch("/api/admin/2fa/confirm", {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ code: totpSetupCode.trim() }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "ยืนยันไม่สำเร็จ", false); return; }
      showMsg("✅ เปิดใช้งาน 2FA แล้ว");
      setCurrentTotpEnabled(true);
      setTotpSetup(null); setTotpSetupCode("");
      fetchAuditLog();
    } finally {
      setTotpBusy(false);
    }
  };

  const cancelTotpSetup = () => { setTotpSetup(null); setTotpSetupCode(""); };

  const disableTotp = async () => {
    if (!totpDisableCode.trim()) { showMsg("กรอกรหัส 6 หลักจาก authenticator เพื่อยืนยัน", false); return; }
    setTotpBusy(true);
    try {
      const res = await fetch("/api/admin/2fa/disable", {
        method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ code: totpDisableCode.trim() }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) { showMsg(out?.error || "ปิดใช้งานไม่สำเร็จ", false); return; }
      showMsg("🔓 ปิดใช้งาน 2FA แล้ว");
      setCurrentTotpEnabled(false);
      setTotpShowDisableForm(false); setTotpDisableCode("");
      fetchAuditLog();
    } finally {
      setTotpBusy(false);
    }
  };

  // ── ประวัติการดำเนินการของแอดมิน ──
  const fetchAuditLog = async (usernameFilter?: string) => {
    const qs = usernameFilter ? `?username=${encodeURIComponent(usernameFilter)}` : "";
    const res = await fetch(`/api/admin/audit-log${qs}`, { cache:"no-store" });
    if (res.ok) {
      const out = await res.json();
      setAuditLog(out.logs ?? []);
    }
  };

  // ── รีวิวลูกค้า (ดู + ลบ) ──
  const fetchReviews = async () => {
    const res = await fetch("/api/admin/reviews", { cache:"no-store" });
    if (res.ok) {
      const out = await res.json();
      setReviews(out.reviews ?? []);
    }
  };

  const deleteReview = async (id: string) => {
    if (!confirm("ลบรีวิวนี้?")) return;
    const res = await fetch(`/api/admin/reviews/${id}`, { method:"DELETE", cache:"no-store" });
    if (!res.ok) { showMsg("ลบไม่สำเร็จ", false); return; }
    showMsg("ลบรีวิวแล้ว");
    fetchReviews();
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
        loadAll();
        fetchMe();
      } else {
        // ยังไม่ได้ล็อกอิน — เช็คว่าต้องตั้งค่าบัญชีแอดมินคนแรกก่อนไหม
        try {
          const bRes = await fetch("/api/admin/admins", { cache:"no-store" });
          const bOut = await bRes.json().catch(() => null);
          setNeedsBootstrap(bRes.ok ? Boolean(bOut?.needsBootstrap) : false);
        } catch {
          setNeedsBootstrap(false);
        }
      }
    })();
  }, []);

  useEffect(() => { if (isAuthed) { fetchBookings(); fetchSummary(); } }, [bStatus]);

  // ── auto-refresh: ดึงรายการจอง + ตัวเลขสรุปใหม่เป็นระยะ กันหน้าค้างตอนมีลูกค้าจองเข้ามาใหม่ ──
  useEffect(() => {
    if (!isAuthed) return;
    const id = setInterval(() => { fetchBookings(); fetchSummary(); }, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, bStatus, bQ]);

  const hasLineQuota =
    lineQuota.status === "connected" &&
    lineQuota.quotaType === "limited" &&
    typeof lineQuota.limit === "number";
  const lineQuotaPercent = hasLineQuota
    ? lineQuota.limit! > 0
      ? Math.min(100, Math.round(((lineQuota.used ?? 0) / lineQuota.limit!) * 100))
      : 100
    : 0;
  const lineQuotaColor = lineQuotaPercent >= 90 ? "#C43D5C" : lineQuotaPercent >= 70 ? "#D68A00" : "#06C755";
  const lineQuotaRemaining = hasLineQuota
    ? lineQuota.remaining ?? Math.max(lineQuota.limit! - (lineQuota.used ?? 0), 0)
    : null;
  const lineQuotaExhausted = hasLineQuota && lineQuotaRemaining === 0;
  const lineQuotaBadge = lineQuota.loading
    ? { label:"⏳ กำลังตรวจสอบ", background:"#F2F4F5", border:"#D8DEE2", color:"#59636B" }
    : lineQuota.status === "connected" && lineQuotaExhausted
      ? { label:"⛔ โควต้าหมด", background:"#FFF1F2", border:"#F9C7D1", color:"#C43D5C" }
      : lineQuota.status === "connected"
        ? { label:"🟢 พร้อมส่ง", background:"#F0FFF4", border:"#B7EFC5", color:"#0F9D4E" }
        : lineQuota.status === "not_configured"
          ? { label:"🟡 ยังไม่ได้ตั้งค่า Token", background:"#FFF9E6", border:"#F3E3B8", color:"#8A6D2F" }
          : { label:"🔴 ติดต่อ LINE ไม่สำเร็จ", background:"#FFF1F2", border:"#F9C7D1", color:"#C43D5C" };
  // ─────────── login screen ───────────
  if (!isAuthed) {
    if (needsBootstrap === null) {
      return (
        <div style={{ minHeight:"100vh", background:UI.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:UI.font, color:UI.muted, fontWeight:700 }}>
          ⏳ กำลังโหลด...
        </div>
      );
    }

    if (needsBootstrap) {
      return (
        <div style={{ minHeight:"100vh", background:UI.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:UI.font, color:UI.ink }}>
          <div style={{ ...card, width:"100%", maxWidth:400, padding:24 }}>
            <div style={{ fontWeight:700, fontSize:22, marginBottom:6 }}>🛡️ ตั้งค่าบัญชีแอดมินคนแรก</div>
            <div style={{ fontSize:12, color:UI.muted, fontWeight:600, marginBottom:16 }}>
              ยังไม่มีบัญชีแอดมินในระบบ กรุณาสร้างบัญชีแรกก่อนเข้าใช้งาน
            </div>
            <input value={loginUsername} onChange={e=>setLoginUsername(e.target.value)}
              placeholder="username" style={{ ...inputStyle, marginBottom:10 }} />
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" style={{ ...inputStyle, marginBottom:10 }} />
            <input type="password" value={bootstrapPassword2} onChange={e=>setBootstrapPassword2(e.target.value)}
              placeholder="ยืนยันรหัสผ่านอีกครั้ง" style={{ ...inputStyle, marginBottom:10 }} />
            <input type="password" value={bootstrapSecret} onChange={e=>setBootstrapSecret(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&handleBootstrap()}
              placeholder="Bootstrap secret (จาก ADMIN_BOOTSTRAP_SECRET)" style={{ ...inputStyle, marginBottom:12 }} />
            {loginError && (
              <div style={{ fontSize:12, color:"#C43D5C", fontWeight:700, marginBottom:12 }}>⚠️ {loginError}</div>
            )}
            <button onClick={handleBootstrap} disabled={loading||!loginUsername.trim()||!password} style={btnStyle("dark", loading||!loginUsername.trim()||!password)}>
              {loading ? "⏳..." : "สร้างบัญชี"}
            </button>
          </div>
        </div>
      );
    }

    if (pendingTotpToken) {
      return (
        <div style={{ minHeight:"100vh", background:UI.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:UI.font, color:UI.ink }}>
          <div style={{ ...card, width:"100%", maxWidth:400, padding:24 }}>
            <div style={{ fontWeight:700, fontSize:22, marginBottom:6 }}>🔑 กรอกรหัส 2FA</div>
            <div style={{ fontSize:12, color:UI.muted, fontWeight:600, marginBottom:16 }}>
              เปิดแอป Google Authenticator แล้วกรอกรหัส 6 หลักปัจจุบัน
            </div>
            <input
              value={totpCode}
              onChange={e=>setTotpCode(e.target.value.replace(/\D/g,"").slice(0,6))}
              onKeyDown={e=>e.key==="Enter"&&handleVerify2fa()}
              placeholder="000000" inputMode="numeric" maxLength={6}
              style={{ ...inputStyle, marginBottom:12, textAlign:"center", fontSize:22, letterSpacing:6, fontWeight:700 }}
            />
            {loginError && (
              <div style={{ fontSize:12, color:"#C43D5C", fontWeight:700, marginBottom:12 }}>⚠️ {loginError}</div>
            )}
            <button onClick={handleVerify2fa} disabled={loading||totpCode.length!==6} style={{ ...btnStyle("dark", loading||totpCode.length!==6), width:"100%", justifyContent:"center", marginBottom:10 }}>
              {loading ? "⏳..." : "ยืนยัน"}
            </button>
            <button onClick={cancelVerify2fa} style={{ ...btnStyle("white"), width:"100%", justifyContent:"center" }}>
              ย้อนกลับ
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ minHeight:"100vh", background:UI.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:UI.font, color:UI.ink }}>
        <div style={{ ...card, width:"100%", maxWidth:400, padding:24 }}>
          <div style={{ fontWeight:700, fontSize:22, marginBottom:6 }}>🔐 Admin Login</div>
          <input value={loginUsername} onChange={e=>setLoginUsername(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            placeholder="username" style={{ ...inputStyle, marginBottom:10 }} />
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            placeholder="รหัสผ่าน" style={{ ...inputStyle, marginBottom:12 }} />
          {loginError && (
            <div style={{ fontSize:12, color:"#C43D5C", fontWeight:700, marginBottom:12 }}>⚠️ {loginError}</div>
          )}
          <button onClick={handleLogin} disabled={loading||!loginUsername.trim()||!password} style={btnStyle("dark", loading||!loginUsername.trim()||!password)}>
            {loading ? "⏳..." : "เข้าใช้งาน"}
          </button>
        </div>
      </div>
    );
  }

  // ─────────── main ───────────
  const sidebarW = sidebarCollapsed ? 68 : 216;

  return (
    <div style={{ minHeight:"100vh", background:UI.bg, fontFamily:UI.font, color:UI.ink, display:"flex", flexDirection: isMobile ? "column" : "row" }}>

      {/* ═══════════════ SIDEBAR (desktop/tablet) ═══════════════ */}
      {!isMobile && (
        <div style={{
          width: sidebarW, flexShrink: 0, background:"#fff", borderRight:`1px solid ${UI.border}`,
          display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh",
          transition:"width .18s ease", overflow:"hidden",
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding: sidebarCollapsed ? "16px 12px" : "16px 18px", borderBottom:`1px solid ${UI.border}` }}>
            <img src="/crabby-logo.png" alt="Crabby" style={{ width:36, height:36, objectFit:"contain", borderRadius:10, flexShrink:0 }} />
            {!sidebarCollapsed && (
              <div style={{ minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:15, whiteSpace:"nowrap" }}>Crabby</div>
                <div style={{ fontSize:11, color:UI.muted, fontWeight:600, whiteSpace:"nowrap" }}>เช่ามือถือ · แอดมิน</div>
              </div>
            )}
          </div>

          <nav style={{ flex:1, padding:"14px 10px", display:"flex", flexDirection:"column", gap:3, overflowY:"auto" }}>
            {TAB_ITEMS.map(item => {
              const active = tab === item.key;
              const badge = item.key === "bookings" ? summary.pending : 0;
              return (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  title={sidebarCollapsed ? item.label : undefined}
                  style={{
                    display:"flex", alignItems:"center", gap:10,
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    padding: sidebarCollapsed ? "10px 0" : "10px 12px",
                    borderRadius:12, border:"none", cursor:"pointer",
                    background: active ? UI.accentSoft : "transparent",
                    color: active ? UI.accent2 : UI.ink,
                    fontWeight: active ? 700 : 600, fontSize:13.5, fontFamily:UI.font,
                    textAlign:"left", width:"100%", position:"relative",
                  }}
                >
                  <span style={{ fontSize:16, flexShrink:0 }}>{item.icon}</span>
                  {!sidebarCollapsed && <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.label}</span>}
                  {badge > 0 && (
                    <span style={{
                      position: sidebarCollapsed ? "absolute" : "static",
                      top: sidebarCollapsed ? 4 : undefined,
                      right: sidebarCollapsed ? 10 : undefined,
                      marginLeft: sidebarCollapsed ? 0 : "auto",
                      background:"#EF4463", color:"#fff", fontSize:10.5, fontWeight:700,
                      borderRadius:999, minWidth:18, height:18, display:"flex", alignItems:"center", justifyContent:"center",
                      padding:"0 5px", flexShrink:0,
                    }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div style={{ borderTop:`1px solid ${UI.border}`, padding:"10px 12px" }}>
            <button
              onClick={() => setSidebarCollapsed(v => !v)}
              style={{
                display:"flex", alignItems:"center", justifyContent: sidebarCollapsed ? "center" : "flex-start",
                gap:8, width:"100%", border:"none", background:"transparent", cursor:"pointer",
                color:UI.muted, fontWeight:600, fontSize:12.5, fontFamily:UI.font, padding:"8px 6px",
              }}
            >
              <span>{sidebarCollapsed ? "»" : "«"}</span>
              {!sidebarCollapsed && <span>ย่อเมนู</span>}
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ TOP NAV (mobile) ═══════════════ */}
      {isMobile && (
        <div style={{ position:"sticky", top:0, zIndex:20, background:"#fff", borderBottom:`1px solid ${UI.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px 8px" }}>
            <img src="/crabby-logo.png" alt="Crabby" style={{ width:30, height:30, objectFit:"contain", borderRadius:8, flexShrink:0 }} />
            <div style={{ minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:14, lineHeight:1.2 }}>Crabby แอดมิน</div>
              <div style={{ fontSize:10.5, color:UI.muted, fontWeight:600 }}>ระบบเช่ามือถือ</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:6, overflowX:"auto", padding:"0 12px 10px", WebkitOverflowScrolling:"touch" }}>
            {TAB_ITEMS.map(item => {
              const active = tab === item.key;
              const badge = item.key === "bookings" ? summary.pending : 0;
              return (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  style={{
                    display:"flex", alignItems:"center", gap:6, flexShrink:0,
                    minHeight:44, padding:"0 14px", borderRadius:999, border:"none", cursor:"pointer",
                    background: active ? UI.accentSoft : "#F5F1ED",
                    color: active ? UI.accent2 : UI.ink,
                    fontWeight: active ? 700 : 600, fontSize:13, fontFamily:UI.font,
                    whiteSpace:"nowrap", position:"relative",
                  }}
                >
                  <span style={{ fontSize:15 }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {badge > 0 && (
                    <span style={{
                      background:"#EF4463", color:"#fff", fontSize:10.5, fontWeight:700,
                      borderRadius:999, minWidth:17, height:17, display:"flex", alignItems:"center", justifyContent:"center",
                      padding:"0 5px", flexShrink:0,
                    }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div style={{ flex:1, minWidth:0, padding: isMobile ? "12px" : "14px 16px", overflowY: isMobile ? "visible" : "auto", height: isMobile ? "auto" : "100vh" }}>
      <div style={{ maxWidth:1100, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:24, fontWeight:700, color:UI.accent }}>หน้าต่างแอดมิน</div>
            <div style={{ fontSize:12, color:UI.muted, fontWeight:800 }}>ระบบเช่ามือถือ</div>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            {currentAdminUsername && (
              <div style={{ fontSize:12, color:UI.muted, fontWeight:700, padding:"6px 10px" }}>
                👤 {currentAdminUsername}
              </div>
            )}
            <button
              onClick={toggleSlipOk}
              style={{
                ...btnStyle("white"),
                border: `1px solid ${slipOkEnabled ? "#B7EFC5" : "#F9C7D1"}`,
                background: slipOkEnabled ? "#F0FFF4" : "#FFF1F2",
                color: slipOkEnabled ? "#0F9D4E" : "#C43D5C",
              }}
            >
              {slipOkEnabled ? "🟢 SlipOK: เปิดตรวจสอบอัตโนมัติ" : "⏸️ SlipOK: ปิดอยู่ (กดเพื่อเปิด)"}
            </button>
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

        {/* LINE Messaging API status + current-month quota */}
        <div style={{ ...card, padding:"14px 16px", marginBottom:14, border:"1px solid #B7EFC5", background:"#FBFFFC" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap", marginBottom:12 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color:UI.ink }}>💬 LINE แจ้งเตือนการอนุมัติ</div>
              <div style={{ fontSize:11, color:UI.muted, fontWeight:700, marginTop:2 }}>สถานะ Messaging API และโควต้าการส่งข้อความของเดือนนี้</div>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{
                borderRadius:999,
                padding:"5px 10px",
                fontWeight:800,
                fontSize:12,
                background: lineQuotaBadge.background,
                border: `1px solid ${lineQuotaBadge.border}`,
                color: lineQuotaBadge.color,
              }}>
                {lineQuotaBadge.label}
              </div>
              <button onClick={fetchLineQuota} disabled={lineQuota.loading} style={btnStyle("white", Boolean(lineQuota.loading))}>
                {lineQuota.loading ? "⏳ กำลังโหลด" : "🔄 อัปเดตโควต้า"}
              </button>
            </div>
          </div>

          {hasLineQuota && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10, flexWrap:"wrap", marginBottom:7 }}>
                <div style={{ fontWeight:700, fontSize:16, color:UI.ink }}>
                  ส่งแล้ว {(lineQuota.used ?? 0).toLocaleString("th-TH")} / {lineQuota.limit!.toLocaleString("th-TH")} ข้อความ
                </div>
                <div style={{ fontSize:12, color:lineQuotaColor, fontWeight:800 }}>
                  เหลือ {(lineQuotaRemaining ?? 0).toLocaleString("th-TH")} ข้อความ
                </div>
              </div>
              <div style={{ height:10, borderRadius:999, overflow:"hidden", background:"#E8EEEA" }} aria-label={`ใช้โควต้า LINE ${lineQuotaPercent}%`}>
                <div style={{ height:"100%", width:`${lineQuotaPercent}%`, background:lineQuotaColor, borderRadius:999, transition:"width .2s ease" }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginTop:7, fontSize:11, color:UI.muted, fontWeight:700 }}>
                <span>ใช้ไป {lineQuotaPercent}% ในเดือนนี้</span>
                {lineQuota.refreshedAt && <span>อัปเดต {fmtDT(lineQuota.refreshedAt)}</span>}
              </div>
            </div>
          )}

          {lineQuota.status === "connected" && lineQuota.quotaType === "none" && (
            <div style={{ fontSize:13, fontWeight:700, color:"#0F9D4E" }}>
              🟢 เชื่อมต่อสำเร็จ · ส่งแล้ว {(lineQuota.used ?? 0).toLocaleString("th-TH")} ข้อความในเดือนนี้ · แพ็กเกจนี้ไม่มีเพดานโควต้า
            </div>
          )}

          {lineQuota.status === "not_configured" && !lineQuota.loading && (
            <div style={{ fontSize:13, fontWeight:700, color:"#8A6D2F" }}>
              เพิ่ม <code>LINE_MESSAGING_CHANNEL_ACCESS_TOKEN</code> ใน Environment Variables ก่อนเริ่มส่งข้อความ
            </div>
          )}

          {lineQuota.status === "error" && !lineQuota.loading && (
            <div style={{ fontSize:13, fontWeight:700, color:"#C43D5C" }}>
              ตรวจสอบ Token ของ Messaging API และการเชื่อมต่อกับ LINE แล้วกดอัปเดตอีกครั้ง
            </div>
          )}
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
                const lineMessageMeta = getLineMessageMeta(b.line_message_status);
                const canRetryLine =
                  b.status === "confirmed" &&
                  (b.line_message_status == null || b.line_message_status === "failed" || b.line_message_status === "quota_exceeded");
                const lineStatusAt = b.line_message_status === "sent"
                  ? b.line_message_sent_at
                  : b.line_message_attempted_at;
                const lineFailure = lineMessageDiagnostic(b);

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
                          {b.is_banned && (
                            <div style={{ borderRadius:999, border:"1px solid #C43D5C", background:"#FFF1F2", padding:"5px 12px", fontWeight:700, color:"#C43D5C", fontSize:12 }}>
                              🚫 ผู้ใช้ถูกแบน
                            </div>
                          )}
                          {b.status === "confirmed" && (
                            <div style={{
                              borderRadius:999, border:`1px solid ${lineMessageMeta.border}`, background:lineMessageMeta.bg,
                              padding:"5px 12px", fontWeight:700, color:lineMessageMeta.color, fontSize:12,
                            }}>
                              💬 LINE: {lineMessageMeta.label}
                              {b.line_message_attempt_count ? ` · ${b.line_message_attempt_count} ครั้ง` : ""}
                              {lineStatusAt ? ` · ${fmtDT(lineStatusAt)}` : ""}
                              {lineFailure ? ` (${lineFailure})` : ""}
                            </div>
                          )}
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
                        <button
                          disabled={!b.slip_url || viewingSlipId===b.id}
                          onClick={()=>b.slip_url?viewSlip(b.id):showMsg("ไม่มีสลิป",false)}
                          style={btnStyle("white", !b.slip_url || viewingSlipId===b.id)}
                        >
                          {viewingSlipId===b.id ? "⏳ กำลังโหลด..." : "🧾 ดูสลิป"}
                        </button>
                        <button
                          disabled={!b.slip_url || verifyingId===b.id}
                          onClick={()=>verifySlip(b.id)}
                          style={btnStyle("blue", !b.slip_url || verifyingId===b.id)}
                        >
                          {verifyingId===b.id ? "⏳ กำลังตรวจสอบ..." : b.slip_verified != null ? "🔄 ตรวจสอบสลิปอีกครั้ง" : "🔍 ตรวจสอบสลิปด้วย SlipOK"}
                        </button>
                        <button disabled={!pending||loading} onClick={()=>setBookingStatus(b.id,"confirmed")} style={btnStyle("green",!pending||loading)}>✅ ยืนยัน</button>
                        <button disabled={!pending||loading} onClick={()=>setBookingStatus(b.id,"rejected")} style={btnStyle("red",!pending||loading)}>❌ ปฏิเสธ</button>
                        {canRetryLine && (
                          <button
                            disabled={retryingLineBookingId===b.id}
                            onClick={() => {
                              if (
                                b.line_message_status == null &&
                                !window.confirm("รายการนี้ไม่มีประวัติการส่ง LINE ต้องการส่งข้อความแจ้งเตือนตอนนี้หรือไม่?")
                              ) return;
                              retryLineNotification(b.id);
                            }}
                            style={btnStyle("blue", retryingLineBookingId===b.id)}
                          >
                            {retryingLineBookingId===b.id
                              ? "⏳ กำลังส่ง LINE..."
                              : b.line_message_status == null
                                ? "✉️ ส่ง LINE ตอนนี้"
                                : "↻ ส่ง LINE อีกครั้ง"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════════ TAB: USERS ═══════════════ */}
        {tab === "users" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:10 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>👤 ผู้ใช้ทั้งหมด ({users.length})</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <input value={uQ} onChange={e=>setUQ(e.target.value)} placeholder="ค้นหาชื่อ..." style={{ ...inputStyle, maxWidth:200 }} />
                <button onClick={fetchUsers} style={btnStyle("white")}>🔄 รีเฟรช</button>
              </div>
            </div>

            {(() => {
              const filtered = uQ.trim()
                ? users.filter(u => (u.name ?? "").toLowerCase().includes(uQ.trim().toLowerCase()))
                : users;

              if (filtered.length === 0) {
                return (
                  <div style={{ ...card, padding:24, textAlign:"center", color:UI.muted, fontWeight:700 }}>
                    ไม่มีผู้ใช้
                  </div>
                );
              }

              return (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {filtered.map((u) => {
                    const firstChar = (u.name || "U").trim()[0]?.toUpperCase() ?? "U";
                    return (
                      <div key={u.id} style={{ ...card, padding:16 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
                          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                            {u.picture ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={u.picture} alt={u.name ?? "user"} width={36} height={36} style={{ borderRadius:"50%", objectFit:"cover", flexShrink:0 }} />
                            ) : (
                              <div style={{ width:36, height:36, borderRadius:"50%", background:UI.accent, border:`1px solid ${UI.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:16, flexShrink:0 }}>
                                {firstChar}
                              </div>
                            )}
                            <div>
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <span style={{ fontWeight:700, fontSize:14, color:UI.ink }}>{u.name ?? "ไม่ทราบชื่อ"}</span>
                                {u.is_banned && (
                                  <span style={{ fontSize:11, fontWeight:700, borderRadius:999, padding:"2px 8px", background:"#FFF1F2", color:"#C43D5C" }}>
                                    🚫 ถูกแบน
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize:11, color:UI.muted, fontWeight:600, marginTop:2 }}>
                                📋 {u.booking_count} การจอง · 💰 {money(u.total_spent)}
                              </div>
                              {u.is_banned && u.ban_reason && (
                                <div style={{ fontSize:11, color:"#C43D5C", fontWeight:600, marginTop:2 }}>
                                  เหตุผล: {u.ban_reason}
                                </div>
                              )}
                              {u.is_banned && u.banned_at && (
                                <div style={{ fontSize:11, color:UI.muted, fontWeight:600, marginTop:2 }}>
                                  แบนเมื่อ {fmtDT(u.banned_at)}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            disabled={banningUserId===u.id}
                            onClick={() => toggleUserBan(u.id, !u.is_banned)}
                            style={btnStyle(u.is_banned ? "white" : "red", banningUserId===u.id)}
                          >
                            {banningUserId===u.id
                              ? "⏳ กำลังบันทึก..."
                              : u.is_banned ? "🔓 ปลดแบนผู้ใช้" : "🚫 แบนผู้ใช้"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
                              <button onClick={()=>openQuotaManager(s)} style={{ ...btnStyle("blue"), padding:"4px 10px", fontSize:12 }}>🎯 โควต้า</button>
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

            {/* Quota Modal */}
            {quotaSession && (
              <div onClick={closeQuotaManager} style={{ position:"fixed", inset:0, background:"rgba(51,46,44,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:20 }}>
                <div onClick={e=>e.stopPropagation()} style={{ ...card, width:"100%", maxWidth:520, padding:20, maxHeight:"85vh", overflowY:"auto" }}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>🎯 ตั้งโควต้ามือถือของรอบนี้</div>
                  <div style={{ fontSize:12, color:UI.muted, fontWeight:700, marginBottom:14 }}>
                    ⏰ {fmtDT(quotaSession.start_at)}{quotaSession.note?` — ${quotaSession.note}`:""}
                  </div>

                  {quotaLoading ? (
                    <div style={{ fontWeight:800, color:UI.muted, padding:"20px 0", textAlign:"center" }}>⏳ กำลังโหลด...</div>
                  ) : quotaData.length === 0 ? (
                    <div style={{ fontWeight:700, color:UI.muted, padding:"20px 0", textAlign:"center" }}>ยังไม่มีรุ่นมือถือที่ active</div>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                      {quotaData.map((p) => {
                        const shared = p.allocated_elsewhere > 0;
                        return (
                          <div key={p.phone_id} style={{
                            borderRadius:14,
                            border: `1.5px solid ${shared ? "#F3D9A8" : UI.border}`,
                            background: shared ? "#FFFBF3" : "#fff",
                            padding:14,
                            boxShadow: UI.shadowSm,
                          }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:10 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                                <span style={{ fontSize:20, flexShrink:0 }}>📱</span>
                                <span style={{ fontWeight:700, fontSize:14, color:UI.ink, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.model_name}</span>
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                                <input
                                  value={quotaInputs[p.phone_id] ?? ""}
                                  onChange={e=>setQuotaInputs(prev=>({ ...prev, [p.phone_id]: e.target.value.replace(/\D/g,"") }))}
                                  placeholder="0"
                                  style={{ ...inputStyle, width:64, textAlign:"center", fontWeight:800, fontSize:16, border:`1.5px solid ${UI.accent2}`, color:UI.accent2 }}
                                />
                                <span style={{ fontSize:12, color:UI.muted, fontWeight:700 }}>เครื่อง</span>
                              </div>
                            </div>

                            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                              <span style={{ borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700, background:"#F5F3F1", color:UI.muted }}>
                                มีทั้งหมด {p.total_qty}
                              </span>
                              {shared && (
                                <span style={{ borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700, background:"#FFF3D6", color:"#8A6D2F" }}>
                                  ⚠️ รอบอื่นวันนี้ใช้ไป {p.allocated_elsewhere}
                                </span>
                              )}
                              {p.already_booked > 0 && (
                                <span style={{ borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700, background:"#EFE6FF", color:UI.accent2 }}>
                                  🎫 จองแล้ว {p.already_booked}
                                </span>
                              )}
                              <span style={{
                                borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700,
                                background: p.available_to_allocate > 0 ? "#E1FAEC" : "#FFF1F2",
                                color: p.available_to_allocate > 0 ? "#0F9D4E" : "#C43D5C",
                              }}>
                                {p.available_to_allocate > 0 ? "✅" : "🚫"} เหลือให้จัดสรร {p.available_to_allocate}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={saveQuota} disabled={quotaSaving||quotaLoading} style={{ ...btnStyle("dark", quotaSaving||quotaLoading), flex:1, justifyContent:"center" }}>
                      {quotaSaving ? "⏳ กำลังบันทึก..." : "💾 บันทึกโควต้า"}
                    </button>
                    <button onClick={closeQuotaManager} style={btnStyle("white")}>ปิด</button>
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

        {/* ═══════════════ TAB: REVIEWS ═══════════════ */}
        {tab === "reviews" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>⭐ รีวิวจากลูกค้า ({reviews.length})</div>
              <button onClick={fetchReviews} style={btnStyle("white")}>🔄 รีเฟรช</button>
            </div>

            {reviews.length === 0 ? (
              <div style={{ ...card, padding:24, textAlign:"center", color:UI.muted, fontWeight:700 }}>
                ยังไม่มีรีวิวเข้ามา
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {reviews.map((r) => (
                  <div key={r.id} style={{ ...card, padding:16 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, marginBottom:8 }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontWeight:700, fontSize:14, color:UI.ink }}>{r.display_name}</span>
                          <span style={{
                            fontSize:11, fontWeight:700, borderRadius:999, padding:"2px 8px",
                            background: r.is_published ? "#E1FAEC" : "#FFFBEF",
                            color: r.is_published ? "#0F9D4E" : "#8A6D2F",
                          }}>
                            {r.is_published ? "✅ เผยแพร่แล้ว" : "⏳ ยังไม่เผยแพร่"}
                          </span>
                        </div>
                        {r.concert_title && (
                          <div style={{ fontSize:12, color:UI.muted, fontWeight:600, marginTop:2 }}>🎫 {r.concert_title}</div>
                        )}
                      </div>
                      <button onClick={()=>deleteReview(r.id)} style={btnStyle("red")}>🗑 ลบ</button>
                    </div>

                    <div role="img" aria-label={`ให้คะแนน ${r.rating} จาก 5 ดาว`} style={{ color:"#F5B93F", fontSize:14, letterSpacing:1, marginBottom:8 }}>
                      <span aria-hidden="true">
                        {"★".repeat(r.rating)}
                        <span style={{ color:"#EDE7E1" }}>{"★".repeat(5 - r.rating)}</span>
                      </span>
                    </div>

                    <div style={{ fontSize:13, color:UI.ink, fontWeight:500, lineHeight:1.6, marginBottom:8 }}>
                      &ldquo;{r.comment}&rdquo;
                    </div>

                    <div style={{ fontSize:11, color:UI.muted, fontWeight:600 }}>
                      ส่งเมื่อ {new Date(r.created_at).toLocaleString("th-TH", { dateStyle:"medium", timeStyle:"short" })}
                    </div>
                  </div>
                ))}
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

        {/* ═══════════════ TAB: ADMINS ═══════════════ */}
        {tab === "admins" && (
          <div>
            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
                <div style={{ fontWeight:700, fontSize:15 }}>🔐 2FA ของบัญชีคุณ ({currentAdminUsername})</div>
                <span style={{
                  fontSize:11, fontWeight:700, borderRadius:999, padding:"3px 10px",
                  background: currentTotpEnabled ? "#E1FAEC" : "#FFF9E6",
                  color: currentTotpEnabled ? "#0F9D4E" : "#8A6D2F",
                }}>
                  {currentTotpEnabled ? "✅ เปิดใช้งานอยู่" : "⏸️ ยังไม่เปิดใช้งาน"}
                </span>
              </div>

              {!currentTotpEnabled && !totpSetup && (
                <button onClick={startTotpSetup} disabled={totpBusy} style={btnStyle("dark", totpBusy)}>
                  {totpBusy ? "⏳..." : "🔐 เปิดใช้งาน 2FA"}
                </button>
              )}

              {totpSetup && (
                <div>
                  <div style={{ fontSize:12, color:UI.muted, fontWeight:600, marginBottom:10 }}>
                    เปิดแอป Google Authenticator แล้วสแกน QR นี้ หรือกรอก key ด้านล่างด้วยตัวเอง
                  </div>
                  <img src={totpSetup.qr_data_url} alt="TOTP QR code" width={180} height={180} style={{ borderRadius:12, border:`1px solid ${UI.border}`, marginBottom:10, display:"block" }} />
                  <div style={{ fontSize:12, color:UI.ink, fontWeight:700, marginBottom:12, wordBreak:"break-all", background:"#F5F1ED", borderRadius:8, padding:"8px 10px" }}>
                    {totpSetup.secret}
                  </div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                    <input
                      value={totpSetupCode}
                      onChange={e=>setTotpSetupCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                      placeholder="กรอกรหัส 6 หลักเพื่อยืนยัน" inputMode="numeric" maxLength={6}
                      style={{ ...inputStyle, maxWidth:220 }}
                    />
                    <button onClick={confirmTotpSetup} disabled={totpBusy} style={btnStyle("dark", totpBusy)}>
                      {totpBusy ? "⏳..." : "ยืนยันเปิดใช้งาน"}
                    </button>
                    <button onClick={cancelTotpSetup} style={btnStyle("white")}>ยกเลิก</button>
                  </div>
                </div>
              )}

              {currentTotpEnabled && !totpShowDisableForm && (
                <button onClick={()=>setTotpShowDisableForm(true)} style={btnStyle("red")}>
                  ปิดใช้งาน 2FA
                </button>
              )}

              {currentTotpEnabled && totpShowDisableForm && (
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                  <input
                    value={totpDisableCode}
                    onChange={e=>setTotpDisableCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                    placeholder="กรอกรหัส 6 หลักเพื่อยืนยันปิด" inputMode="numeric" maxLength={6}
                    style={{ ...inputStyle, maxWidth:220 }}
                  />
                  <button onClick={disableTotp} disabled={totpBusy} style={btnStyle("red", totpBusy)}>
                    {totpBusy ? "⏳..." : "ยืนยันปิดใช้งาน"}
                  </button>
                  <button onClick={()=>{setTotpShowDisableForm(false); setTotpDisableCode("");}} style={btnStyle("white")}>ยกเลิก</button>
                </div>
              )}
            </div>

            <div style={{ ...card, padding:16, marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15, marginBottom:14 }}>➕ สร้างบัญชีแอดมินใหม่</div>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <input value={newAdminUsername} onChange={e=>setNewAdminUsername(e.target.value)} placeholder="username" style={{ ...inputStyle, maxWidth:200 }} />
                <input type="password" value={newAdminPassword} onChange={e=>setNewAdminPassword(e.target.value)} placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" style={{ ...inputStyle, maxWidth:240 }} />
                <button onClick={createAdmin} disabled={creatingAdmin} style={btnStyle("dark", creatingAdmin)}>
                  {creatingAdmin ? "⏳ กำลังสร้าง..." : "สร้างบัญชี"}
                </button>
              </div>
            </div>

            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>🛡️ บัญชีแอดมินทั้งหมด ({admins.length})</div>
              <button onClick={fetchAdmins} style={btnStyle("white")}>🔄 รีเฟรช</button>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {admins.map((a) => (
                <div key={a.id} style={{ ...card, padding:16, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontWeight:700, fontSize:14, color:UI.ink }}>{a.username}</span>
                      {a.username === currentAdminUsername && (
                        <span style={{ fontSize:11, fontWeight:700, borderRadius:999, padding:"2px 8px", background:UI.accentSoft, color:UI.accent }}>
                          คุณ
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:UI.muted, fontWeight:600, marginTop:2 }}>
                      สร้างเมื่อ {fmtDT(a.created_at)}
                    </div>
                  </div>
                  <button
                    disabled={deletingAdminId===a.id || admins.length<=1}
                    onClick={() => deleteAdmin(a.id, a.username)}
                    style={btnStyle("red", deletingAdminId===a.id || admins.length<=1)}
                  >
                    {deletingAdminId===a.id ? "⏳ กำลังลบ..." : "🗑 ลบบัญชี"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════ TAB: AUDIT LOG ═══════════════ */}
        {tab === "auditlog" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:10 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>📜 ประวัติการดำเนินการของแอดมิน ({auditLog.length})</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <select
                  value={auditFilter}
                  onChange={e => { setAuditFilter(e.target.value); fetchAuditLog(e.target.value || undefined); }}
                  style={{ ...inputStyle, maxWidth:200 }}
                >
                  <option value="">ทุกคน</option>
                  {admins.map(a => <option key={a.id} value={a.username}>{a.username}</option>)}
                </select>
                <button onClick={() => fetchAuditLog(auditFilter || undefined)} style={btnStyle("white")}>🔄 รีเฟรช</button>
              </div>
            </div>

            {auditLog.length === 0 ? (
              <div style={{ ...card, padding:24, textAlign:"center", color:UI.muted, fontWeight:700 }}>
                ยังไม่มีประวัติการดำเนินการ
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {auditLog.map((l) => (
                  <div key={l.id} style={{ ...card, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:UI.ink }}>
                        👤 {l.admin_username} <span style={{ color:UI.muted, fontWeight:600 }}>·</span> {l.action}
                      </div>
                      {l.detail && (
                        <div style={{ fontSize:12, color:UI.muted, fontWeight:600, marginTop:2 }}>{l.detail}</div>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:UI.muted, fontWeight:600, whiteSpace:"nowrap" }}>{fmtDT(l.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
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
    </div>
  );
}
