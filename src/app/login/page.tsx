"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const ink = "#332E2C";
const sub = "#A39A93";
const accent = "#F2679E";
const accent2 = "#7A57D1";
const accentSoft = "#FDF0F5";
const line = "#F0E9E2";

export default function LoginPage() {
  const router = useRouter();
  // "checking" = กำลังเช็คว่าเปิดจากในแอพ LINE (LIFF) อยู่หรือเปล่า ยังไม่โชว์ปุ่ม
  // "liff_signing_in" = อยู่ในแอพ LINE กำลังล็อกอินให้อัตโนมัติ
  // "ready" = โชว์ปุ่ม "เข้าสู่ระบบด้วย LINE" ตามปกติ (เข้าจากเบราว์เซอร์ทั่วไป หรือ LIFF ใช้ไม่ได้)
  const [phase, setPhase] = useState<"checking" | "liff_signing_in" | "ready">("checking");
  const [liffError, setLiffError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "banned") {
      setLiffError("บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน");
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

    // ยังไม่ได้ตั้งค่า LIFF ID (เช่น ยังไม่ได้สร้าง LIFF app) → ข้ามไปโชว์ปุ่มปกติเลย
    if (!liffId) {
      setPhase("ready");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });

        if (cancelled) return;

        // เปิดจากเบราว์เซอร์ทั่วไป (ไม่ใช่ในแอพ LINE) → ใช้ปุ่ม OAuth ปกติ
        if (!liff.isInClient()) {
          setPhase("ready");
          return;
        }

        // เปิดจากในแอพ LINE → ล็อกอินให้อัตโนมัติแบบไม่ต้องกดปุ่ม
        setPhase("liff_signing_in");

        const idToken = liff.getIDToken();
        if (!idToken) {
          // เผื่อกรณีหา token ไม่ได้ ให้ fallback ไปโชว์ปุ่มปกติ
          setPhase("ready");
          return;
        }

        const res = await fetch("/api/auth/liff/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        if (cancelled) return;

        if (!res.ok) {
          const out = await res.json().catch(() => null);
          setLiffError(out?.error || "เข้าสู่ระบบผ่าน LIFF ไม่สำเร็จ");
          setPhase("ready");
          return;
        }

        router.push("/");
      } catch {
        // liff.init ล้มเหลว (เช่น liffId ผิด หรือ SDK โหลดไม่ได้) → fallback ปุ่มปกติ
        if (!cancelled) setPhase("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLineLogin = () => {
    window.location.href = "/api/auth/line/login";
  };

  // ระหว่างกำลังเช็ค/ล็อกอินอัตโนมัติผ่าน LIFF — โชว์แค่โลโก้ + loading เฉยๆ ไม่ต้องโชว์ปุ่ม
  const showButton = phase === "ready";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FFFBF7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-itim), 'Kanit', 'Segoe UI', sans-serif",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        {/* Logo */}
        <Image
          src="/crabby-logo.png"
          alt="Crabby เช่ามือถือ"
          width={835}
          height={771}
          style={{
            display: "block",
            width: 170,
            height: "auto",
            objectFit: "contain",
            margin: "0 auto -6px",
          }}
        />
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
          <span style={{ color: ink }}>เช่ามือถือ</span>{" "}
          <span
            style={{
              background: `linear-gradient(135deg, ${accent}, ${accent2})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            กับ Crabby
          </span>
        </h1>
        <p style={{ fontSize: 14, color: sub, fontWeight: 500, marginBottom: 32 }}>
          ถ่ายคอนเสิร์ตให้ปัง! ✨
        </p>

        {/* Card */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            border: `1px solid ${line}`,
            boxShadow: "0 4px 20px rgba(51,46,44,0.06)",
            padding: "32px 24px",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: accentSoft,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              margin: "0 auto 12px",
            }}
          >
            {phase === "liff_signing_in" ? "⏳" : "👋"}
          </div>

          {phase === "liff_signing_in" ? (
            <>
              <h2 style={{ fontWeight: 700, fontSize: 20, margin: "0 0 8px", color: ink }}>
                กำลังเข้าสู่ระบบ...
              </h2>
              <p style={{ fontSize: 13, color: sub, fontWeight: 500, marginBottom: 8, lineHeight: 1.6 }}>
                รอสักครู่ครับ/ค่ะ ระบบกำลังเข้าสู่ระบบให้อัตโนมัติ 🎵
              </p>
            </>
          ) : (
            <>
              <h2 style={{ fontWeight: 700, fontSize: 20, margin: "0 0 8px", color: ink }}>
                เข้าสู่ระบบก่อนนะ~
              </h2>
              <p
                style={{
                  fontSize: 13,
                  color: sub,
                  fontWeight: 500,
                  marginBottom: liffError ? 12 : 28,
                  lineHeight: 1.6,
                }}
              >
                ล็อกอินด้วย LINE เพื่อจองมือถือ<br />ได้เลยครับ/ค่ะ 🎵
              </p>
              {liffError && (
                <p style={{ fontSize: 12, color: "#C43D5C", fontWeight: 600, marginBottom: 16 }}>
                  ⚠️ {liffError} — กรุณาลองกดปุ่มด้านล่างแทนครับ
                </p>
              )}
            </>
          )}

          {/* Line Button */}
          {showButton && (
            <button
              onClick={handleLineLogin}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                gap: 12,
                padding: "14px 20px",
                background: "#06C755",
                border: "none",
                borderRadius: 999,
                boxShadow: "0 4px 14px rgba(6,199,85,0.25)",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all .15s",
                fontFamily: "inherit",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 6px 18px rgba(6,199,85,0.32)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = "";
                e.currentTarget.style.boxShadow = "0 4px 14px rgba(6,199,85,0.25)";
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.114.281.072.717.035.922-.047.251-.301 1.488-.363 1.831-.107.575-.515 2.059 1.802 1.082 2.316-.976 12.433-7.311 12.433-14.035z" />
              </svg>
              เข้าสู่ระบบด้วย LINE
            </button>
          )}
        </div>

        <p style={{ fontSize: 11, color: sub, marginTop: 20, fontWeight: 500 }}>
          เข้าสู่ระบบเพื่อจองและติดตามสถานะการเช่า
        </p>
      </div>
    </div>
  );
}
