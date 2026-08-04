"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "./Navbar";
import AnnouncementBanner from "./AnnouncementBanner";
import HowToBookAndFaq from "./HowToBookAndFaq";

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
};

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

// ── Clean, minimal design tokens ──────────────────────────────
const ink = "#332E2C";
const sub = "#A39A93";
const accent = "#F2679E";
const accent2 = "#7A57D1";
const accentSoft = "#FDF0F5";
const line = "#F0E9E2";

const doodle = {
  card: {
    borderRadius: "16px",
    border: `1px solid ${line}`,
    boxShadow: "0 1px 2px rgba(20,20,20,0.04)",
    background: "#fff",
  } as React.CSSProperties,
  cardPink: {
    borderRadius: "16px",
    border: `1px solid ${accent}`,
    boxShadow: `0 0 0 3px ${accentSoft}`,
    background: "#fff",
  } as React.CSSProperties,
  cardYellow: {
    borderRadius: "16px",
    border: "1px solid #F3E3B8",
    boxShadow: "none",
    background: "#FFFBEF",
  } as React.CSSProperties,
  btn: {
    borderRadius: "999px",
    border: `1px solid ${line}`,
    boxShadow: "none",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all .15s",
  } as React.CSSProperties,
  btnPrimary: {
    borderRadius: "999px",
    border: "none",
    boxShadow: "0 4px 14px rgba(232,85,143,0.3)",
    fontWeight: 700,
    cursor: "pointer",
    background: `linear-gradient(135deg, ${accent}, #E1477F)`,
    color: "#fff",
  } as React.CSSProperties,
  btnGreen: {
    borderRadius: "999px",
    border: "none",
    boxShadow: "0 4px 14px rgba(6,199,85,0.25)",
    fontWeight: 700,
    cursor: "pointer",
    background: "#06C755",
    color: "#fff",
  } as React.CSSProperties,
  btnGray: {
    borderRadius: "999px",
    border: "none",
    boxShadow: "none",
    fontWeight: 700,
    cursor: "not-allowed",
    background: "#F1F0EE",
    color: "#B4B6BC",
  } as React.CSSProperties,
  input: {
    borderRadius: "12px",
    border: `1px solid ${line}`,
    padding: "10px 14px",
    fontSize: 14,
    outline: "none",
    width: "100%",
    background: "#fff",
    fontFamily: "inherit",
    boxSizing: "border-box",
  } as React.CSSProperties,
};

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
  const [sessions, setSessions] = useState<ConcertSession[]>([]);
  const [phones, setPhones] = useState<PhoneOption[]>([]);

  const [selectedConcertId, setSelectedConcertId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);

  const [renterName, setRenterName] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  // ── phone quantity + lens addon state ──────────────────────────────
  const [phoneQty, setPhoneQty] = useState(1);
  const [selectedLensId, setSelectedLensId] = useState<string | null>(null);
  const [lensQty, setLensQty] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pageError, setPageError] = useState<string>("");

  // ── จับเวลาทำรายการ (step 3 เป็นต้นไป) + ยินยอมข้อตกลง ──
  const STEP3_TIME_LIMIT = 15 * 60; // 15 นาที
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const selectedConcert = useMemo(() => concerts.find((c) => c.id === selectedConcertId) || null, [concerts, selectedConcertId]);
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

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

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
    if (!res.ok) throw new Error(raw || "failed to load concerts");
    const out = raw ? JSON.parse(raw) : null;
    setConcerts(out?.concerts ?? []);
  }

  async function loadSessions(concertId: string) {
    const res = await fetch(`/api/concerts/${concertId}`, { cache: "no-store" });
    const raw = await res.text();
    if (!res.ok) throw new Error(raw || "failed to load sessions");
    const out = raw ? JSON.parse(raw) : null;
    setSessions(out?.sessions ?? []);
  }

  async function loadPhones(sessionId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/phones`, { cache: "no-store" });
    const raw = await res.text();
    if (!res.ok) throw new Error(raw || "failed to load phones");
    const out = raw ? JSON.parse(raw) : null;
    setPhones(out?.phones ?? []);
  }

  useEffect(() => {
    const run = async () => {
      try {
        const meRes = await fetch("/api/me", { cache: "no-store" });
        const me = await meRes.json();
        if (!me.user) { router.push("/login"); return; }
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

  // ── เริ่มจับเวลาทำรายการตอนเข้า step 3 (ยกเลิกถ้าถอยกลับไปก่อน step 3) ──
  useEffect(() => {
    if (step === 3 && timeLeft === null) {
      setTimeLeft(STEP3_TIME_LIMIT);
    }
    if (step < 3 && timeLeft !== null) {
      setTimeLeft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── นับถอยหลังทุกวินาที ระหว่าง step 3-4 ──
  useEffect(() => {
    if (timeLeft === null || step < 3 || step >= 5) return;
    if (timeLeft <= 0) {
      alert("หมดเวลาทำรายการ กรุณาเริ่มทำรายการใหม่อีกครั้งครับ");
      setSelectedConcertId(null);
      resetBelowConcert();
      setAgreedTerms(false);
      setTimeLeft(null);
      setStep(1);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, step]);

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
      <div style={{ minHeight: "100vh", background: "#FFFBF7", fontFamily: "var(--font-itim), 'Kanit', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <img src="/crabby-logo.png" alt="Crabby" style={{ width: 56, height: "auto" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: sub }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFFBF7", fontFamily: "var(--font-itim), 'Kanit', 'Segoe UI', sans-serif", display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 100 }}>
      <div style={{ width: "100%" }}>
        <Navbar user={meUser} onSignOut={handleSignOut} />
      </div>

      <div style={{ width: "100%", maxWidth: 760 }}>

        <AnnouncementBanner
          title="จองด่วน! รอบใหม่เปิดแล้ว 🎫"
          subtitle="คอนเสิร์ตยอดฮิตมือถือเหลือจำนวนจำกัด รีบจองก่อนเต็ม"
        />

        {/* Header */}
        <div style={{ padding: "28px 32px 16px", background: "#FFFBF7" }}>
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
                      background: step > i + 1 ? `linear-gradient(135deg, ${accent}, ${accent2})` : step === i + 1 ? "#fff" : "#F1F0EE",
                      color: step > i + 1 ? "#fff" : step === i + 1 ? accent : "#B4B6BC",
                      border: step === i + 1 ? `2px solid ${accent}` : "none",
                      transition: "all .2s",
                    }}
                  >
                    {step > i + 1 ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: step === i + 1 ? accent : "#B4B6BC", whiteSpace: "nowrap" }}>{l}</span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div style={{ flex: 1, minWidth: 24, height: 2, background: step > i + 1 ? accent : "#EDEBE8", marginBottom: 16, borderRadius: 2 }} />
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                {concerts.map((c) => {
                  const sel = selectedConcertId === c.id;
                  return (
                    <div key={c.id} onClick={async () => {
                      setSelectedConcertId(c.id);
                      resetBelowConcert();
                      try { await loadSessions(c.id); }
                      catch (e: unknown) { setPageError(e instanceof Error ? e.message : "โหลดรอบไม่สำเร็จ"); }
                    }} style={{ ...(sel ? doodle.cardPink : doodle.card), padding: 10, cursor: "pointer", position: "relative", transition: "all .15s", overflow: "hidden" }}>
                      <div style={{ width: "100%", aspectRatio: "1/1", borderRadius: 12, border: `1px solid ${line}`, background: "#fafafa", overflow: "hidden" }}>
                        {c.poster_url ? (
                          <img src={c.poster_url} alt={c.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: sub, fontSize: 12 }}>ไม่มีโปสเตอร์</div>
                        )}
                      </div>
                      <div style={{ marginTop: 8, color: ink }}>
                        <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.2 }}>{c.title}</div>
                        <div style={{ fontSize: 11, color: sub, fontWeight: 500 }}>{c.venue_name ? `📍 ${c.venue_name}` : ""}</div>
                      </div>
                      {sel && (
                        <div style={{ position: "absolute", top: 10, right: 10, background: accent, color: "#fff", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>✓ เลือกแล้ว</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {concerts.length === 0 && (
                <div style={{ ...doodle.cardYellow, padding: 16, marginTop: 10, color: ink }}>ยังไม่มีคอนเสิร์ตในระบบ</div>
              )}
              <HowToBookAndFaq />
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: "#F1EDFC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📱</span>
                <span style={{ fontWeight: 700, fontSize: 17, color: ink }}>เลือกรอบ & มือถือ</span>
              </div>
              {selectedConcert && (
                <div style={{ ...doodle.cardYellow, padding: 12, marginBottom: 12, color: ink }}>
                  <div style={{ fontWeight: 700 }}>{selectedConcert.title}</div>
                  {selectedConcert.venue_name && <div style={{ fontSize: 12, color: sub, fontWeight: 500 }}>📍 {selectedConcert.venue_name}</div>}
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
                      }} style={{ ...(sel ? doodle.btnPrimary : doodle.btn), padding: "10px 12px", textAlign: "left" }}>
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
                  }} style={{ border: "none", background: "transparent", cursor: selectedSessionId ? "pointer" : "not-allowed", fontWeight: 700, color: accent, opacity: selectedSessionId ? 1 : 0.4 }} disabled={!selectedSessionId}>
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
                              {p.image_url ? <img src={p.image_url} alt={p.model_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#C7C9CE", fontSize: 18 }}>📱</div>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.model_name}</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: accent }}>ค่าเช่า ฿{p.price}</div>
                              {p.deposit > 0 && <div style={{ fontSize: 11, fontWeight: 500, color: sub }}>มัดจำ ฿{p.deposit}</div>}
                              {p.lens_options.length > 0 && (
                                <div style={{ fontSize: 11, fontWeight: 600, color: "#6D5EF0" }}>
                                  🔭 เลือกเลนส์ได้: {p.lens_options.map((l) => l.name).join(" / ")}
                                </div>
                              )}
                              <div style={{ fontSize: 11, fontWeight: 500, color: "#6E7178" }}>เหลือ {p.remaining} เครื่อง</div>
                            </div>
                            <div style={{ fontSize: 16, color: accent }}>{sel ? "✓" : ""}</div>
                          </div>

                          {/* จำนวนเครื่องที่ต้องการ */}
                          {sel && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${line}` }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: ink }}>จำนวนเครื่อง</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPhoneQty((q) => Math.max(1, q - 1)); }}
                                  style={{ width: 26, height: 26, borderRadius: "50%", border: `1px solid ${line}`, background: "#fff", fontWeight: 700, cursor: "pointer", color: ink }}
                                >
                                  −
                                </button>
                                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: "center", color: ink }}>{phoneQty}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPhoneQty((q) => Math.min(p.remaining, q + 1)); }}
                                  style={{ width: 26, height: 26, borderRadius: "50%", border: `1px solid ${line}`, background: "#fff", fontWeight: 700, cursor: "pointer", color: ink }}
                                >
                                  +
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: timeLeft <= 60 ? "#FFF1F2" : accentSoft, borderRadius: 999, padding: "5px 12px" }}>
                    <span style={{ fontSize: 13 }}>⏱</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: timeLeft <= 60 ? "#C43D5C" : accent }}>{formatCountdown(timeLeft)}</span>
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
                            border: `1px solid ${sel ? accent : line}`,
                            background: sel ? accentSoft : soldOut ? "#F7F6F4" : "#fff",
                            cursor: soldOut ? "not-allowed" : "pointer",
                            opacity: soldOut ? 0.55 : 1,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: ink }}>{l.name}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#6D5EF0" }}>+฿{l.price} / ชิ้น</div>
                            <div style={{ fontSize: 10, fontWeight: 500, color: sub }}>{soldOut ? "เลนส์นี้เต็มแล้ว" : `เหลือ ${l.remaining} ชิ้น`}</div>
                          </div>
                          <div style={{ fontSize: 16, color: accent }}>{sel ? "✓" : ""}</div>
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
                                disabled={atMin}
                                onClick={() => setLensQty((q) => Math.max(1, q - 1))}
                                style={{
                                  width: 26, height: 26, borderRadius: "50%",
                                  border: `1px solid ${line}`,
                                  background: atMin ? "#F5F4F2" : "#fff",
                                  fontWeight: 700,
                                  cursor: atMin ? "not-allowed" : "pointer",
                                  color: atMin ? "#C7C4BE" : ink,
                                }}
                              >
                                −
                              </button>
                              <span style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: "center", color: ink }}>{lensQty}</span>
                              <button
                                disabled={atMax}
                                onClick={() => setLensQty((q) => Math.min(maxLensQty, q + 1))}
                                style={{
                                  width: 26, height: 26, borderRadius: "50%",
                                  border: `1px solid ${line}`,
                                  background: atMax ? "#F5F4F2" : "#fff",
                                  fontWeight: 700,
                                  cursor: atMax ? "not-allowed" : "pointer",
                                  color: atMax ? "#C7C4BE" : ink,
                                }}
                              >
                                +
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
                <div style={{ fontWeight: 700, fontSize: 12, color: "#8A6D2F", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>สรุปการจอง</div>
                {[
                  ["คอนเสิร์ต",  selectedConcert?.title || "-"],
                  ["รอบ",         selectedSession ? `${selectedSession.note ?? "รอบ"} • ${formatThaiDateTime(selectedSession.start_at)}` : "-"],
                  ["มือถือ",      selectedPhone ? `${selectedPhone.model_name} x${phoneQty}` : "-"],
                  ["ค่าเช่า",     selectedPhone ? `฿${selectedPhone.price} x ${phoneQty} = ฿${selectedPhone.price * phoneQty}` : "-"],
                  ...(selectedLens && lensQty > 0 ? [["เลนส์เสริม", `${selectedLens.name} x${lensQty} = ฿${lensPrice}`]] : []),
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 8, paddingBottom: 8, borderBottom: "1px dashed #E5D9AF" }}>
                    <span style={{ color: "#8A6D2F" }}>{k}</span>
                    <span style={{ color: ink }}>{v}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13, marginTop: 4, color: ink }}>
                  <span>ยอดเช่ารวมทั้งหมด</span>
                  <span>฿{totalAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E5D9AF", color: ink }}>
                  <span>โอนตอนนี้ (มัดจำ)</span>
                  <span style={{ color: accent, fontSize: 18 }}>฿{transferAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 500, marginTop: 4, color: "#8A6D2F" }}>
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
                    style={{ color: accent, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: "#F1EDFC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>💳</span>
                <span style={{ fontWeight: 700, fontSize: 17, color: ink }}>ชำระเงิน</span>
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
                  <span style={{ color: accent }}>฿{transferAmount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginTop: 6 }}>
                  <span style={{ color: sub }}>ชำระตอนรับเครื่อง</span>
                  <span>฿{balanceDue}</span>
                </div>
              </div>

              <div style={{ ...doodle.card, overflow: "hidden", marginBottom: 16, color: ink }}>
                {[
                  { bg: "#003D6B", label: "พร้อมเพย์", num: "081-234-5678", name: "บจก. คอนเสิร์ต เรนทัล", val: "0812345678", key: "pp" },
                  { bg: "#138F2D", label: "KBank",     num: "123-4-56789-0", name: "บจก. คอนเสิร์ต เรนทัล", val: "1234567890", key: "bk" },
                ].map(({ bg, label, num, name, val, key }, i) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i === 0 ? `1px solid ${line}` : "none" }}>
                    <div style={{ width: 42, height: 42, background: bg, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, textAlign: "center", lineHeight: 1.2, flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{num}</div>
                      <div style={{ fontSize: 11, color: sub, fontWeight: 500 }}>{name}</div>
                    </div>
                    <button onClick={() => handleCopy(val, key)} style={{ ...doodle.btn, padding: "6px 12px", fontSize: 11, background: copiedType === key ? "#E9F9EE" : "#fff", color: copiedType === key ? "#0F9D4E" : ink, flexShrink: 0 }}>
                      {copiedType === key ? "✓ แล้ว!" : "คัดลอก"}
                    </button>
                  </div>
                ))}
              </div>

              <label style={{ cursor: "pointer", display: "block" }}>
                <div style={{ border: `1.5px dashed ${slipPreview ? "#8FD4A8" : "#D8D5CE"}`, borderRadius: 16, padding: 20, textAlign: "center", background: slipPreview ? "#F3FBF5" : "#fff", transition: "all .2s" }}>
                  {slipPreview ? (
                    <div>
                      <img src={slipPreview} alt="slip" style={{ maxHeight: 140, borderRadius: 10, objectFit: "contain", margin: "0 auto", display: "block" }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#0F9D4E" }}>แนบสลิปแล้ว แตะเพื่อเปลี่ยน</p>
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
              <p style={{ fontSize: 15, color: sub, fontWeight: 500, marginBottom: 16, lineHeight: 1.6 }}>
                ระบบยืนยันการจองแล้ว พบกันที่คอนเสิร์ต 🎶
              </p>
              <div style={{ ...doodle.cardYellow, padding: 16, marginBottom: 16, textAlign: "left", color: ink }}>
                <div style={{ textAlign: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed #E5D9AF" }}>
                  <div style={{ fontSize: 12, color: "#8A6D2F", fontWeight: 600 }}>หมายเลขการจอง</div>
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
                    <span style={{ color: "#8A6D2F" }}>{k}</span>
                    <span style={{ color: ink }}>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => router.push("/bookings")} style={{ ...doodle.btnPrimary, padding: "14px 0", fontSize: 15, width: "100%" }}>
                ไปหน้าประวัติการจอง
              </button>
              <div style={{ height: 12 }} />
              <a href="https://line.me/R/ti/p/@your_oa_id" style={{ textDecoration: "none" }}>
                <div style={{ ...doodle.btnGreen, padding: "14px 0", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%" }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                    <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.114.281.072.717.035.922-.047.251-.301 1.488-.363 1.831-.107.575-.515 2.059 1.802 1.082 2.316-.976 12.433-7.311 12.433-14.035z" />
                  </svg>
                  เพิ่มเพื่อน LINE OA
                </div>
              </a>
            </div>
          )}
        </div>

        {/* Bottom Nav */}
        {step < 5 && !(step === 1 && !selectedConcertId) && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", padding: "16px 32px 24px", background: "linear-gradient(to top, #FFFBF7 65%, transparent)" }}>
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

      {/* Terms & Conditions Modal */}
      {showTermsModal && (
        <div
          onClick={() => setShowTermsModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(51,46,44,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, border: `1px solid ${line}`, maxWidth: 420, width: "100%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${line}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: ink }}>ข้อตกลงและเงื่อนไข</span>
              <button onClick={() => setShowTermsModal(false)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: sub }}>✕</button>
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