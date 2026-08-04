"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type MeUser = {
  line_sub: string;
  name?: string | null;
  picture?: string | null;
};

const navFont = "var(--font-itim), 'Kanit', sans-serif";
const linkColor = "#332E2C";
const linkHoverColor = "#F2679E";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 17,
        fontWeight: 700,
        color: hover ? linkHoverColor : linkColor,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "color .15s",
      }}
    >
      {children}
    </Link>
  );
}

export default function Navbar({
  user,
  onSignOut,
}: {
  user?: MeUser | null;
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const [signOutHover, setSignOutHover] = useState(false);
  const [historyHover, setHistoryHover] = useState(false);

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(255,251,247,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #F0E9E2",
        fontFamily: navFont,
      }}
    >
      {/* Responsive: ซ่อนลิงก์กลางแล้วยุบเป็น 2 คอลัมน์บนมือถือ กัน logo/นาว ทับกัน */}
      <style>{`
        .navbar-grid { grid-template-columns: 1fr auto 1fr; }
        .navbar-center-links { display: flex; }
        .navbar-history-label { display: inline; }
        @media (max-width: 640px) {
          .navbar-grid { grid-template-columns: auto 1fr !important; gap: 8px !important; padding: 10px 16px !important; }
          .navbar-center-links { display: none !important; }
          .navbar-logo-img { width: 36px !important; height: 36px !important; }
          .navbar-logo-text { font-size: 18px !important; }
          .navbar-history-label { display: none !important; }
          .navbar-history-icon { display: inline !important; }
        }
      `}</style>

      <div
        className="navbar-grid"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "12px 24px",
          display: "grid",
          alignItems: "center",
          gap: 12,
          overflow: "hidden",
        }}
      >
        {/* Left: Logo */}
        <div
          onClick={() => router.push("/")}
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", justifySelf: "start", minWidth: 0 }}
        >
          <img
            src="/crabby-logo.png"
            alt="Crabby"
            className="navbar-logo-img"
            style={{ width: 52, height: 52, objectFit: "contain", flexShrink: 0 }}
          />
          <span className="navbar-logo-text" style={{ fontWeight: 700, fontSize: 25, color: linkColor, letterSpacing: -0.2, whiteSpace: "nowrap" }}>
            Crabby
          </span>
        </div>

        {/* Center: nav links (ซ่อนบนมือถือ) */}
        <div className="navbar-center-links" style={{ alignItems: "center", gap: 28, justifySelf: "center" }}>
          <NavLink href="/#events">อีเว่นต์</NavLink>
          <NavLink href="/#how-to-book">วิธีการจอง</NavLink>
          <NavLink href="/#reviews">รีวิว</NavLink>
        </div>

        {/* Right: user info */}
        <div style={{ justifySelf: "end", minWidth: 0, overflow: "hidden" }}>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => router.push("/bookings")}
                onMouseEnter={() => setHistoryHover(true)}
                onMouseLeave={() => setHistoryHover(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 16,
                  fontWeight: 700,
                  color: historyHover ? linkHoverColor : linkColor,
                  whiteSpace: "nowrap",
                  transition: "color .15s",
                  fontFamily: navFont,
                  padding: 0,
                }}
              >
                <span className="navbar-history-label">ประวัติการจอง</span>
                <span style={{ display: "none" }} className="navbar-history-icon">📋</span>
              </button>
              <div style={{ width: 1, height: 16, background: "#EFE7DF", flexShrink: 0 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt="profile"
                    style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #F2679E, #7A57D1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {((user.name ?? "U")[0] ?? "U").toUpperCase()}
                  </div>
                )}
                <button
                  onClick={onSignOut}
                  onMouseEnter={() => setSignOutHover(true)}
                  onMouseLeave={() => setSignOutHover(false)}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 700,
                    color: signOutHover ? linkHoverColor : linkColor,
                    whiteSpace: "nowrap",
                    transition: "color .15s",
                    fontFamily: navFont,
                    padding: 0,
                  }}
                >
                  ออกจากระบบ
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => router.push("/login")}
              style={{
                border: "none",
                borderRadius: 999,
                background: "linear-gradient(135deg, #F2679E, #E1477F)",
                color: "#fff",
                padding: "8px 18px",
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(242,103,158,0.3)",
                fontFamily: navFont,
                whiteSpace: "nowrap",
              }}
            >
              เข้าสู่ระบบ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
