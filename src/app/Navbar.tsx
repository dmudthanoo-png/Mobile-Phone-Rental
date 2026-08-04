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
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

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
      {/* Responsive: บนมือถือยุบลิงก์กลาง + ประวัติ ไปไว้ในเมนูแฮมเบอร์เกอร์แทน */}
      <style>{`
        .navbar-grid { grid-template-columns: 1fr auto 1fr; }
        .navbar-center-links { display: flex; }
        .navbar-desktop-user { display: flex; }
        .navbar-hamburger-btn { display: none; }
        @media (max-width: 640px) {
          .navbar-grid { grid-template-columns: auto 1fr !important; gap: 8px !important; padding: 10px 16px !important; }
          .navbar-center-links { display: none !important; }
          .navbar-desktop-user { display: none !important; }
          .navbar-hamburger-btn { display: flex !important; }
          .navbar-logo-img { width: 36px !important; height: 36px !important; }
          .navbar-logo-text { font-size: 18px !important; }
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
          <NavLink href="/#events">อีเวนต์</NavLink>
          <NavLink href="/#how-to-book">วิธีการจอง</NavLink>
          <NavLink href="/#reviews">รีวิว</NavLink>
        </div>

        {/* Right: user info (เดสก์ท็อป) */}
        <div className="navbar-desktop-user" style={{ justifySelf: "end", minWidth: 0, overflow: "hidden" }}>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
                }}
              >
                ประวัติการจอง
              </button>
              <div style={{ width: 1, height: 16, background: "#EFE7DF" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt="profile"
                    style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }}
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

        {/* Right: hamburger (มือถือ) */}
        <button
          className="navbar-hamburger-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="เมนู"
          style={{
            justifySelf: "end",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 24,
            color: linkColor,
            padding: 4,
            lineHeight: 1,
          }}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          style={{
            borderTop: "1px solid #F0E9E2",
            background: "#FFFBF7",
            padding: "8px 16px 16px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {user && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", marginBottom: 4 }}>
              {user.picture ? (
                <img src={user.picture} alt="profile" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div
                  style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "linear-gradient(135deg, #F2679E, #7A57D1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0,
                  }}
                >
                  {((user.name ?? "U")[0] ?? "U").toUpperCase()}
                </div>
              )}
              <span style={{ fontWeight: 700, fontSize: 15, color: linkColor }}>{user.name ?? "ผู้ใช้"}</span>
            </div>
          )}

          {[
            { href: "/#events", label: "อีเวนต์" },
            { href: "/#how-to-book", label: "วิธีการจอง" },
            { href: "/#reviews", label: "รีวิว" },
            ...(user ? [{ href: "/bookings", label: "ประวัติ" }] : []),
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMenu}
              style={{
                padding: "12px 4px",
                fontSize: 16,
                fontWeight: 700,
                color: linkColor,
                textDecoration: "none",
                borderBottom: "1px solid #F0E9E2",
              }}
            >
              {item.label}
            </Link>
          ))}

          {user ? (
            <button
              onClick={() => { closeMenu(); onSignOut?.(); }}
              style={{
                marginTop: 10,
                border: "none",
                background: "transparent",
                textAlign: "left",
                padding: "10px 4px",
                fontSize: 15,
                fontWeight: 700,
                color: "#C15E85",
                cursor: "pointer",
                fontFamily: navFont,
              }}
            >
              ออกจากระบบ
            </button>
          ) : (
            <button
              onClick={() => { closeMenu(); router.push("/login"); }}
              style={{
                marginTop: 12,
                border: "none",
                borderRadius: 999,
                background: "linear-gradient(135deg, #F2679E, #E1477F)",
                color: "#fff",
                padding: "10px 0",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: navFont,
              }}
            >
              เข้าสู่ระบบ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
