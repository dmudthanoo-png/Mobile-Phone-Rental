"use client";

const ink = "#332E2C";
const sub = "#A39A93";
const accent = "#F2679E";
const accent2 = "#7A57D1";
const accentSoft = "#FDF0F5";
const line = "#F0E9E2";

export default function LoginPage() {
  const handleLineLogin = () => {
    window.location.href = "/api/auth/line/login";
  };

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
        <img
          src="/crabby-logo.png"
          alt="Crabby เช่ามือถือ"
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
            👋
          </div>
          <h2 style={{ fontWeight: 700, fontSize: 20, margin: "0 0 8px", color: ink }}>
            เข้าสู่ระบบก่อนนะ~
          </h2>
          <p
            style={{
              fontSize: 13,
              color: sub,
              fontWeight: 500,
              marginBottom: 28,
              lineHeight: 1.6,
            }}
          >
            ล็อกอินด้วย LINE เพื่อจองมือถือ<br />ได้เลยครับ/ค่ะ 🎵
          </p>

          {/* Line Button */}
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
        </div>

        <p style={{ fontSize: 11, color: sub, marginTop: 20, fontWeight: 500 }}>
          เข้าสู่ระบบเพื่อจองและติดตามสถานะการเช่า
        </p>
      </div>
    </div>
  );
}
