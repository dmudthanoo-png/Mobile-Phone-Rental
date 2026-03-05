"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

type PhoneOption = {
  phone_id: string;
  model_name: string;
  image_url?: string | null;
  price: number;
  deposit: number;
  remaining: number;
};

const doodle = {
  card: {
    borderRadius: "18px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "4px 4px 0px #1a1a1a",
    background: "#fff",
  } as React.CSSProperties,
  cardPink: {
    borderRadius: "18px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "4px 4px 0px #1a1a1a",
    background: "#FFE8F0",
  } as React.CSSProperties,
  cardYellow: {
    borderRadius: "18px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "4px 4px 0px #1a1a1a",
    background: "#FFF9E6",
  } as React.CSSProperties,
  btn: {
    borderRadius: "50px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "3px 3px 0px #1a1a1a",
    fontWeight: 800,
    cursor: "pointer",
    transition: "all .1s",
  } as React.CSSProperties,
  btnPrimary: {
    borderRadius: "50px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "3px 3px 0px #1a1a1a",
    fontWeight: 800,
    cursor: "pointer",
    background: "#FF85B3",
    color: "#1a1a1a",
  } as React.CSSProperties,
  btnGreen: {
    borderRadius: "50px",
    border: "2.5px solid #1a1a1a",
    boxShadow: "3px 3px 0px #1a1a1a",
    fontWeight: 800,
    cursor: "pointer",
    background: "#5FD16A",
    color: "#fff",
  } as React.CSSProperties,
  btnGray: {
    borderRadius: "50px",
    border: "2.5px solid #ccc",
    boxShadow: "3px 3px 0px #ccc",
    fontWeight: 800,
    cursor: "not-allowed",
    background: "#eee",
    color: "#aaa",
  } as React.CSSProperties,
  input: {
    borderRadius: "14px",
    border: "2.5px solid #1a1a1a",
    padding: "10px 14px",
    fontSize: 14,
    outline: "none",
    width: "100%",
    background: "#FFFDF5",
    fontFamily: "inherit",
    boxSizing: "border-box",
  } as React.CSSProperties,
};

function WiggleLine() {
  return (
    <svg width="100%" height="8" viewBox="0 0 300 8" preserveAspectRatio="none" style={{ display: "block", margin: "4px 0" }}>
      <path
        d="M0,4 Q15,0 30,4 Q45,8 60,4 Q75,0 90,4 Q105,8 120,4 Q135,0 150,4 Q165,8 180,4 Q195,0 210,4 Q225,8 240,4 Q255,0 270,4 Q285,8 300,4"
        fill="none" stroke="#FFB3D1" strokeWidth="2.5"
      />
    </svg>
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

  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState<string>("");

  const selectedConcert = useMemo(() => concerts.find((c) => c.id === selectedConcertId) || null, [concerts, selectedConcertId]);
  const selectedSession = useMemo(() => sessions.find((s) => s.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const selectedPhone = useMemo(() => phones.find((p) => p.phone_id === selectedPhoneId) || null, [phones, selectedPhoneId]);

  // ✅ ใช้ deposit จากรุ่นมือถือ ไม่ใช่ fixed
  const depositFee = selectedPhone?.deposit ?? 0;
  const totalAmount = (selectedPhone ? Number(selectedPhone.price) : 0) + depositFee;

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
    const ct = res.headers.get("content-type") || "";
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
      } catch (e: any) {
        setPageError(e?.message || "โหลดข้อมูลไม่สำเร็จ");
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
    setBookingId(null); resetSlip();
  };

  const resetBelowSession = () => {
    setPhones([]); setSelectedPhoneId(null);
    setBookingId(null); resetSlip();
  };

  const isNextDisabled = () => {
    if (submitting) return true;
    if (step === 1) return !selectedConcertId;
    if (step === 2) return !selectedSessionId || !selectedPhoneId;
    if (step === 3) return !renterName.trim() || !renterPhone.trim() || renterPhone.trim().length !== 10;
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
      setSubmitting(true);
      try {
        if (!selectedSessionId || !selectedPhoneId) {
          setPageError("กรุณาเลือกรอบและมือถือ");
          setStep(2);
          return;
        }
        if (!slipFile) {
          setPageError("กรุณาแนบสลิป");
          return;
        }

        const form = new FormData();
        form.append("session_id", selectedSessionId);
        form.append("phone_id", selectedPhoneId);
        form.append("renter_name", renterName.trim());
        form.append("renter_phone", renterPhone.trim());
        form.append("total_amount", String(totalAmount));
        form.append("slip", slipFile);

        const upRes = await fetch("/api/bookings/upload-slip", {
          method: "POST",
          body: form,
          cache: "no-store",
        });

        let upOut: any = null;
        try {
          upOut = await safeJson(upRes);
        } catch (e: any) {
          setPageError(e?.message || "upload failed (not json)");
          return;
        }

        if (!upRes.ok) {
          if (upRes.status === 409 && upOut?.error === "sold_out") {
            alert("ขออภัย รุ่นนี้เต็มแล้ว กรุณาเลือกรุ่น/รอบใหม่");
            if (selectedSessionId) await loadPhones(selectedSessionId);
            setSelectedPhoneId(null);
            resetSlip();
            setStep(2);
            return;
          }
          setPageError(upOut?.error || "upload failed");
          return;
        }

        setBookingId(upOut.booking_id as string);
        setRefNumber((upOut.ref_number as string) ?? null);
        if (selectedSessionId) await loadPhones(selectedSessionId);
        setStep(5);
      } catch (e: any) {
        setPageError(e?.message || "upload error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setStep((s) => Math.min(5, s + 1));
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFF5F9", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 48 }}>📱</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#888" }}>กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFF5F9", fontFamily: "'Mitr', 'Kanit', 'Segoe UI', sans-serif", display: "flex", justifyContent: "center", paddingBottom: 100 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Header */}
        <div style={{ padding: "24px 20px 12px", position: "sticky", top: 0, background: "#FFF5F9", zIndex: 10 }}>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#1a1a1a" }}>ระบบเช่ามือถือ</div>
            <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>ถ่ายคอนเสิร์ตให้ปัง! ✨</div>
          </div>

          {meUser && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFE8F0", border: "2px solid #1a1a1a", borderRadius: 50, padding: "5px 14px 5px 5px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {meUser.picture ? (
                  <img src={meUser.picture} alt="profile" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid #1a1a1a", objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#FF85B3", border: "2px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#fff", flexShrink: 0 }}>
                    {((meUser.name ?? "U")[0] ?? "U").toUpperCase()}
                  </div>
                )}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{meUser.name ?? "ผู้ใช้"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => router.push("/bookings")} style={{ fontSize: 13, fontWeight: 700, color: "#FF85B3", background: "transparent", border: "none", cursor: "pointer" }}>
                  📋 ประวัติ
                </button>
                <span style={{ color: "#ddd", fontSize: 12 }}>|</span>
                <button onClick={handleSignOut} style={{ fontSize: 12, fontWeight: 700, color: "#000000", background: "transparent", border: "none", cursor: "pointer" }}>
                  ออกจากระบบ
                </button>
              </div>
            </div>
          )}

          <WiggleLine />

          <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "center", marginTop: 8 }}>
            {stepLabels.map((l, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: step === i + 1 ? 32 : 10, height: 10, borderRadius: 10, background: step > i ? "#FF85B3" : "#E0E0E0", border: "2px solid #1a1a1a", transition: "all .3s" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: step === i + 1 ? "#FF85B3" : "#bbb" }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "8px 20px" }}>
          {pageError && (
            <div style={{ ...doodle.cardYellow, padding: 12, marginBottom: 12, color: "#1a1a1a" }}>
              <b>แจ้งเตือน:</b> {pageError}
            </div>
          )}

          {/* STEP 1 */}
          {step === 1 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontWeight: 900, fontSize: 18, color: "#1a1a1a" }}>เลือกคอนเสิร์ต</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {concerts.map((c) => {
                  const sel = selectedConcertId === c.id;
                  return (
                    <div key={c.id} onClick={async () => {
                      setSelectedConcertId(c.id);
                      resetBelowConcert();
                      try { await loadSessions(c.id); }
                      catch (e: any) { setPageError(e?.message || "โหลดรอบไม่สำเร็จ"); }
                    }} style={{ ...(sel ? doodle.cardPink : doodle.card), padding: 10, cursor: "pointer", position: "relative", transform: sel ? "translate(-2px,-2px)" : "", boxShadow: sel ? "6px 6px 0px #1a1a1a" : "4px 4px 0px #1a1a1a", transition: "all .15s", overflow: "hidden" }}>
                      <div style={{ width: "100%", aspectRatio: "1/1", borderRadius: 14, border: "2px solid #1a1a1a", background: "#fff", overflow: "hidden" }}>
                        {c.poster_url ? (
                          <img src={c.poster_url} alt={c.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#888" }}>ไม่มีโปสเตอร์</div>
                        )}
                      </div>
                      <div style={{ marginTop: 8, color: "#1a1a1a" }}>
                        <div style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.2 }}>{c.title}</div>
                        <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{c.venue_name ? `📍 ${c.venue_name}` : ""}</div>
                      </div>
                      {sel && (
                        <div style={{ position: "absolute", top: 10, right: 10, background: "#FFD600", border: "2px solid #1a1a1a", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 900 }}>✓ เลือกแล้ว</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {concerts.length === 0 && (
                <div style={{ ...doodle.cardYellow, padding: 16, marginTop: 10, color: "#1a1a1a" }}>ยังไม่มีคอนเสิร์ตในระบบ</div>
              )}
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>🎟️</span>
                <span style={{ fontWeight: 900, fontSize: 18, color: "#1a1a1a" }}>เลือกรอบ & มือถือ</span>
              </div>
              {selectedConcert && (
                <div style={{ ...doodle.cardYellow, padding: 12, marginBottom: 12, color: "#1a1a1a" }}>
                  <div style={{ fontWeight: 900 }}>{selectedConcert.title}</div>
                  {selectedConcert.venue_name && <div style={{ fontSize: 12, color: "#555", fontWeight: 700 }}>📍 {selectedConcert.venue_name}</div>}
                </div>
              )}
              <div style={{ ...doodle.card, padding: 14, marginBottom: 12, color: "#1a1a1a" }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>รอบการแสดง</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sessions.map((s) => {
                    const sel = selectedSessionId === s.id;
                    return (
                      <button key={s.id} onClick={async () => {
                        setSelectedSessionId(s.id);
                        resetBelowSession();
                        try { await loadPhones(s.id); }
                        catch (e: any) { setPageError(e?.message || "โหลดมือถือไม่สำเร็จ"); }
                      }} style={{ ...(sel ? doodle.btnPrimary : doodle.btn), padding: "10px 12px", background: sel ? "#FF85B3" : "#fff", textAlign: "left" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 13 }}>{s.note ?? "รอบ"} <span style={{ fontWeight: 700, opacity: 0.85 }}>• {formatThaiDateTime(s.start_at)}</span></div>
                            {s.end_at && <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>ถึง {formatThaiDateTime(s.end_at)}</div>}
                          </div>
                          <div style={{ fontWeight: 900 }}>{sel ? "✓" : ""}</div>
                        </div>
                      </button>
                    );
                  })}
                  {sessions.length === 0 && <div style={{ fontSize: 13, fontWeight: 700, color: "#888" }}>ยังไม่มีรอบ</div>}
                </div>
              </div>
              <div style={{ ...doodle.card, padding: 14, color: "#1a1a1a" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 900 }}>เลือกรุ่นมือถือ</div>
                  <button onClick={async () => {
                    if (!selectedSessionId) return;
                    try { await loadPhones(selectedSessionId); }
                    catch (e: any) { setPageError(e?.message || "รีเฟรชไม่สำเร็จ"); }
                  }} style={{ border: "none", background: "transparent", cursor: selectedSessionId ? "pointer" : "not-allowed", fontWeight: 900, color: "#FF85B3", opacity: selectedSessionId ? 1 : 0.4 }} disabled={!selectedSessionId}>
                    ↻ รีเฟรช
                  </button>
                </div>
                {!selectedSessionId ? (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#888" }}>กรุณาเลือกรอบก่อน</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {phones.filter((p) => p.remaining > 0).map((p) => {
                      const sel = selectedPhoneId === p.phone_id;
                      return (
                        <div key={p.phone_id} onClick={() => { setSelectedPhoneId(p.phone_id); setBookingId(null); resetSlip(); }} style={{ ...(sel ? doodle.cardPink : doodle.card), padding: 12, cursor: "pointer", transform: sel ? "translate(-2px,-2px)" : "", boxShadow: sel ? "6px 6px 0px #1a1a1a" : "4px 4px 0px #1a1a1a", transition: "all .15s" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <div style={{ width: 52, height: 52, borderRadius: 14, border: "2px solid #1a1a1a", overflow: "hidden", background: "#fff", flexShrink: 0 }}>
                              {p.image_url ? <img src={p.image_url} alt={p.model_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#aaa", fontSize: 18 }}>📱</div>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 900, fontSize: 14 }}>{p.model_name}</div>
                              <div style={{ fontSize: 12, fontWeight: 800, color: "#FF85B3" }}>ค่าเช่า ฿{p.price}</div>
                              {/* ✅ แสดง deposit ต่อรุ่น */}
                              {p.deposit > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: "#888" }}>มัดจำ ฿{p.deposit}</div>}
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>เหลือ {p.remaining} เครื่อง</div>
                            </div>
                            <div style={{ fontSize: 18 }}>{sel ? "✅" : ""}</div>
                          </div>
                        </div>
                      );
                    })}
                    {phones.length > 0 && phones.every((p) => p.remaining <= 0) && (
                      <div style={{ ...doodle.cardYellow, padding: 12 }}>รอบนี้มือถือเต็มหมดแล้ว กรุณาเลือกรอบอื่น</div>
                    )}
                    {phones.length === 0 && <div style={{ fontSize: 13, fontWeight: 700, color: "#888" }}>ยังไม่มีมือถือในระบบ</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>👤</span>
                <span style={{ fontWeight: 900, fontSize: 18, color: "#1a1a1a" }}>ข้อมูลผู้เช่า</span>
              </div>
              <div style={{ ...doodle.card, padding: 16, marginBottom: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 800, marginBottom: 6, color: "#1a1a1a" }}>ชื่อ-นามสกุล</label>
                  <input style={{ ...doodle.input, color: "#1a1a1a" }} type="text" placeholder="ระบุชื่อตามบัตรประชาชน" value={renterName} onChange={(e) => setRenterName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 800, marginBottom: 6, color: "#1a1a1a" }}>เบอร์โทรศัพท์</label>
                  <input style={{ ...doodle.input, color: "#1a1a1a" }} type="tel" placeholder="08X-XXX-XXXX" maxLength={10} value={renterPhone} onChange={(e) => setRenterPhone(e.target.value)} />
                </div>
              </div>
              <div style={{ ...doodle.cardYellow, padding: 16, color: "#1a1a1a" }}>
                <div style={{ fontWeight: 900, fontSize: 13, color: "#2c2c2c", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>🧾 สรุปการจอง</div>
                {[
                  ["🎫 คอนเสิร์ต", selectedConcert?.title || "-"],
                  ["⏰ รอบ", selectedSession ? `${selectedSession.note ?? "รอบ"} • ${formatThaiDateTime(selectedSession.start_at)}` : "-"],
                  ["📱 มือถือ", selectedPhone?.model_name || "-"],
                  ["💵 ค่าเช่า", selectedPhone ? `฿${selectedPhone.price}` : "-"],
                  ["🔒 มัดจำ", depositFee > 0 ? `฿${depositFee}` : "ไม่มี"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 8, paddingBottom: 8, borderBottom: "1.5px dashed #000000" }}>
                    <span style={{ color: "#000000" }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 16, marginTop: 4, color: "#1a1a1a" }}>
                  <span>💰 รวมทั้งหมด</span>
                  <span style={{ color: "#FF85B3", fontSize: 20 }}>฿{totalAmount}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>💸</span>
                <span style={{ fontWeight: 900, fontSize: 18, color: "#1a1a1a" }}>ชำระเงิน</span>
              </div>

              <div style={{ ...doodle.cardPink, padding: "20px 16px", textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#888", marginBottom: 4 }}>ยอดที่ต้องโอน</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: "#1a1a1a", lineHeight: 1 }}>฿{totalAmount}</div>
                {depositFee > 0 && <div style={{ fontSize: 12, color: "#888", marginTop: 6, fontWeight: 600 }}>รวมมัดจำ ฿{depositFee} (คืนวันส่งเครื่อง)</div>}
              </div>

              <div style={{ ...doodle.card, overflow: "hidden", marginBottom: 16, color: "#1a1a1a" }}>
                {[
                  { bg: "#003D6B", label: "พร้อมเพย์", num: "081-234-5678", name: "บจก. คอนเสิร์ต เรนทัล", val: "0812345678", key: "pp" },
                  { bg: "#138F2D", label: "KBank", num: "123-4-56789-0", name: "บจก. คอนเสิร์ต เรนทัล", val: "1234567890", key: "bk" },
                ].map(({ bg, label, num, name, val, key }, i) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i === 0 ? "2px dashed #eee" : "none" }}>
                    <div style={{ width: 42, height: 42, background: bg, borderRadius: 12, border: "2px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 900, textAlign: "center", lineHeight: 1.2, flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{num}</div>
                      <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{name}</div>
                    </div>
                    <button onClick={() => handleCopy(val, key)} style={{ ...doodle.btn, padding: "6px 12px", fontSize: 11, background: copiedType === key ? "#5FD16A" : "#FFF5F9", color: "#1a1a1a", border: "2px solid #1a1a1a", flexShrink: 0 }}>
                      {copiedType === key ? "✓ แล้ว!" : "คัดลอก"}
                    </button>
                  </div>
                ))}
              </div>

              <label style={{ cursor: "pointer", display: "block" }}>
                <div style={{ border: "2.5px dashed #1a1a1a", borderRadius: 18, padding: 20, textAlign: "center", background: slipPreview ? "#F0FFF4" : "#FFFDF5", transition: "all .2s" }}>
                  {slipPreview ? (
                    <div>
                      <img src={slipPreview} alt="slip" style={{ maxHeight: 140, borderRadius: 12, objectFit: "contain", margin: "0 auto", display: "block", border: "2.5px solid #1a1a1a" }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#5FD16A" }}>✅ แนบสลิปแล้ว! แตะเพื่อเปลี่ยน</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 36, marginBottom: 6 }}>📎</div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: "#1a1a1a", margin: 0 }}>แนบสลิปโอนเงิน</p>
                      <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0", fontWeight: 600 }}>JPG, PNG, WEBP</p>
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
              <div style={{ fontSize: 64, marginBottom: 8 }}>🎉</div>
              <div style={{ fontWeight: 900, fontSize: 24, marginBottom: 4, color: "#1a1a1a" }}>จองสำเร็จแล้ว!</div>
              <div style={{ fontSize: 32, marginBottom: 4 }}>✅</div>
              <p style={{ fontSize: 18, color: "#888", fontWeight: 600, marginBottom: 16, lineHeight: 1.6 }}>
                ระบบยืนยันการจองแล้ว~<br />พบกันที่คอนเสิร์ต! 🎶
              </p>
              <div style={{ ...doodle.cardYellow, padding: 16, marginBottom: 16, textAlign: "left", color: "#1a1a1a" }}>
                <div style={{ textAlign: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "2px dashed #E0D0B0" }}>
                  <div style={{ fontSize: 12, color: "#000000", fontWeight: 700 }}>หมายเลขการจอง</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#FF85B3", letterSpacing: 2, marginTop: 4 }}>
                    {refNumber ?? bookingId ?? "-"}
                  </div>
                </div>
                {[
                  ["👤 ชื่อ", renterName || "-"],
                  ["🎫 คอนเสิร์ต", selectedConcert?.title || "-"],
                  ["⏰ รอบ", selectedSession ? `${selectedSession.note ?? "รอบ"} • ${formatThaiDateTime(selectedSession.start_at)}` : "-"],
                  ["📱 มือถือ", selectedPhone?.model_name || "-"],
                  ["💰 ยอดชำระ", `฿${totalAmount}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    <span style={{ color: "#888" }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => router.push("/bookings")} style={{ ...doodle.btnPrimary, padding: "14px 0", fontSize: 15, width: "100%" }}>
                ไปหน้าประวัติการจอง
              </button>
              <div style={{ height: 12 }} />
              <a href="https://line.me/R/ti/p/@your_oa_id" style={{ textDecoration: "none" }}>
                <div style={{ ...doodle.btnGreen, padding: "14px 0", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%" }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
                    <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.114.281.072.717.035.922-.047.251-.301 1.488-.363 1.831-.107.575-.515 2.059 1.802 1.082 2.316-.976 12.433-7.311 12.433-14.035z" />
                  </svg>
                  เพิ่มเพื่อน LINE OA
                </div>
              </a>
            </div>
          )}
        </div>

        {/* Bottom Nav */}
        {step < 5 && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", padding: "12px 20px 20px", background: "linear-gradient(to top, #FFF5F9 60%, transparent)" }}>
            <div style={{ width: "100%", maxWidth: 420, display: "flex", gap: 12 }}>
              {step > 1 && (
                <button onClick={handleBack} style={{ ...doodle.btn, flex: "0 0 90px", padding: "13px 0", background: "#fff", color: "#1a1a1a", fontSize: 14 }}>
                  ← กลับ
                </button>
              )}
              <button onClick={handleNext} disabled={isNextDisabled()} style={{ ...(isNextDisabled() ? doodle.btnGray : step === 4 ? doodle.btnGreen : doodle.btnPrimary), flex: 1, padding: "13px 0", fontSize: 15 }}>
                {step === 4 ? (submitting ? "⏳ กำลังบันทึก..." : "✓ ฉันโอนแล้ว!") : "ต่อไป →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}