"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type MeUser = {
  line_sub: string;
  name?: string | null;
  picture?: string | null;
};

const navFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, Roboto, sans-serif";
const linkColor = "#241F1C";
const linkHoverColor = "#F2467E";
const accentStrong = "#D81F5E";
const accent2 = "#8354E8";
const accentGlow = "rgba(242,70,126,0.40)";
const glassStrong = "rgba(255,255,255,0.8)";
const glassBorder = "rgba(255,255,255,0.65)";

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <polyline points="4,4 4,8.4 8.4,8.4" />
      <polyline points="12,7.5 12,12.3 15.3,14" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5.5a2 2 0 0 0 2-2v-2" />
      <line x1="9.5" y1="12" x2="21" y2="12" />
      <polyline points="17.3,8.3 21,12 17.3,15.7" />
    </svg>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 14,
        fontWeight: 600,
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
        background: glassStrong,
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        borderBottom: `1px solid ${glassBorder}`,
        boxShadow: `0 2px 10px -6px ${accentGlow}`,
        fontFamily: navFont,
      }}
    >
      {/* Responsive: บนมือถือยุบลิงก์กลาง + ประวัติ ไปไว้ในเมนูแฮมเบอร์เกอร์แทน */}
      <style>{`
        .navbar-grid { grid-template-columns: 1fr auto 1fr; }
        .navbar-center-links { display: flex; }
        .navbar-desktop-user { display: flex; }
        .navbar-hamburger-btn { display: none; align-items: center; justify-content: center; }
        @media (max-width: 640px) {
          .navbar-grid { grid-template-columns: auto 1fr !important; gap: 8px !important; padding: 8px 16px !important; }
          .navbar-center-links { display: none !important; }
          .navbar-desktop-user { display: none !important; }
          .navbar-hamburger-btn { display: flex !important; }
          .navbar-logo-img { width: 38px !important; height: 38px !important; }
        }
      `}</style>

      <div
        className="navbar-grid"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "9px 20px",
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
            style={{ width: 48, height: 48, objectFit: "contain", flexShrink: 0, filter: `drop-shadow(0 2px 4px ${accentGlow})` }}
          />
        </div>

        {/* Center: nav links (ซ่อนบนมือถือ) */}
        <div className="navbar-center-links" style={{ alignItems: "center", gap: 22, justifySelf: "center" }}>
          <NavLink href="/#events">อีเวนต์</NavLink>
          <NavLink href="/how-to-book">วิธีการจอง</NavLink>
          <NavLink href="/#reviews">รีวิว</NavLink>
        </div>

        {/* Right: user info (เดสก์ท็อป) */}
        <div className="navbar-desktop-user" style={{ justifySelf: "end", minWidth: 0, overflow: "hidden" }}>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={() => router.push("/bookings")}
                onMouseEnter={() => setHistoryHover(true)}
                onMouseLeave={() => setHistoryHover(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  color: historyHover ? linkHoverColor : linkColor,
                  whiteSpace: "nowrap",
                  transition: "color .15s",
                  fontFamily: navFont,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <HistoryIcon />
                ประวัติการจอง
              </button>
              <div style={{ width: 1, height: 14, background: glassBorder }} />
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt="profile"
                    style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: `linear-gradient(135deg, ${linkHoverColor}, ${accent2})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "#fff",
                      flexShrink: 0,
                      boxShadow: `0 2px 6px -2px ${accentGlow}`,
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
                    fontSize: 13,
                    fontWeight: 600,
                    color: signOutHover ? linkHoverColor : linkColor,
                    whiteSpace: "nowrap",
                    transition: "color .15s",
                    fontFamily: navFont,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <LogoutIcon />
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
                background: `linear-gradient(135deg, ${linkHoverColor}, ${accentStrong})`,
                color: "#fff",
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: `0 3px 10px -4px ${accentGlow}`,
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
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            background: "rgba(242,70,126,0.10)",
            cursor: "pointer",
            fontSize: 17,
            color: linkColor,
            padding: 0,
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
            borderTop: `1px solid ${glassBorder}`,
            background: glassStrong,
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
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
                    width: 28, height: 28, borderRadius: "50%",
                    background: `linear-gradient(135deg, ${linkHoverColor}, ${accent2})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
                  }}
                >
                  {((user.name ?? "U")[0] ?? "U").toUpperCase()}
                </div>
              )}
              <span style={{ fontWeight: 700, fontSize: 13, color: linkColor }}>{user.name ?? "ผู้ใช้"}</span>
            </div>
          )}

          {[
            { href: "/#events", label: "อีเวนต์" },
            { href: "/how-to-book", label: "วิธีการจอง" },
            { href: "/#reviews", label: "รีวิว" },
            ...(user ? [{ href: "/bookings", label: "ประวัติ" }] : []),
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMenu}
              style={{
                padding: "10px 4px",
                fontSize: 14,
                fontWeight: 600,
                color: linkColor,
                textDecoration: "none",
                borderBottom: `1px solid ${glassBorder}`,
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
                fontSize: 13,
                fontWeight: 600,
                color: accentStrong,
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
                background: `linear-gradient(135deg, ${linkHoverColor}, ${accentStrong})`,
                color: "#fff",
                padding: "9px 0",
                fontSize: 13,
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
