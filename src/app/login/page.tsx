"use client";

export default function LoginPage() {
  const handleLineLogin = () => {
    window.location.href = "/api/auth/line/login";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FFF5F9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Mitr', 'Kanit', 'Segoe UI', sans-serif",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        {/* Logo */}
        <div style={{ fontSize: 64, marginBottom: 8 }}>📱</div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: "#1a1a1a", margin: "0 0 4px" }}>
          เช่ามือถือ
        </h1>
        <p style={{ fontSize: 14, color: "#888", fontWeight: 600, marginBottom: 40 }}>
          ถ่ายคอนเสิร์ตให้ปัง! ✨
        </p>

        {/* Card */}
        <div
          style={{
            background: "#fff",
            borderRadius: 24,
            border: "2.5px solid #1a1a1a",
            boxShadow: "6px 6px 0px #1a1a1a",
            padding: "32px 24px",
          }}
        >
          <div style={{ fontSize: 20, marginBottom: 8 }}>👋</div>
          <h2 style={{ fontWeight: 900, fontSize: 20, margin: "0 0 8px", color: "#1a1a1a" }}>
            เข้าสู่ระบบก่อนนะ~
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "#888",
              fontWeight: 600,
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
              color: "#1a1a1a",
              gap: 12,
              padding: "14px 20px",
              background: "#fff",
              border: "2.5px solid #1a1a1a",
              borderRadius: 50,
              boxShadow: "3px 3px 0px #1a1a1a",
              fontSize: 15,
              fontWeight: 800,
              cursor: "pointer",
              transition: "all .15s",
              fontFamily: "inherit",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translate(-2px,-2px)";
              e.currentTarget.style.boxShadow = "5px 5px 0px #1a1a1a";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "3px 3px 0px #1a1a1a";
            }}
          >
            <span style={{ fontWeight: 900 }}>LINE</span>
            เข้าสู่ระบบด้วย LINE
          </button>
        </div>

        <p style={{ fontSize: 11, color: "#bbb", marginTop: 20, fontWeight: 600 }}>
          เข้าสู่ระบบเพื่อจองและติดตามสถานะการเช่า
        </p>
      </div>
    </div>
  );
}