"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "./Navbar";
import AnnouncementBanner from "./AnnouncementBanner";
import HowToBookAndFaq from "./HowToBookAndFaq";
import Footer from "./Footer";

type MeUser = {
  line_sub: string;
  name?: string | null;
  picture?: string | null;
};

type Concert = {
  id: string;
  title: string;
  poster_url?: string | null;
  venue_name?: string | null;
  description?: string | null;
  publish_at?: string | null;
  sold_out?: boolean;
  no_sessions?: boolean;
  next_session_at?: string | null;
};

type ConcertListItem = Concert & { _status: "open" | "upcoming" };

type ConcertSession = {
  id: string;
  concert_id?: string;
  start_at: string;
  end_at?: string | null;
  note?: string | null;
};

type LensOption = {
  lens_id: string;
  name: string;
  focal_mm: number | null;
  price: number;
  remaining: number;
};

type PhoneOption = {
  phone_id: string;
  model_name: string;
  image_url?: string | null;
  price: number;
  deposit: number;
  remaining: number;
  lens_options: LensOption[];
};

// ── Design tokens — glass / vibrant ──────────────────────────────
// ต้องตรงกับเพดานที่ฝั่ง server บังคับไว้ใน src/app/api/bookings/upload-slip/route.ts
// (qty = Math.min(qty, 10)) ไม่งั้นลูกค้าจะเลือกได้เกินจริง แล้วโดนตัดยอดเงียบๆ ตอน submit
const MAX_PHONE_QTY = 10;

const ink = "#241F1C";
const sub = "#7A6D61";
const muted = "#AB9C8D";
const accent = "#F2467E";
const accentStrong = "#D81F5E";
const accent2 = "#8354E8"; // violet
const accentSoft = "#FFE3EE";
const violetSoft = "#EFE6FF";
const good = "#14B866";
const goodSoft = "#E1FAEC";
const warningSoft = "#FFF3D6";
const critical = "#EF4463";
const criticalSoft = "#FFE4E9";
const line = "#F2E4D6";
const borderStrong = "#E2CDB6";

const glass = "rgba(255,255,255,0.55)";
const glassStrong = "rgba(255,255,255,0.8)";
const glassBorder = "rgba(255,255,255,0.65)";
const glassHighlight = "rgba(255,255,255,0.55)";
const glassBlur = "blur(18px) saturate(170%)";
const accentGlow = "rgba(242,70,126,0.40)";
const lineGlow = "rgba(6,199,85,0.35)";
const uiFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, Roboto, sans-serif";

const doodle = {
  card: {
    borderRadius: "16px",
    border: `1px solid ${glassBorder}`,
    boxShadow: `0 1px 2px rgba(35,32,31,0.04), 0 8px 24px -14px rgba(35,32,31,0.16), inset 0 1px 0 ${glassHighlight}`,
    background: glass,
    backdropFilter: glassBlur,
    WebkitBackdropFilter: glassBlur,
  } as React.CSSProperties,
  cardPink: {
    borderRadius: "16px",
    border: `1px solid ${accent}`,
    boxShadow: `0 0 0 3px ${accentSoft}, 0 10px 26px -10px ${accentGlow}`,
    background: glass,
    backdropFilter: glassBlur,
    WebkitBackdropFilter: glassBlur,
  } as React.CSSProperties,
  cardYellow: {
    borderRadius: "16px",
    border: `1px solid ${glassBorder}`,
    boxShadow: `inset 0 1px 0 ${glassHighlight}`,
    background: `linear-gradient(120deg, ${accentSoft} 0%, ${warningSoft} 100%)`,
    backdropFilter: "blur(16px) saturate(160%)",
    WebkitBackdropFilter: "blur(16px) saturate(160%)",
  } as React.CSSProperties,
  btn: {
    borderRadius: "999px",
    border: `1px solid ${glassBorder}`,
    boxShadow: "none",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all .15s",
    background: glassStrong,
  } as React.CSSProperties,
  btnPrimary: {
    borderRadius: "999px",
    border: "none",
    boxShadow: `0 10px 26px -10px ${accentGlow}, inset 0 1px 0 rgba(255,255,255,0.35)`,
    fontWeight: 700,
    cursor: "pointer",
    // Solid accentStrong (not the accent→accentStrong gradient) so white label text
    // stays >=4.5:1 everywhere on the surface — the gradient's accent-colored end
    // only clears 3.53:1, which fails for this button's normal-sized (<18.66px bold) labels.
    background: accentStrong,
    color: "#fff",
  } as React.CSSProperties,
  btnGreen: {
    borderRadius: "999px",
    border: "none",
    boxShadow: `0 10px 24px -10px ${lineGlow}, inset 0 1px 0 rgba(255,255,255,0.3)`,
    fontWeight: 700,
    cursor: "pointer",
    background: "linear-gradient(135deg, #06C755, #05A648)",
    color: "#fff",
  } as React.CSSProperties,
  btnGray: {
    borderRadius: "999px",
    border: "none",
    boxShadow: "none",
    fontWeight: 700,
    cursor: "not-allowed",
    background: glass,
    color: muted,
  } as React.CSSProperties,
  input: {
    borderRadius: "12px",
    border: `1px solid ${borderStrong}`,
    padding: "10px 14px",
    fontSize: 16,
    outline: "none",
    width: "100%",
    background: "#fff",
    fontFamily: "inherit",
    boxSizing: "border-box",
  } as React.CSSProperties,
};

// Fixed ambient glow layer behind all page content (glassmorphism backdrop)
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
          "radial-gradient(60vw 60vw circle at 12% 0%, rgba(242,70,126,0.30), rgba(242,70,126,0) 70%)," +
          "radial-gradient(55vw 55vw circle at 100% 15%, rgba(131,84,232,0.26), rgba(131,84,232,0) 70%)," +
          "radial-gradient(60vw 60vw circle at 82% 100%, rgba(35,201,214,0.22), rgba(35,201,214,0) 72%)",
      }}
    />
  );
}

function formatThaiDateTime(iso: string) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default function PhoneRentalHome() {
  const router = useRouter();

  const [meUser, setMeUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const stepLabels = ["คอนเสิร์ต", "รอบ & มือถือ", "ข้อมูล", "ชำระเงิน", "เสร็จสิ้น"];

  const [bookingId, setBookingId] = useState<string | null>(null);
  const [refNumber, setRefNumber] = useState<string | null>(null);

  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [upcomingConcerts, setUpcomingConcerts] = useState<Concert[]>([]);
  const [upcomingDetail, setUpcomingDetail] = useState<Concert | null>(null);
  const [concertFilter, setConcertFilter] = useState<"all" | "open" | "upcoming">("all");
  const [sessions, setSessions] = useState<ConcertSession[]>([]);
  const [phones, setPhones] = useState<PhoneOption[]>([]);

  const [selectedConcertId, setSelectedConcertId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);

  const [renterName, setRenterName] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [qrSaved, setQrSaved] = useState(false);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  // ── phone quantity + lens addon state ──────────────────────────────
  const [phoneQty, setPhoneQty] = useState(1);
  const [selectedLensId, setSelectedLensId] = useState<string | null>(null);
  const [lensQty, setLensQty] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pageError, setPageError] = useState<string>("");

  // ── เช็คว่าเพิ่มเพื่อน LINE OA แล้วหรือยัง (ต้องเพิ่มก่อนถึงจะรับ push แจ้งเตือนตอนอนุมัติได้) ──
  const [lineFriendStatus, setLineFriendStatus] = useState<"idle" | "checking" | "friend" | "not_friend">("idle");

  // ── จับเวลาทำรายการแยกต่อ step: step 3 ได้ 5 นาที, step 4 ได้อีก 5 นาที (แยกกัน ไม่ต่อเนื่อง) ──
  const STEP_TIME_LIMIT = 5 * 60; // 5 นาทีต่อ step
  const [timerExpiresAt, setTimerExpiresAt] = useState<number | null>(null);
  const [timerStepKey, setTimerStepKey] = useState<number | null>(null); // step ไหนที่ตัวจับเวลานี้ผูกอยู่
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const timeLeft = timerExpiresAt !== null ? Math.max(0, Math.round((timerExpiresAt - nowTick) / 1000)) : null;

  const selectedConcert = useMemo(() => concerts.find((c) => c.id === selectedConcertId) || null, [concerts, selectedConcertId]);

  const allConcertItems = useMemo<ConcertListItem[]>(() => [
    ...concerts.map((c) => ({ ...c, _status: "open" as const })),
    ...upcomingConcerts.map((c) => ({ ...c, _status: "upcoming" as const })),
  ], [concerts, upcomingConcerts]);

  const filteredConcertItems = useMemo(() => {
    if (concertFilter === "open") return allConcertItems.filter((c) => c._status === "open");
    if (concertFilter === "upcoming") return allConcertItems.filter((c) => c._status === "upcoming");
    return allConcertItems;
  }, [allConcertItems, concertFilter]);
  const selectedSession = useMemo(() => sessions.find((s) => s.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const selectedPhone   = useMemo(() => phones.find((p) => p.phone_id === selectedPhoneId) || null, [phones, selectedPhoneId]);
  const selectedLens    = useMemo(() => selectedPhone?.lens_options.find((l) => l.lens_id === selectedLensId) || null, [selectedPhone, selectedLensId]);

  const depositFee  = (selectedPhone?.deposit ?? 0) * phoneQty;
  const lensPrice   = selectedLens ? selectedLens.price * lensQty : 0;
  const totalAmount = (selectedPhone ? Number(selectedPhone.price) * phoneQty : 0) + depositFee + lensPrice;

  // ── ลูกค้าโอนแค่ค่ามัดจำตอนจอง ส่วนที่เหลือชำระตอนรับเครื่อง ──
  const transferAmount = depositFee;
  const balanceDue     = Math.max(0, totalAmount - transferAmount);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const handleSaveQr = async () => {
    try {
      const res = await fetch("/payment-qr.png");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "crabby-payment-qr.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // เบราว์เซอร์บางตัว (เช่น ในแอป LINE) อาจบล็อกการดาวน์โหลดแบบ blob — เปิดรูปให้กดค้างเพื่อบันทึกเองแทน
      window.open("/payment-qr.png", "_blank");
    }
    setQrSaved(true);
    setTimeout(() => setQrSaved(false), 2000);
  };

  const checkLineFriendStatus = async () => {
    setLineFriendStatus("checking");
    try {
      const res = await fetch("/api/bookings/line-friend-status", { cache: "no-store" });
      const out = await res.json().catch(() => null);
      if (out?.isFriend === true) setLineFriendStatus("friend");
      else if (out?.isFriend === false) setLineFriendStatus("not_friend");
      else setLineFriendStatus("idle");
    } catch {
      setLineFriendStatus("idle");
    }
  };

  // ถ้าโดนแบนกลางทาง (middleware เตะออกจาก session) ให้เคลียร์ cookie ที่เหลือ
  // แล้วพาไปหน้า login พร้อมข้อความแจ้งเตือน แทนที่จะปล่อยให้ค้างครึ่งๆ กลางๆ
  async function redirectIfBanned(status: number, out: unknown): Promise<boolean> {
    if (status !== 403) return false;
    const errCode = (out as { error?: string } | null)?.error;
    if (errCode !== "banned") return false;
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login?error=banned");
    return true;
  }

  async function safeJson(res: Response) {
    const ct  = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (ct.includes("application/json")) {
      try { return raw ? JSON.parse(raw) : null; }
      catch { throw new Error("API ส่ง JSON ไม่ถูกต้อง"); }
    }
    throw new Error(`API ไม่ได้ส่ง JSON (status ${res.status})\n` + raw.slice(0, 200));
  }

  async function loadConcerts() {
    const res = await fetch("/api/concerts", { cache: "no-store" });
    const raw = await res.text();
    if (!res.ok) {
      const parsed = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
      if (await redirectIfBanned(res.status, parsed)) return;
      throw new Error(raw || "failed to load concerts");
    }
    const out = raw ? JSON.parse(raw) : null;
    setConcerts(out?.concerts ?? []);
    setUpcomingConcerts(out?.upcoming ?? []);
  }

  async function loadSessions(concertId: string) {
    const res = await fetch(`/api/concerts/${concertId}`, { cache: "no-store" });
    const raw = await res.text();
    if (!res.ok) {
      const parsed = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
      if (await redirectIfBanned(res.status, parsed)) return;
      throw new Error(raw || "failed to load sessions");
    }
    const out = raw ? JSON.parse(raw) : null;
    setSessions(out?.sessions ?? []);
  }

  async function loadPhones(sessionId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/phones`, { cache: "no-store" });
    const raw = await res.text();
    if (!res.ok) {
      const parsed = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
      if (await redirectIfBanned(res.status, parsed)) return;
      throw new Error(raw || "failed to load phones");
    }
    const out = raw ? JSON.parse(raw) : null;
    setPhones(out?.phones ?? []);
  }

  useEffect(() => {
    const run = async () => {
      try {
        const meRes = await fetch("/api/me", { cache: "no-store" });
        const me = await meRes.json();
        if (!me.user) {
          router.push(me?.error === "banned" ? "/login?error=banned" : "/login");
          return;
        }
        setMeUser(me.user);
        if (me.user.name) setRenterName(me.user.name);
        await loadConcerts();
      } catch (e: unknown) {
        setPageError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router]);

  const resetSlip = () => {
    setSlipFile(null);
    setSlipPreview(null);
    setRefNumber(null);
  };

  const resetBelowConcert = () => {
    setSessions([]); setPhones([]);
    setSelectedSessionId(null); setSelectedPhoneId(null);
    setPhoneQty(1); setSelectedLensId(null); setLensQty(0); // ← reset qty + lens ด้วย
    setBookingId(null); resetSlip();
  };

  const resetBelowSession = () => {
    setPhones([]); setSelectedPhoneId(null);
    setPhoneQty(1); setSelectedLensId(null); setLensQty(0); // ← reset qty + lens ด้วย
    setBookingId(null); resetSlip();
  };

  // ── ตัวจับเวลาเดินตลอด ไม่ผูกกับ step เพื่อไม่ให้การสลับ step รีเซ็ต interval ──
  // Poll ทุก 250ms (ไม่ใช่ 1000ms) เผื่อ browser/webview บางตัว throttle timer
  // ให้ delay ยาวกว่าปกติ — poll ถี่ขึ้นลดโอกาสพลาดจนดูเหมือนค้าง
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNowTick(t);
      if (typeof window !== "undefined") (window as unknown as { __lastTick?: number }).__lastTick = t;
    }, 250);
    return () => clearInterval(id);
  }, []);

  // ── กันเหนียวเพิ่ม: sync เวลาให้ตรงทันทีเมื่อกลับมาที่แท็บ/หน้าต่างนี้ ──
  // (บางเบราว์เซอร์/อุปกรณ์หยุด setInterval ตอนพับหน้าจอ/สลับแอพ แล้วไม่รีบไล่ตามให้)
  useEffect(() => {
    const resync = () => setNowTick(Date.now());
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, []);

  // ── เริ่ม/ยกเลิกช่วงเวลาทำรายการ: step 3 ได้ 5 นาทีของตัวเอง, พอไป step 4 ได้ 5 นาทีใหม่แยกกัน ──
  useEffect(() => {
    setNowTick(Date.now()); // sync ทุกครั้งที่สลับ step กันเวลาค้างจากรอบก่อน
    if ((step === 3 || step === 4) && timerStepKey !== step) {
      setTimerExpiresAt(Date.now() + STEP_TIME_LIMIT * 1000);
      setTimerStepKey(step);
    }
    if (step !== 3 && step !== 4) {
      if (timerExpiresAt !== null) setTimerExpiresAt(null);
      if (timerStepKey !== null) setTimerStepKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── เช็คว่าหมดเวลาหรือยัง (ดูจาก timeLeft ที่คำนวณจาก timestamp ด้านบน) ──
  useEffect(() => {
    if (timerExpiresAt === null || timeLeft === null || (step !== 3 && step !== 4)) return;
    if (timeLeft <= 0) {
      alert("หมดเวลาทำรายการ กรุณาเริ่มทำรายการใหม่อีกครั้งครับ");
      setSelectedConcertId(null);
      resetBelowConcert();
      setAgreedTerms(false);
      setTimerExpiresAt(null);
      setTimerStepKey(null);
      setStep(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, step, timerExpiresAt]);

  // ── ถึงหน้าจองสำเร็จ (step 5) แล้วเช็คทันทีว่าเพิ่มเพื่อน LINE OA ไว้แล้วหรือยัง ──
  useEffect(() => {
    if (step === 5) {
      setLineFriendStatus("idle");
      checkLineFriendStatus();
    }
  }, [step]);

  // ── กลับมาที่แท็บนี้หลังไปเพิ่มเพื่อนใน LINE แล้ว เช็คสถานะให้อัตโนมัติ ──
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible" && step === 5) checkLineFriendStatus();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [step]);

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const isNextDisabled = () => {
    if (submitting || submitted) return true;
    if (step === 1) return !selectedConcertId;
    if (step === 2) return !selectedSessionId || !selectedPhoneId;
    if (step === 3) return !renterName.trim() || !renterPhone.trim() || renterPhone.trim().length !== 10 || !agreedTerms;
    if (step === 4) return !slipFile;
    return false;
  };

  const handleBack = () => {
    setPageError("");
    setStep((s) => Math.max(1, s - 1));
  };

  const handleNext = async () => {
    setPageError("");

    if (step === 3) {
      if (!selectedSessionId || !selectedPhoneId || !selectedPhone) {
        setPageError("กรุณาเลือก รอบ และ มือถือ");
        setStep(2);
        return;
      }
      if (!renterName.trim() || !renterPhone.trim() || renterPhone.trim().length < 9) {
        setPageError("กรุณากรอกข้อมูลผู้เช่าให้ครบ");
        return;
      }
      setStep(4);
      return;
    }

    if (step === 4) {
      if (submitted) return;
      setSubmitted(true);
      setSubmitting(true);

      try {
        if (!selectedSessionId || !selectedPhoneId) {
          setPageError("กรุณาเลือกรอบและมือถือ");
          setSubmitted(false);
          setStep(2);
          return;
        }
        if (!slipFile) {
          setPageError("กรุณาแนบสลิป");
          setSubmitted(false);
          return;
        }

        const form = new FormData();
        form.append("session_id",   selectedSessionId);
        form.append("phone_id",     selectedPhoneId);
        form.append("qty",          String(phoneQty));
        form.append("renter_name",  renterName.trim());
        form.append("renter_phone", renterPhone.trim());
        form.append("total_amount", String(totalAmount));
        if (selectedLensId && lensQty > 0) {
          form.append("lens_id",  selectedLensId);
          form.append("lens_qty", String(lensQty));
        }
        form.append("slip",         slipFile);

        const upRes = await fetch("/api/bookings/upload-slip", {
          method: "POST",
          body: form,
          cache: "no-store",
        });

        let upOut: { error?: string; booking_id?: string; ref_number?: string } | null = null;
        try {
          upOut = await safeJson(upRes);
        } catch (e: unknown) {
          setPageError(e instanceof Error ? e.message : "upload failed (not json)");
          setSubmitted(false);
          return;
        }

        if (!upRes.ok) {
          if (await redirectIfBanned(upRes.status, upOut)) return;
          if (upRes.status === 409 && upOut?.error === "sold_out") {
            alert("ขออภัย รุ่นนี้เต็มแล้ว กรุณาเลือกรุ่น/รอบใหม่");
            if (selectedSessionId) await loadPhones(selectedSessionId);
            setSelectedPhoneId(null);
            resetSlip();
            setSubmitted(false);
            setStep(2);
            return;
          }
          if (upRes.status === 409 && upOut?.error === "lens_sold_out") {
            alert("ขออภัย เลนส์ที่เลือกเหลือไม่พอแล้ว กรุณาเลือกจำนวนใหม่");
            if (selectedSessionId) await loadPhones(selectedSessionId);
            setSelectedLensId(null);
            setLensQty(0);
            resetSlip();
            setSubmitted(false);
            setStep(3);
            return;
          }
          if (upRes.status === 429) {
            setPageError("มีการจองที่รอยืนยันอยู่แล้ว กรุณารอให้แอดมินตรวจสอบก่อนจองใหม่");
            setSubmitted(false);
            return;
          }
          setPageError(upOut?.error || "upload failed");
          setSubmitted(false);
          return;
        }

        setBookingId(upOut?.booking_id ?? null);
        setRefNumber(upOut?.ref_number ?? null);
        if (selectedSessionId) await loadPhones(selectedSessionId);
        setStep(5);
      } catch (e: unknown) {
        setPageError(e instanceof Error ? e.message : "upload error");
        setSubmitted(false);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setStep((s) => Math.min(5, s + 1));
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFF9F3", fontFamily: uiFont, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <Image src="/crabby-logo.png" alt="Crabby" width={835} height={771} style={{ width: 56, height: "auto" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: sub }}>กำลังโหลด...</div>
      </div>
    );
  }

  const showBottomNav = step < 5 && !(step === 1 && !selectedConcertId);

  return (
    <div style={{ minHeight: "100vh", background: "#FFF9F3", fontFamily: uiFont, display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: showBottomNav ? 100 : 0, position: "relative", isolation: "isolate" }}>
      <AmbientGlow />
      <div style={{ width: "100%" }}>
        <Navbar user={meUser} onSignOut={handleSignOut} />
      </div>

      <div style={{ width: "100%", maxWidth: 760, flex: 1 }}>

        <AnnouncementBanner
          title="จองด่วน! รอบใหม่เปิดแล้ว 🎫"
          subtitle="คอนเสิร์ตยอดฮิตมือถือเหลือจำนวนจำกัด รีบจองก่อนเต็ม"
        />

        {/* Header */}
        <div style={{ padding: "28px 32px 16px", background: "transparent" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div style={{ fontSize: 32, fontWeight: 800 }}>
              <span style={{ color: ink }}>เช่ามือถือ</span>{" "}
              <span style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                ถ่ายคอนเสิร์ต
              </span>
            </div>
            <div style={{ fontSize: 15, color: sub, fontWeight: 500, marginTop: 4 }}>เลือกคอนเสิร์ต จองมือถือ ถ่ายให้ปัง</div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", maxWidth: 480, margin: "0 auto" }}>
            {stepLabels.map((l, i) => (
              <React.Fragment key={i}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      background: step > i + 1 ? `linear-gradient(135deg, ${accent}, ${accent2})` : glassStrong,
                      color: step > i + 1 ? "#fff" : step === i + 1 ? accentStrong : sub,
                      border: step === i + 1 ? `2px solid ${accent}` : "none",
                      boxShadow: step === i + 1 ? `0 0 0 4px ${accentSoft}, 0 0 18px -3px ${accentGlow}` : "none",
                      transition: "all .2s",
                    }}
                  >
                    {step > i + 1 ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: step === i + 1 ? accentStrong : sub, whiteSpace: "nowrap" }}>{l}</span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div style={{ flex: 1, minWidth: 24, height: 2, background: step > i + 1 ? `linear-gradient(90deg, ${accent}, ${accent2})` : line, marginBottom: 16, borderRadius: 2 }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div style={{ padding: "8px 32px" }}>
          {pageError && (
            <div style={{ ...doodle.cardYellow, padding: 12, marginBottom: 12, color: ink }}>
              <b>แจ้งเตือน:</b> {pageError}
            </div>
          )}

          {/* STEP 1 */}
          {step === 1 && (
            <div id="events" style={{ scrollMarginTop: 90 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🎫</span>
                <span style={{ fontWeight: 700, fontSize: 17, color: ink }}>เลือกคอนเสิร์ต</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {([
                    { key: "all" as const, label: "ทั้งหมด", count: allConcertItems.length },
                    { key: "open" as const, label: "เปิดจอง", count: concerts.length },
                    { key: "upcoming" as const, label: "เร็วๆ นี้", count: upcomingConcerts.length },
                  ]).map((f) => {
                    const active = concertFilter === f.key;
                    return (
                      <button
                        key={f.key}
                        onClick={() => setConcertFilter(f.key)}
                        style={{
                          display: "flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
                          borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                          background: active ? `linear-gradient(135deg, ${accent}, ${accent2})` : "#fff",
                          color: active ? "#fff" : ink,
                          boxShadow: active ? `0 8px 18px -6px ${accentGlow}` : `inset 0 0 0 1.5px ${line}`,
                          transition: "all .15s",
                        }}
                      >
                        {f.label}
                        <span style={{
                          background: active ? "rgba(255,255,255,0.3)" : accentSoft,
                          color: active ? "#fff" : accentStrong,
                          borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800, minWidth: 18, textAlign: "center",
                        }}>{f.count}</span>
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: 12, color: sub, fontWeight: 600, whiteSpace: "nowrap" }}>
                  พบ {filteredConcertItems.length} คอนเสิร์ต
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                {filteredConcertItems.map((c) => {
                  const sel = selectedConcertId === c.id;
                  const isOpen = c._status === "open";
                  const isSoldOut = isOpen && Boolean(c.sold_out);
                  const isNoSessions = isOpen && Boolean(c.no_sessions);
                  const badge = !isOpen
                    ? { label: "กำลังจะเปิด", bg: violetSoft, fg: accent2 }
                    : isNoSessions
                    ? { label: "ยังไม่มีรอบ", bg: line, fg: sub }
                    : isSoldOut
                    ? { label: "เต็มแล้ว", bg: criticalSoft, fg: critical }
                    : { label: "เปิดจองอยู่", bg: goodSoft, fg: good };
                  return (
                    <div
                      key={c.id}
                      onClick={isOpen ? async () => {
                        setSelectedConcertId(c.id);
                        resetBelowConcert();
                        try { await loadSessions(c.id); }
                        catch (e: unknown) { setPageError(e instanceof Error ? e.message : "โหลดรอบไม่สำเร็จ"); }
                      } : () => setUpcomingDetail(c)}
                      style={{ ...(sel ? doodle.cardPink : doodle.card), padding: 10, cursor: "pointer", position: "relative", transition: "all .15s", overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}
                    >
                      <div style={{ width: "100%", aspectRatio: "1/1", borderRadius: 12, border: `1px solid ${line}`, background: "#fafafa", overflow: "hidden", position: "relative", flexShrink: 0 }}>
                        {c.poster_url ? (
                          <img src={c.poster_url} alt={c.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: sub, fontSize: 12 }}>ไม่มีโปสเตอร์</div>
                        )}
                        {sel && (
                          <div style={{
                            position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%",
                            background: "#fff", border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center",
                            boxShadow: "0 2px 8px -2px rgba(36,31,28,0.35)",
                          }}>
                            <span style={{ fontSize: 13, fontWeight: 900, color: accent, lineHeight: 1 }}>✓</span>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 10, color: ink, flex: 1, display: "flex", flexDirection: "column" }}>
                        <div style={{
                          fontWeight: 800, fontSize: 13, lineHeight: 1.25, display: "-webkit-box",
                          WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>{c.title}</div>
                        {c.venue_name && (
                          <div style={{ fontSize: 11, color: sub, fontWeight: 600, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📍 {c.venue_name}</div>
                        )}
                        <div style={{ marginTop: "auto", paddingTop: 8 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: badge.bg, color: badge.fg, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: badge.fg, flexShrink: 0 }} />
                            {badge.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {filteredConcertItems.length === 0 && (
                <div style={{ ...doodle.cardYellow, padding: 16, marginTop: 10, color: ink }}>
                  {concertFilter === "open" ? "ยังไม่มีคอนเสิร์ตที่เปิดจองตอนนี้"
                    : concertFilter === "upcoming" ? "ยังไม่มีคอนเสิร์ตที่จะเปิดเร็วๆ นี้"
                    : "ยังไม่มีคอนเสิร์ตในระบบ"}
                </div>
              )}

              <HowToBookAndFaq />
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: violetSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📱</span>
                <span style={{ fontWeight: 700, fontSize: 17, color: ink }}>เลือกรอบ & มือถือ</span>
              </div>
              {selectedConcert && (
                <div style={{ ...doodle.cardYellow, padding: 14, marginBottom: 12, color: ink, display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 100, aspectRatio: "3/4", borderRadius: 14, border: `1px solid ${line}`, background: "#fafafa", overflow: "hidden", flexShrink: 0 }}>
                    {selectedConcert.poster_url ? (
                      <img src={selectedConcert.poster_url} alt={selectedConcert.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🎫</div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedConcert.title}</div>
                    {selectedConcert.venue_name && <div style={{ fontSize: 12, color: sub, fontWeight: 500, marginTop: 4 }}>📍 {selectedConcert.venue_name}</div>}
                  </div>
                </div>
              )}
              <div style={{ ...doodle.card, padding: 14, marginBottom: 12, color: ink }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>รอบการแสดง</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sessions.map((s) => {
                    const sel = selectedSessionId === s.id;
                    return (
                      <button key={s.id} onClick={async () => {
                        setSelectedSessionId(s.id);
                        resetBelowSession();
                        try { await loadPhones(s.id); }
                        catch (e: unknown) { setPageError(e instanceof Error ? e.message : "โหลดมือถือไม่สำเร็จ"); }
                      }} style={{ ...(sel ? doodle.btnPrimary : doodle.btn), padding: "10px 12px", textAlign: "left", minHeight: 44 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{s.note ?? "รอบ"} <span style={{ fontWeight: 500, opacity: 0.85 }}>• {formatThaiDateTime(s.start_at)}</span></div>
                            {s.end_at && <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>ถึง {formatThaiDateTime(s.end_at)}</div>}
                          </div>
                          <div style={{ fontWeight: 700 }}>{sel ? "✓" : ""}</div>
                        </div>
                      </button>
                    );
                  })}
                  {sessions.length === 0 && <div style={{ fontSize: 13, fontWeight: 500, color: sub }}>ยังไม่มีรอบ</div>}
                </div>
              </div>
              <div style={{ ...doodle.card, padding: 14, color: ink }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 700 }}>เลือกรุ่นมือถือ</div>
                  <button onClick={async () => {
                    if (!selectedSessionId) return;
                    try { await loadPhones(selectedSessionId); }
                    catch (e: unknown) { setPageError(e instanceof Error ? e.message : "รีเฟรชไม่สำเร็จ"); }
                  }} style={{ border: "none", background: "transparent", cursor: selectedSessionId ? "pointer" : "not-allowed", fontWeight: 700, color: accentStrong, opacity: selectedSessionId ? 1 : 0.4, padding: "10px 8px", minHeight: 44, display: "inline-flex", alignItems: "center" }} disabled={!selectedSessionId}>
                    ↻ รีเฟรช
                  </button>
                </div>
                {!selectedSessionId ? (
                  <div style={{ fontSize: 13, fontWeight: 500, color: sub }}>กรุณาเลือกรอบก่อน</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {phones.filter((p) => p.remaining > 0).map((p) => {
                      const sel = selectedPhoneId === p.phone_id;
                      return (
                        <div key={p.phone_id} style={{ ...(sel ? doodle.cardPink : doodle.card), padding: 12, transition: "all .15s" }}>
                          <div
                            onClick={() => {
                              setSelectedPhoneId(p.phone_id);
                              setPhoneQty(1);
                              setSelectedLensId(null);
                              setLensQty(0);
                              setBookingId(null);
                              resetSlip();
                            }}
                            style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
                          >
                            <div style={{ width: 52, height: 52, borderRadius: 12, border: `1px solid ${line}`, overflow: "hidden", background: "#fafafa", flexShrink: 0 }}>
                              {p.image_url ? <img src={p.image_url} alt={p.model_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: muted, fontSize: 18 }}>📱</div>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.model_name}</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: accentStrong }}>ค่าเช่า ฿{p.price}</div>
                              {p.deposit > 0 && <div style={{ fontSize: 11, fontWeight: 500, color: sub }}>มัดจำ ฿{p.deposit}</div>}
                              {p.lens_options.length > 0 && (
                                <div style={{ fontSize: 11, fontWeight: 600, color: accent2 }}>
                                  🔭 เลือกเลนส์ได้: {p.lens_options.map((l) => l.name).join(" / ")}
                                </div>
                              )}
                              <div style={{ fontSize: 11, fontWeight: 500, color: sub }}>เหลือ {p.remaining} เครื่อง</div>
                            </div>
                            <div style={{ fontSize: 16, color: accentStrong }}>{sel ? "✓" : ""}</div>
                          </div>

                          {/* จำนวนเครื่องที่ต้องการ */}
                          {sel && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${line}` }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: ink }}>จำนวนเครื่อง</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <button
                                  type="button"
                                  aria-label="ลดจำนวนเครื่อง"
                                  onClick={(e) => { e.stopPropagation(); setPhoneQty((q) => Math.max(1, q - 1)); }}
                                  style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer" }}
                                >
                                  <span aria-hidden="true" style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: `1px solid ${line}`, background: "#fff", fontWeight: 700, color: ink }}>−</span>
                                </button>
                                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: "center", color: ink }}>{phoneQty}</span>
                                <button
                                  type="button"
                                  aria-label="เพิ่มจำนวนเครื่อง"
                                  onClick={(e) => { e.stopPropagation(); setPhoneQty((q) => Math.min(p.remaining, MAX_PHONE_QTY, q + 1)); }}
                                  style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer" }}
                                >
                                  <span aria-hidden="true" style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: `1px solid ${line}`, background: "#fff", fontWeight: 700, color: ink }}>+</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {phones.length > 0 && phones.every((p) => p.remaining <= 0) && (
                      <div style={{ ...doodle.cardYellow, padding: 12 }}>รอบนี้มือถือเต็มหมดแล้ว กรุณาเลือกรอบอื่น</div>
                    )}
                    {phones.length === 0 && <div style={{ fontSize: 13, fontWeight: 500, color: sub }}>ยังไม่มีมือถือในระบบ</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, background: accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>👤</span>
                  <span style={{ fontWeight: 700, fontSize: 17, color: ink }}>ข้อมูลผู้เช่า</span>
                </div>
                {timeLeft !== null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: timeLeft <= 60 ? criticalSoft : accentSoft, borderRadius: 999, padding: "5px 12px" }}>
                    <span style={{ fontSize: 13 }}>⏱</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: timeLeft <= 60 ? critical : accentStrong }}>{formatCountdown(timeLeft)}</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: sub }}>เวลาทำรายการ</span>
                  </div>
                )}
              </div>
              <div style={{ ...doodle.card, padding: 16, marginBottom: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: ink }}>ชื่อ-นามสกุล</label>
                  <input style={{ ...doodle.input, color: ink }} type="text" placeholder="ระบุชื่อตามบัตรประชาชน" value={renterName} onChange={(e) => setRenterName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: ink }}>เบอร์โทรศัพท์</label>
                  <input style={{ ...doodle.input, color: ink }} type="tel" placeholder="08X-XXX-XXXX" maxLength={10} value={renterPhone} onChange={(e) => setRenterPhone(e.target.value)} />
                </div>
              </div>

              {/* ── Lens Option Selector ── */}
              {selectedPhone && selectedPhone.lens_options.length > 0 && (
                <div style={{ ...doodle.card, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: ink, marginBottom: 10 }}>🔭 เพิ่มเลนส์เสริม (ถ้าต้องการ)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {selectedPhone.lens_options.map((l) => {
                      const sel = selectedLensId === l.lens_id;
                      const soldOut = l.remaining <= 0;
                      return (
                        <div
                          key={l.lens_id}
                          onClick={() => {
                            if (soldOut) return;
                            if (sel) {
                              setSelectedLensId(null);
                              setLensQty(0);
                            } else {
                              setSelectedLensId(l.lens_id);
                              setLensQty(1);
                            }
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: `1px solid ${sel ? accent2 : line}`,
                            background: sel ? violetSoft : soldOut ? "#F7F6F4" : "#fff",
                            cursor: soldOut ? "not-allowed" : "pointer",
                            opacity: soldOut ? 0.55 : 1,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: ink }}>{l.name}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: accent2 }}>+฿{l.price} / ชิ้น</div>
                            <div style={{ fontSize: 10, fontWeight: 500, color: sub }}>{soldOut ? "เลนส์นี้เต็มแล้ว" : `เหลือ ${l.remaining} ชิ้น`}</div>
                          </div>
                          <div style={{ fontSize: 16, color: accent2 }}>{sel ? "✓" : ""}</div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedLens && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${line}` }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: ink }}>จำนวนเลนส์</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {(() => {
                          const maxLensQty = Math.max(1, Math.min(phoneQty, selectedLens.remaining));
                          const atMin = lensQty <= 1;
                          const atMax = lensQty >= maxLensQty;
                          return (
                            <>
                              <button
                                type="button"
                                aria-label="ลดจำนวนเลนส์"
                                disabled={atMin}
                                onClick={() => setLensQty((q) => Math.max(1, q - 1))}
                                style={{
                                  width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
                                  borderRadius: "50%", border: "none", background: "transparent",
                                  cursor: atMin ? "not-allowed" : "pointer",
                                }}
                              >
                                <span aria-hidden="true" style={{
                                  width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%",
                                  border: `1px solid ${line}`,
                                  background: atMin ? "#F5F4F2" : "#fff",
                                  fontWeight: 700,
                                  color: atMin ? muted : ink,
                                }}>−</span>
                              </button>
                              <span style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: "center", color: ink }}>{lensQty}</span>
                              <button
                                type="button"
                                aria-label="เพิ่มจำนวนเลนส์"
                                disabled={atMax}
                                onClick={() => setLensQty((q) => Math.min(maxLensQty, q + 1))}
                                style={{
                                  width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
                                  borderRadius: "50%", border: "none", background: "transparent",
                                  cursor: atMax ? "not-allowed" : "pointer",
                                }}
                              >
                                <span aria-hidden="true" style={{
                                  width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%",
                                  border: `1px solid ${line}`,
                                  background: atMax ? "#F5F4F2" : "#fff",
                                  fontWeight: 700,
                                  color: atMax ? muted : ink,
                                }}>+</span>
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 500, color: sub, marginTop: 8 }}>
                    {phoneQty <= 1
                      ? "จำกัดสูงสุด 1 ชิ้น เพราะเช่ามือถือ 1 เครื่อง (เพิ่มจำนวนเครื่องที่ step ก่อนหน้าถ้าต้องการเลนส์มากกว่านี้)"
                      : `เลือกจำนวนเลนส์ได้อิสระ ไม่จำเป็นต้องเท่ากับจำนวนมือถือ (สูงสุด ${Math.min(phoneQty, selectedLens?.remaining ?? 0)} ชิ้น)`}
                  </div>
                </div>
              )}

              <div style={{ ...doodle.cardYellow, padding: 16, color: ink }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>สรุปการจอง</div>
                {[
                  ["คอนเสิร์ต",  selectedConcert?.title || "-"],
                  ["รอบ",         selectedSession ? `${selectedSession.note ?? "รอบ"} • ${formatThaiDateTime(selectedSession.start_at)}` : "-"],
                  ["มือถือ",      selectedPhone ? `${selectedPhone.model_name} x${phoneQty}` : "-"],
                  ["ค่าเช่า",     selectedPhone ? `฿${selectedPhone.price} x ${phoneQty} = ฿${selectedPhone.price * phoneQty}` : "-"],
                  ...(selectedLens && lensQty > 0 ? [["เลนส์เสริม", `${selectedLens.name} x${lensQty} = ฿${lensPrice}`]] : []),
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 8, paddingBottom: 8, borderBottom: `1px dashed ${borderStrong}` }}>
                    <span style={{ color: sub }}>{k}</span>
                    <span style={{ color: ink }}>{v}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13, marginTop: 4, color: ink }}>
                  <span>ยอดเช่ารวมทั้งหมด</span>
                  <span>฿{totalAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${borderStrong}`, color: ink }}>
                  <span>โอนตอนนี้ (มัดจำ)</span>
                  <span style={{ color: accentStrong, fontSize: 18 }}>฿{transferAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 500, marginTop: 4, color: sub }}>
                  <span>ชำระส่วนที่เหลือตอนรับเครื่อง</span>
                  <span>฿{balanceDue}</span>
                </div>
              </div>

              {/* ── Terms Consent ── */}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: accent }}
                />
                <span style={{ fontSize: 13, fontWeight: 500, color: ink, lineHeight: 1.5 }}>
                  ข้าพเจ้าตกลงยินยอมตาม{" "}
                  <span
                    onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }}
                    style={{ color: accentStrong, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
                  >
                    ข้อตกลงและเงื่อนไข
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, background: violetSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>💳</span>
                  <span style={{ fontWeight: 700, fontSize: 17, color: ink }}>ชำระเงิน</span>
                </div>
                {timeLeft !== null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: timeLeft <= 60 ? criticalSoft : accentSoft, borderRadius: 999, padding: "5px 12px" }}>
                    <span style={{ fontSize: 13 }}>⏱</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: timeLeft <= 60 ? critical : accentStrong }}>{formatCountdown(timeLeft)}</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: sub }}>เวลาทำรายการ</span>
                  </div>
                )}
              </div>

              <div style={{ ...doodle.cardPink, padding: "20px 16px", textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: sub, marginBottom: 4 }}>ยอดที่ต้องโอนตอนนี้ (มัดจำ)</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: ink, lineHeight: 1 }}>฿{transferAmount}</div>
                <div style={{ fontSize: 12, color: sub, marginTop: 6, fontWeight: 500 }}>
                  ยังไม่ต้องจ่ายเต็มจำนวน ส่วนที่เหลือ ฿{balanceDue} ชำระตอนรับเครื่อง
                </div>
              </div>

              <div style={{ ...doodle.card, padding: "12px 16px", marginBottom: 16, color: ink }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 }}>
                  <span style={{ color: sub }}>ยอดเช่ารวมทั้งหมด</span>
                  <span>฿{totalAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginTop: 6 }}>
                  <span style={{ color: sub }}>โอนตอนนี้ (มัดจำ)</span>
                  <span style={{ color: accentStrong }}>฿{transferAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginTop: 6 }}>
                  <span style={{ color: sub }}>ชำระตอนรับเครื่อง</span>
                  <span>฿{balanceDue}</span>
                </div>
              </div>

              <div style={{ ...doodle.card, padding: "16px 16px 18px", marginBottom: 16, textAlign: "center", color: ink }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ink, marginBottom: 10 }}>📷 สแกน QR เพื่อโอนผ่านแอปธนาคาร</div>
                <img
                  src="/payment-qr.png"
                  alt="QR พร้อมเพย์สำหรับโอนเงิน"
                  style={{ width: "100%", maxWidth: 320, borderRadius: 14, border: `1px solid ${line}`, display: "block", margin: "0 auto" }}
                />
                <button
                  onClick={handleSaveQr}
                  style={{ ...doodle.btn, marginTop: 12, padding: "10px 20px", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, background: qrSaved ? goodSoft : "#fff", color: qrSaved ? good : ink }}
                >
                  {qrSaved ? "✓ บันทึกแล้ว" : "⬇️ บันทึกรูป QR"}
                </button>
              </div>

              <div style={{ ...doodle.card, overflow: "hidden", marginBottom: 16, color: ink }}>
                {[
                  { bg: "#003D6B", label: "🏦", num: "014000009934092", name: "รหัสร้านค้า (Merchant ID) · ธาราธร เสมียนรัมย์", key: "pp" },
                ].map(({ bg, label, num, name, key }, i, arr) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${line}` : "none" }}>
                    <div style={{ width: 42, height: 42, background: bg, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, textAlign: "center", lineHeight: 1.2, flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{num}</div>
                      <div style={{ fontSize: 11, color: sub, fontWeight: 500 }}>{name}</div>
                    </div>
                  </div>
                ))}
              </div>

              <label style={{ cursor: "pointer", display: "block" }}>
                <div style={{ border: `1.5px dashed ${slipPreview ? good : borderStrong}`, borderRadius: 16, padding: 20, textAlign: "center", background: slipPreview ? goodSoft : "#fff", transition: "all .2s" }}>
                  {slipPreview ? (
                    <div>
                      <img src={slipPreview} alt="slip" style={{ maxHeight: 140, borderRadius: 10, objectFit: "contain", margin: "0 auto", display: "block" }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: good }}>แนบสลิปแล้ว แตะเพื่อเปลี่ยน</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 32, marginBottom: 6 }}>📎</div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: ink, margin: 0 }}>แนบสลิปโอนเงิน</p>
                      <p style={{ fontSize: 11, color: "#B4B6BC", margin: "4px 0 0", fontWeight: 500 }}>JPG, PNG, WEBP</p>
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setSlipFile(f); setSlipPreview(URL.createObjectURL(f)); }
                }} />
              </label>
            </div>
          )}

          {/* STEP 5 */}
          {step === 5 && (
            <div style={{ textAlign: "center", paddingTop: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
              <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 4, color: ink }}>จองสำเร็จแล้ว!</div>
              <p style={{ fontSize: 15, color: sub, fontWeight: 500, marginBottom: 8, lineHeight: 1.6 }}>
                ระบบยืนยันการจองแล้ว พบกันที่คอนเสิร์ต 🎶
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, background: violetSoft, border: `2px solid ${accent2}`, borderRadius: 20, padding: "20px 24px", marginBottom: 16, boxShadow: "0 10px 26px -8px rgba(131,84,232,0.45)" }}>
                <span style={{ fontSize: 34, flexShrink: 0 }}>💌</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: accent2, lineHeight: 1.5, textAlign: "left" }}>
                  เพิ่มเพื่อน LINE OA เพื่อรับการแจ้งเตือนทันทีที่แอดมินยืนยันการจอง
                </span>
              </div>
              <div style={{ ...doodle.cardYellow, padding: 16, marginBottom: 16, textAlign: "left", color: ink }}>
                <div style={{ textAlign: "center", marginBottom: 12, paddingBottom: 12, borderBottom: `1px dashed ${borderStrong}` }}>
                  <div style={{ fontSize: 12, color: sub, fontWeight: 600 }}>หมายเลขการจอง</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: accent, letterSpacing: 2, marginTop: 4 }}>
                    {refNumber ?? bookingId ?? "-"}
                  </div>
                </div>
                {[
                  ["ชื่อ",        renterName || "-"],
                  ["คอนเสิร์ต",   selectedConcert?.title || "-"],
                  ["รอบ",          selectedSession ? `${selectedSession.note ?? "รอบ"} • ${formatThaiDateTime(selectedSession.start_at)}` : "-"],
                  ["มือถือ",       selectedPhone ? `${selectedPhone.model_name} x${phoneQty}` : "-"],
                  ...(selectedLens && lensQty > 0 ? [["Lens ซูม", `${selectedLens.name} x${lensQty} = ฿${lensPrice}`]] : []),
                  ["ยอดเช่ารวม",   `฿${totalAmount}`],
                  ["โอนแล้ว (มัดจำ)", `฿${transferAmount}`],
                  ["ชำระตอนรับเครื่อง", `฿${balanceDue}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    <span style={{ color: sub }}>{k}</span>
                    <span style={{ color: ink }}>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => router.push("/bookings")} style={{ ...doodle.btnPrimary, padding: "14px 0", fontSize: 15, width: "100%" }}>
                ไปหน้าประวัติการจอง
              </button>
              <div style={{ height: 16 }} />

              {lineFriendStatus === "friend" ? (
                <div style={{ background: goodSoft, border: `1px solid ${good}`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: good, fontWeight: 700, fontSize: 14 }}>
                  ✓ พร้อมรับการแจ้งเตือนแล้ว
                </div>
              ) : (
                <>
                  <div style={{ background: warningSoft, border: `1px dashed ${borderStrong}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>🔔</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: ink, lineHeight: 1.5 }}>
                      <b>อย่าลืมเพิ่มเพื่อน LINE OA!</b> ต้องเพิ่มเพื่อนก่อน ถึงจะได้รับการแจ้งเตือนทันทีที่แอดมินยืนยันการจองของคุณ
                    </span>
                  </div>
                  <a href="https://line.me/R/ti/p/@CRABBY4RENT" style={{ textDecoration: "none" }}>
                    <div style={{ ...doodle.btnGreen, padding: "14px 0", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%" }}>
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                        <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.114.281.072.717.035.922-.047.251-.301 1.488-.363 1.831-.107.575-.515 2.059 1.802 1.082 2.316-.976 12.433-7.311 12.433-14.035z" />
                      </svg>
                      เพิ่มเพื่อน LINE OA
                    </div>
                  </a>
                  <button
                    onClick={checkLineFriendStatus}
                    disabled={lineFriendStatus === "checking"}
                    style={{ marginTop: 10, width: "100%", border: "none", background: "transparent", cursor: lineFriendStatus === "checking" ? "default" : "pointer", fontSize: 13, fontWeight: 700, color: accent2, padding: "8px 0", fontFamily: uiFont }}
                  >
                    {lineFriendStatus === "checking"
                      ? "กำลังตรวจสอบ..."
                      : lineFriendStatus === "not_friend"
                        ? "ยังไม่พบว่าเพิ่มเพื่อนแล้ว · ตรวจสอบอีกครั้ง"
                        : "เพิ่มเพื่อนแล้ว? ตรวจสอบอีกครั้ง"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Bottom Nav */}
        {showBottomNav && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, display: "flex", justifyContent: "center", padding: "16px 32px calc(24px + env(safe-area-inset-bottom, 0px))", background: glassStrong, backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)", borderTop: `1px solid ${glassBorder}` }}>
            <div style={{ width: "100%", maxWidth: 760, display: "flex", gap: 12 }}>
              {step > 1 && (
                <button onClick={handleBack} style={{ ...doodle.btn, flex: "0 0 90px", padding: "13px 0", background: "#fff", color: ink, fontSize: 14 }}>
                  ← กลับ
                </button>
              )}
              <button onClick={handleNext} disabled={isNextDisabled()} style={{ ...(isNextDisabled() ? doodle.btnGray : step === 4 ? doodle.btnGreen : doodle.btnPrimary), flex: 1, padding: "13px 0", fontSize: 15 }}>
                {step === 4 ? (submitting ? "กำลังบันทึก..." : "✓ ฉันโอนแล้ว!") : "ต่อไป →"}
              </button>
            </div>
          </div>
        )}
      </div>

      {step === 1 && !selectedConcertId && (
        <div style={{ width: "100%" }}>
          <Footer />
        </div>
      )}

      {/* Upcoming Concert Detail Modal */}
      {upcomingDetail && (
        <div
          onClick={() => setUpcomingDetail(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(36,31,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, border: `1px solid ${line}`, maxWidth: 420, width: "100%", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: ink }}>รายละเอียดคอนเสิร์ต</span>
              <button onClick={() => setUpcomingDetail(null)} aria-label="ปิดหน้าต่างรายละเอียด" style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ padding: "16px 18px", overflowY: "auto" }}>
              <div style={{ width: "100%", aspectRatio: "1/1", borderRadius: 14, border: `1px solid ${line}`, background: "#fafafa", overflow: "hidden", marginBottom: 14 }}>
                {upcomingDetail.poster_url ? (
                  <img src={upcomingDetail.poster_url} alt={upcomingDetail.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: sub, fontSize: 13 }}>ไม่มีโปสเตอร์</div>
                )}
              </div>
              <div style={{ fontWeight: 800, fontSize: 17, color: ink, marginBottom: 4 }}>{upcomingDetail.title}</div>
              {upcomingDetail.venue_name && (
                <div style={{ fontSize: 13, color: sub, fontWeight: 600, marginBottom: 10 }}>📍 {upcomingDetail.venue_name}</div>
              )}
              {upcomingDetail.description && (
                <p style={{ fontSize: 13, color: ink, lineHeight: 1.7, fontWeight: 500, marginBottom: 14 }}>{upcomingDetail.description}</p>
              )}
              {upcomingDetail.publish_at && (
                <div style={{ background: violetSoft, borderRadius: 14, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: sub, fontWeight: 600, marginBottom: 2 }}>จะเปิดให้จองวันที่</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: accent2 }}>{formatThaiDateTime(upcomingDetail.publish_at)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Terms & Conditions Modal */}
      {showTermsModal && (
        <div
          onClick={() => setShowTermsModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(36,31,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, border: `1px solid ${line}`, maxWidth: 420, width: "100%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: ink }}>ข้อตกลงและเงื่อนไข</span>
              <button onClick={() => setShowTermsModal(false)} aria-label="ปิดหน้าต่างข้อตกลง" style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ padding: "16px 18px", overflowY: "auto", fontSize: 13, color: ink, lineHeight: 1.8, fontWeight: 500 }}>
              <p>1. ผู้เช่าต้องแสดงบัตรประชาชนตัวจริงเพื่อยืนยันตัวตนก่อนรับเครื่อง</p>
              <p>2. มัดจำที่โอนมาจะคืนให้เมื่อส่งคืนเครื่องในสภาพปกติ ไม่มีความเสียหาย</p>
              <p>3. หากทำเครื่องเสียหายหรือสูญหาย ผู้เช่าต้องรับผิดชอบค่าซ่อม/ค่าเครื่องตามราคาประเมิน</p>
              <p>4. กรุณามารับและคืนเครื่องตรงตามวัน-เวลาที่ระบุไว้ในรอบที่จอง</p>
              <p>5. การจองจะสมบูรณ์เมื่อโอนมัดจำและแนบสลิปเรียบร้อยแล้วเท่านั้น</p>
              <p style={{ color: sub, fontSize: 12, marginTop: 12 }}>* รายละเอียดนี้เป็นตัวอย่างเบื้องต้น ผู้ให้บริการสามารถแก้ไขข้อความให้ตรงกับเงื่อนไขจริงได้</p>
            </div>
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${line}`, flexShrink: 0 }}>
              <button
                onClick={() => { setAgreedTerms(true); setShowTermsModal(false); }}
                style={{ ...doodle.btnPrimary, width: "100%", padding: "12px 0", fontSize: 14 }}
              >
                รับทราบและยินยอม
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}