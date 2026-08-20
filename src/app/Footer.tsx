"use client";

import React, { useState } from "react";
import Link from "next/link";

const ink = "#241F1C";
const sub = "#7A6D61";
const accent = "#F2467E";
const lineGreen = "#06C755";
const glass = "rgba(255,255,255,0.55)";
const glassBorder = "rgba(255,255,255,0.65)";
const footerFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, Roboto, sans-serif";

const quickLinks = [
  { href: "/#events", label: "อีเวนต์" },
  { href: "/how-to-book", label: "วิธีการจอง" },
  { href: "/#reviews", label: "รีวิว" },
  { href: "/#faq", label: "FAQ" },
];

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: hover ? accent : ink,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "color .15s",
      }}
    >
      {children}
    </Link>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.8 22H1.6l8.1-9.3L1 2h7.1l4.9 6.3L18.9 2Zm-1.2 18.2h1.9L7.4 3.7H5.3l12.4 16.5Z" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
      <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.114.281.072.717.035.922-.047.251-.301 1.488-.363 1.831-.107.575-.515 2.059 1.802 1.082 2.316-.976 12.433-7.311 12.433-14.035z" />
    </svg>
  );
}

function ContactLink({
  href,
  icon,
  label,
  bg,
  hoverBg,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  bg: string;
  hoverBg: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 13px",
        borderRadius: 999,
        background: hover ? hoverBg : bg,
        color: "#fff",
        fontWeight: 700,
        fontSize: 12,
        textDecoration: "none",
        transition: "all .15s",
        boxShadow: hover ? "0 8px 20px -8px rgba(0,0,0,0.35)" : "0 4px 12px -6px rgba(0,0,0,0.25)",
      }}
    >
      {icon}
      {label}
    </a>
  );
}

export default function Footer() {
  return (
    <footer
      style={{
        width: "100%",
        marginTop: 20,
        borderTop: `1px solid ${glassBorder}`,
        background: glass,
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        fontFamily: footerFont,
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 32px 18px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          textAlign: "center",
        }}
      >
        <img src="/crabby-logo.png" alt="Crabby" style={{ width: 80, height: 80, objectFit: "contain" }} />

        <div style={{ display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
          {quickLinks.map((l) => (
            <FooterLink key={l.href} href={l.href}>
              {l.label}
            </FooterLink>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <ContactLink href="https://x.com/CRABBBBBY" icon={<XIcon />} label="@CRABBBBBY" bg="#000000" hoverBg="#241F1C" />
          <ContactLink
            href="https://line.me/R/ti/p/@CRABBY4RENT"
            icon={<LineIcon />}
            label="@CRABBY4RENT"
            bg={`linear-gradient(135deg, ${lineGreen}, #05A648)`}
            hoverBg="#05A648"
          />
        </div>

        <div style={{ fontSize: 10, color: sub, fontWeight: 500 }}>
          © {new Date().getFullYear()} Crabby เช่ามือถือ สงวนลิขสิทธิ์
        </div>
      </div>
    </footer>
  );
}
