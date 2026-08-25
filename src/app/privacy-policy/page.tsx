import type { Metadata } from "next";
import Link from "next/link";
import Footer from "../Footer";
import PrivacyPolicyContent from "./PrivacyPolicyContent";

export const metadata: Metadata = {
  title: "นโยบายความเป็นส่วนตัว | Crabby เช่ามือถือ",
  description: "นโยบายความเป็นส่วนตัวของ Crabby เช่ามือถือ",
};

const ink = "#241F1C";
const accent = "#D81F5E";
const accentSoft = "#FFE3EE";
const paper = "rgba(255,255,255,0.86)";
const pageFont = "var(--font-noto-thai), 'Segoe UI', 'Leelawadee UI', -apple-system, system-ui, sans-serif";

export default function PrivacyPolicyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(60vw circle at 10% 0%, rgba(242,70,126,0.20), rgba(242,70,126,0) 70%), radial-gradient(55vw circle at 100% 20%, rgba(131,84,232,0.16), rgba(131,84,232,0) 70%), #FFFBF7",
        fontFamily: pageFont,
      }}
    >
      <div style={{ width: "100%", maxWidth: 820, margin: "0 auto", padding: "28px 20px 44px", boxSizing: "border-box" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            color: accent,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          ← กลับหน้าแรก
        </Link>

        <article
          style={{
            marginTop: 8,
            padding: "28px 24px 32px",
            borderRadius: 24,
            background: paper,
            border: "1px solid rgba(255,255,255,0.78)",
            boxShadow: "0 18px 46px -28px rgba(36,31,28,0.30)",
          }}
        >
          <div style={{ display: "inline-flex", padding: "5px 10px", borderRadius: 999, background: accentSoft, color: accent, fontSize: 12, fontWeight: 800 }}>
            PDPA · Privacy Notice
          </div>
          <h1 style={{ margin: "14px 0 8px", color: ink, fontSize: 28, lineHeight: 1.25 }}>
            นโยบายความเป็นส่วนตัว
          </h1>
          <PrivacyPolicyContent />
        </article>
      </div>
      <Footer />
    </main>
  );
}
