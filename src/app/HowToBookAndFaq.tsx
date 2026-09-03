"use client";

import React, { useState } from "react";

const accent = "#F2467E";
const accentStrong = "#D81F5E";
const accent2 = "#8354E8";
const ink = "#241F1C";
const sub = "#7A6D61";
const glassBorder = "rgba(255,255,255,0.65)";
const glass = "rgba(255,255,255,0.55)";
const glassBlur = "blur(14px) saturate(160%)";

type Faq = { q: string; a?: string; items?: string[]; ordered?: boolean };

const faqs: Faq[] = [
  { q: "ถ้าคอนเสิร์ตที่ต้องการไม่มีในหน้าเว็บ?", a: "สามารถติดต่อแอดมินทาง Line @crabby4rent ได้เลยค่ะ" },
  {
    q: "มีอุปกรณ์เสริมอะไรบ้าง?",
    a: "ทางร้านมีอุปกรณ์เสริมสำหรับให้บริการ ได้แก่",
    items: ["🔋 Power Bank 10,000 mAh", "📶 ซิมอินเทอร์เน็ต", "👜 กระเป๋าสำหรับใส่อุปกรณ์"],
  },
  {
    q: "จองแล้วสามารถยกเลิกได้ไหม?",
    a: "สามารถยกเลิกการจองได้ค่ะ โดย สงวนสิทธิ์ไม่คืนค่ามัดจำ ในกรณีที่ลูกค้ายกเลิกการจองเอง ทั้งนี้ ทางร้านจะคืนค่ามัดจำ เฉพาะกรณีที่ผู้จัดงานประกาศยกเลิกคอนเสิร์ตเท่านั้น ค่ะ",
  },
  { q: "ถ้าจองแล้วไม่ได้ไปคอนเสิร์ต สามารถโอนสิทธิ์ให้คนอื่นได้ไหม?", a: "สามารถสอบถามแอดมินก่อนค่ะ โดยต้องแจ้งข้อมูลผู้รับเครื่องล่วงหน้าและเป็นไปตามเงื่อนไขของแต่ละงาน" },
  { q: "หากทำเครื่องเสียหาย ต้องทำอย่างไร?", a: "กรณีที่ความเสียหาย มีค่าปรับตามความเสียหายที่เกิดขึ้นจริง" },
  {
    q: "ส่งไฟล์หลังจบงานทางไหน?",
    items: [
      "Google Drive: ทางร้านส่งไฟล์ให้ภายใน 6–12 ชั่วโมงหลังจบงาน และสำรองไฟล์ไว้ให้ 15 วัน",
      "Easy Share: สามารถรับไฟล์ผ่านแอปได้ โดยแนะนำให้เตรียมพื้นที่ว่างในโทรศัพท์ให้เพียงพอ เฉพาะกรณีคอนเสิร์ตเลิกก่อน 22.00 น.",
      "Flash Drive: ลูกค้าสามารถนำ Flash Drive แบบ Type-C มาเซฟไฟล์เองได้ ขอสงวนสิทธิ์ใช้เฉพาะ Flash Drive ของแท้ เพื่อป้องกันความเสียหายของอุปกรณ์",
    ],
  },
];

export default function HowToBookAndFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div style={{ marginTop: 36 }}>
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
                  aria-expanded={open}
                  style={{
                    width: "100%",
                    minHeight: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "14px 14px",
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
                      color: open ? accentStrong : accent2,
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
                    {f.a && <div style={{ marginBottom: f.items ? 6 : 0 }}>{f.a}</div>}
                    {f.items && (
                      f.ordered ? (
                        <ol style={{ margin: 0, paddingLeft: 18 }}>
                          {f.items.map((item, j) => <li key={j} style={{ marginBottom: 4 }}>{item}</li>)}
                        </ol>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 18, listStyle: "none" }}>
                          {f.items.map((item, j) => <li key={j} style={{ marginBottom: 4 }}>{item}</li>)}
                        </ul>
                      )
                    )}
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
