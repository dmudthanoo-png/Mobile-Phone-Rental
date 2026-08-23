"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Navbar from "../Navbar";
import Footer from "../Footer";

type MeUser = {
  line_sub: string;
  name?: string | null;
  picture?: string | null;
};

const ink = "#241F1C";
const sub = "#7A6D61";
const accent = "#F2467E";
const accentStrong = "#D81F5E";
const accent2 = "#8354E8";
const accentSoft = "#FFE3EE";
const violetSoft = "#EFE6FF";
const line = "#F2E4D6";

const glass = "rgba(255,255,255,0.55)";
const glassBorder = "rgba(255,255,255,0.65)";
const glassHighlight = "rgba(255,255,255,0.55)";
const glassBlur = "blur(18px) saturate(170%)";
const accentGlow = "rgba(242,70,126,0.40)";
const uiFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, Roboto, sans-serif";

const card: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${glassBorder}`,
  boxShadow: `0 1px 2px rgba(35,32,31,0.04), 0 8px 24px -14px rgba(35,32,31,0.16), inset 0 1px 0 ${glassHighlight}`,
  background: glass,
  backdropFilter: glassBlur,
  WebkitBackdropFilter: glassBlur,
};

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

const webSteps = [
  { image: "/how-to-book/step-01-select-concert-two-arms-no-phone.png", title: "เลือกคอนเสิร์ต", desc: "เลือกงานคอนเสิร์ตที่จะไปดู" },
  { image: "/how-to-book/step-02-select-phone-and-time-v2.png", title: "เลือกรอบ & มือถือ", desc: "เลือกรอบการแสดงและรุ่นมือถือที่ต้องการ" },
  { image: "/how-to-book/step-03-enter-renter-details-v2.png", title: "กรอกข้อมูลผู้เช่า", desc: "กรอกชื่อและเบอร์โทรศัพท์ผู้เช่า" },
  { image: "/how-to-book/step-04-pay-deposit-v2.png", title: "ชำระเงิน (มัดจำ)", desc: "โอนค่ามัดจำแล้วแนบสลิปยืนยัน" },
  { image: "/how-to-book/step-05-booking-confirmed-v2.png", title: "เสร็จสิ้น รับเลขจอง", desc: "ระบบออกหมายเลขการจองให้ทันที อย่าลืมเพิ่มเพื่อน LINE OA เพื่อรับการแจ้งเตือนยืนยันการจอง" },
];

const fulfillmentSteps = [
  { image: "/how-to-book/step-06-await-approval-v2.png", title: "รอแอดมินอนุมัติ", desc: "แอดมินตรวจสอบสลิปและยืนยันคิวการจอง" },
  { image: "/how-to-book/step-07-pick-up-device-v2.png", title: "รับเครื่องตามนัดหมาย", desc: "ไปรับเครื่องที่จุดนัดหมายตามวัน-เวลาที่จอง" },
  { image: "/how-to-book/step-08-return-device-v2.png", title: "คืนเครื่อง", desc: "คืนเครื่อง ร้านตรวจสอบสภาพเรียบร้อย" },
  { image: "/how-to-book/step-09-receive-photos-and-videos-v2.png", title: "รับไฟล์ภาพ/วิดีโอ", desc: "ร้านส่งไฟล์ให้ตามช่องทางที่ตกลงกันไว้" },
];

function StepCard({ n, image, title, desc }: { n: number; image: string; title: string; desc: string }) {
  return (
    <div style={{ ...card, padding: "16px 14px", position: "relative", textAlign: "center" }}>
      <div
        style={{
          position: "absolute",
          top: -10,
          left: 14,
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${accent}, ${accent2})`,
          color: "#fff",
          fontSize: 12,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 4px 10px -3px ${accentGlow}`,
          textShadow: "0 1px 1.5px rgba(0,0,0,0.45)",
        }}
      >
        {n}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 6, marginBottom: 6 }}>
        <Image src={image} alt={title} width={140} height={140} style={{ objectFit: "contain" }} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: ink, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: sub, fontWeight: 500, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

export default function HowToBookPage() {
  const router = useRouter();
  const [meUser, setMeUser] = useState<MeUser | null>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMeUser(d?.user ?? null))
      .catch(() => setMeUser(null));
  }, []);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FFF9F3", fontFamily: uiFont, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", isolation: "isolate" }}>
      <AmbientGlow />
      <div style={{ width: "100%" }}>
        <Navbar user={meUser} onSignOut={handleSignOut} />
      </div>

      <div style={{ width: "100%", maxWidth: 900, padding: "28px 32px 40px", flex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <div style={{ fontSize: 30, fontWeight: 800 }}>
            <span style={{ color: ink }}>วิธีการ</span>{" "}
            <span style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              เช่ามือถือ
            </span>
          </div>
          <div style={{ fontSize: 14, color: sub, fontWeight: 500, marginTop: 6 }}>
            จองผ่านเว็บไซต์ให้เสร็จ 5 ขั้นตอน แล้วรอแอดมินอนุมัติ ก่อนไปรับเครื่อง
          </div>
        </div>

        {/* Phase 1: website booking */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🌐</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: ink }}>ขั้นตอนที่ 1-5 · จองผ่านเว็บไซต์</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 18, paddingTop: 4 }}>
            {webSteps.map((s, i) => (
              <StepCard key={i} n={i + 1} image={s.image} title={s.title} desc={s.desc} />
            ))}
          </div>
        </div>

        {/* Connector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "28px 0" }}>
          <div style={{ flex: 1, height: 1, background: line, maxWidth: 120 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: accent2, whiteSpace: "nowrap" }}>แล้วรอแอดมินอนุมัติ ↓</span>
          <div style={{ flex: 1, height: 1, background: line, maxWidth: 120 }} />
        </div>

        {/* Phase 2: fulfillment */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: violetSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📦</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: ink }}>ขั้นตอนที่ 6-9 · หลังจากจองเสร็จ</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 18, paddingTop: 4 }}>
            {fulfillmentSteps.map((s, i) => (
              <StepCard key={i} n={webSteps.length + i + 1} image={s.image} title={s.title} desc={s.desc} />
            ))}
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 36 }}>
          <button
            onClick={() => router.push("/")}
            style={{
              borderRadius: 999,
              border: "none",
              boxShadow: `0 10px 26px -10px ${accentGlow}, inset 0 1px 0 rgba(255,255,255,0.35)`,
              fontWeight: 700,
              cursor: "pointer",
              background: accentStrong,
              color: "#fff",
              padding: "13px 32px",
              fontSize: 15,
              minHeight: 44,
              fontFamily: uiFont,
            }}
          >
            เริ่มจองเลย →
          </button>
        </div>
      </div>

      <div style={{ width: "100%" }}>
        <Footer />
      </div>
    </div>
  );
}
