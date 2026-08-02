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
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "12px 24px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Left: Logo */}
        <div
          onClick={() => router.push("/")}
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", justifySelf: "start" }}
        >
          <img
            src="/crabby-logo.png"
            alt="Crabby"
            style={{ width: 52, height: 52, objectFit: "contain" }}
          />
          <span style={{ fontWeight: 700, fontSize: 25, color: linkColor, letterSpacing: -0.2 }}>
            Crabby
          </span>
        </div>

        {/* Center: nav links */}
        <div style={{ display: "flex", alignItems: "center", gap: 28, justifySelf: "center" }}>
          <NavLink href="/#events">อีเว่นต์</NavLink>
          <NavLink href="/#how-to-book">วิธีการจอง</NavLink>
          <NavLink href="/#reviews">รีวิว</NavLink>
        </div>

        {/* Right: user info */}
        <div style={{ justifySelf: "end" }}>
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
