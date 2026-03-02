"use client";

import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
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
          <p style={{ fontSize: 13, color: "#888", fontWeight: 600, marginBottom: 28, lineHeight: 1.6 }}>
            ล็อกอินด้วย Gmail เพื่อจองมือถือ<br />ได้เลยครับ/ค่ะ 🎵
          </p>

          {/* Google Button */}
          <button
            onClick={handleGoogleLogin}
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
            onMouseOver={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = "translate(-2px,-2px)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "5px 5px 0px #1a1a1a";
            }}
            onMouseOut={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = "";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "3px 3px 0px #1a1a1a";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>
        </div>

        <p style={{ fontSize: 11, color: "#bbb", marginTop: 20, fontWeight: 600 }}>
          เข้าสู่ระบบเพื่อจองและติดตามสถานะการเช่า
        </p>
      </div>
    </div>
  );
}