"use client";

import React, { useState } from "react";

const accent = "#F2467E";
const accent2 = "#8354E8";
const ink = "#241F1C";
const sub = "#7A6D61";
const glassBorder = "rgba(255,255,255,0.65)";
const glass = "rgba(255,255,255,0.55)";
const glassBlur = "blur(14px) saturate(160%)";

const faqs = [
  { q: "ต้องจองล่วงหน้ากี่วัน?", a: "แนะนำให้จองล่วงหน้าอย่างน้อย 3-5 วันก่อนงาน เพราะมือถือแต่ละรุ่นมีจำนวนจำกัด" },
  { q: "มัดจำคืนเมื่อไหร่?", a: "คืนมัดจำทันทีในวันที่ส่งคืนเครื่อง หากเครื่องอยู่ในสภาพปกติไม่มีความเสียหาย" },
  { q: "รับเครื่อง-คืนเครื่องที่ไหน?", a: "รับและคืนได้ที่หน้างานตามจุดนัดหมาย จะแจ้งรายละเอียดผ่าน LINE OA ก่อนวันงาน" },
  { q: "ถ้ามือถือเต็มทำอย่างไร?", a: "ลองเลือกรอบอื่นหรือรุ่นอื่นที่ยังว่าง หรือทักไลน์แอดมินเพื่อสอบถามคิวรอ" },
];

const reviews = [
  { name: "มิ้นท์", event: "BTS World Tour", rating: 5, text: "เครื่องคมชัดมาก ถ่ายคอนเสิร์ตออกมาสวยเกินคาด บริการรวดเร็วด้วย" },
  { name: "ต้นหอม", event: "TREASURE Pulse On", rating: 5, text: "จองง่าย รับเครื่องไว พนักงานน่ารักมาก จะกลับมาเช่าอีกแน่นอน" },
  { name: "ปูเป้", event: "GEMINI Concert", rating: 4, text: "มือถือแบตอึด ถ่ายได้ทั้งงานไม่ต้องพกสำรองไฟเลย" },
];

export default function HowToBookAndFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div style={{ marginTop: 36 }}>
      {/* Reviews */}
      <div id="reviews" style={{ scrollMarginTop: 90, marginBottom: 36 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: ink, marginBottom: 4 }}>รีวิวจากลูกค้า</div>
        <div style={{ fontSize: 12, color: sub, fontWeight: 500, marginBottom: 14 }}>เสียงจากคนที่เช่าไปแล้ว</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          {reviews.map((r, i) => (
            <div
              key={i}
              style={{
                borderRadius: 14,
                border: `1px solid ${glassBorder}`,
                background: glass,
                backdropFilter: glassBlur,
                WebkitBackdropFilter: glassBlur,
                padding: "16px 14px",
              }}
            >
              <div style={{ color: "#F5B93F", fontSize: 13, marginBottom: 8, letterSpacing: 1 }}>
                {"★".repeat(r.rating)}
                <span style={{ color: "#EDE7E1" }}>{"★".repeat(5 - r.rating)}</span>
              </div>
              <div style={{ fontSize: 12, color: ink, fontWeight: 500, lineHeight: 1.5, marginBottom: 10 }}>
                &ldquo;{r.text}&rdquo;
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: ink }}>{r.name}</div>
              <div style={{ fontSize: 10, color: sub, fontWeight: 500 }}>{r.event}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div id="faq" style={{ scrollMarginTop: 90 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: ink, marginBottom: 4 }}>คำถามที่พบบ่อย</div>
        <div style={{ fontSize: 12, color: sub, fontWeight: 500, marginBottom: 14 }}>ยังไม่แน่ใจ? ลองดูตรงนี้ก่อน</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {faqs.map((f, i) => {
            const open = openIdx === i;
            return (
              <div
                key={i}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${open ? accent : glassBorder}`,
                  background: glass,
                  backdropFilter: glassBlur,
                  WebkitBackdropFilter: glassBlur,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setOpenIdx(open ? null : i)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "12px 14px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13, color: ink }}>{f.q}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: open ? accent : accent2,
                      transform: open ? "rotate(45deg)" : "none",
                      transition: "transform .2s",
                      flexShrink: 0,
                    }}
                  >
                    +
                  </span>
                </button>
                {open && (
                  <div style={{ padding: "0 14px 14px", fontSize: 12, color: sub, fontWeight: 500, lineHeight: 1.6 }}>
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
