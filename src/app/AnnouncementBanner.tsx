"use client";

import React, { useEffect, useState } from "react";

type Announcement = {
  id: string;
  title: string | null;
  subtitle: string | null;
  emoji: string | null;
  image_url: string | null;
  active: boolean;
};

export default function AnnouncementBanner({
  title = "จองด่วน! รอบใหม่เปิดแล้ว",
  subtitle = "คอนเสิร์ตยอดฮิตมือถือเหลือจำนวนจำกัด รีบจองก่อนเต็ม",
  emoji = "🔥",
}: {
  title?: string;
  subtitle?: string;
  emoji?: string;
}) {
  const [ann, setAnn] = useState<Announcement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/announcement", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((out) => {
        if (!cancelled) setAnn(out?.announcement ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ยังโหลดไม่เสร็จ — ไม่ต้องโชว์อะไร กันจอกระพริบ
  if (!loaded) return null;

  // แอดมินปิดประกาศไว้ (ไม่มี record active) — ใช้ default prop เดิมเป็น fallback
  const useDefault = !ann;
  const displayTitle    = useDefault ? title    : ann!.title;
  const displaySubtitle  = useDefault ? subtitle : ann!.subtitle;
  const displayEmoji    = useDefault ? emoji    : ann!.emoji || "📣";
  const imageUrl = ann?.image_url || null;

  // ── โหมดรูปภาพ: แอดมินอัปโหลด banner รูปมาแทนข้อความ ──
  if (imageUrl) {
    return (
      <div style={{ margin: "16px 32px 0", borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,0.65)" }}>
        <img src={imageUrl} alt={displayTitle || "ประกาศ"} style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
    );
  }

  // ── โหมดข้อความ ──
  if (!displayTitle && !displaySubtitle) return null;

  return (
    <div
      style={{
        margin: "16px 32px 0",
        borderRadius: 18,
        padding: "16px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "linear-gradient(120deg, #FFE3EE 0%, #FFF3D6 100%)",
        border: "1px solid rgba(255,255,255,0.65)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          flexShrink: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        }}
      >
        {displayEmoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#241F1C", lineHeight: 1.3 }}>{displayTitle}</div>
        {displaySubtitle && (
          <div style={{ fontSize: 12, color: "#7A6D61", fontWeight: 500, marginTop: 2, lineHeight: 1.4 }}>
            {displaySubtitle}
          </div>
        )}
      </div>
    </div>
  );
}
