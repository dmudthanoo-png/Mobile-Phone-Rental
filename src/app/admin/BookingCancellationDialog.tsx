"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cancellationLabel, formatRefundAmount, isRefundAmount } from "@/lib/bookingCancellation";
import type { CancellationRecord } from "@/lib/bookingCancellationServer";

type Details = {
  booking: { id: string; ref_number: string; renter_name: string; status: string };
  cancellation: CancellationRecord | null;
  refund_amount: number | null;
  can_cancel: boolean; blocked_reason: string | null; can_manage_refund: boolean;
};
const field: CSSProperties = { width: "100%", padding: 10, border: "1px solid #DDD", borderRadius: 8, font: "inherit", boxSizing: "border-box" };
const button: CSSProperties = { padding: "10px 14px", border: "1px solid #DDD", borderRadius: 10, background: "#FFF", font: "inherit", cursor: "pointer", minHeight: 44 };
const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

export default function BookingCancellationDialog({ bookingId, onClose, onSaved }: {
  bookingId: string; onClose: () => void; onSaved: () => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [transferred, setTransferred] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const mounted = useRef(true);
  const readVersion = useRef(0);
  const endpoint = `/api/admin/bookings/${bookingId}`;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const version = ++readVersion.current;
    fetch(`${endpoint}/cancellation`, { cache: "no-store" })
      .then(async res => { const out = await res.json(); if (!res.ok) throw new Error(out.error || "โหลดรายการไม่สำเร็จ"); return out; })
      .then(out => { if (active && version === readVersion.current) setDetails(out); })
      .catch(e => { if (active && version === readVersion.current) setError(e instanceof Error ? e.message : "โหลดรายการไม่สำเร็จ"); });
    return () => { active = false; mounted.current = false; };
  }, [endpoint]);

  async function reload() {
    const version = ++readVersion.current;
    const res = await fetch(`${endpoint}/cancellation`, { cache: "no-store" });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || "โหลดรายการไม่สำเร็จ");
    if (mounted.current && version === readVersion.current) {
      setDetails(out);
      setChecked(false); // Never carry consent for an old displayed amount forward.
    }
  }

  async function mutate(path: string, method: string, body: object | FormData) {
    if (busyRef.current) return;
    busyRef.current = true;
    readVersion.current++;
    setBusy(true); setError("");
    try {
      const res = await fetch(`${endpoint}/${path}`, {
        method, cache: "no-store",
        ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok || out?.ok !== true) throw new Error(out?.error || "ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุด ห้ามโอนเงินซ้ำ");
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "ยังยืนยันผลไม่ได้ ห้ามโอนเงินซ้ำ");
    } finally {
      // Also refresh after an ambiguous timeout: the transaction may have committed.
      try { await reload(); } catch { if (mounted.current) { setDetails(null); setError("โหลดสถานะล่าสุดไม่ได้ กรุณาปิดแล้วเปิดรายการใหม่ ห้ามโอนเงินซ้ำ"); } }
      onSaved();
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function viewProof() {
    setError("");
    try {
      const res = await fetch(`${endpoint}/refund`, { cache: "no-store" });
      const out = await res.json();
      if (!res.ok || !out.url) throw new Error(out.error || "เปิดหลักฐานไม่สำเร็จ");
      if (mounted.current) setProofUrl(out.url);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "เปิดหลักฐานไม่สำเร็จ"); }
  }

  const c = details?.cancellation;
  const refundAmount = c?.refund_amount ?? details?.refund_amount;
  const validAmount = isRefundAmount(refundAmount);
  const amountLabel = validAmount ? `${formatRefundAmount(refundAmount)} บาท` : "(รอตรวจสอบยอด)";
  const close = () => { if (!busyRef.current) onClose(); };
  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 1000, padding: 20, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <section role="dialog" aria-modal="true" aria-labelledby="cancel-title" onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 510, maxHeight: "90vh", overflow: "auto", background: "white", borderRadius: 16, padding: 22, color: "#241F1C", fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="cancel-title" style={{ fontSize: 18, margin: 0 }}>ยกเลิกการจอง — คืนมัดจำ {amountLabel}</h2>
          <button type="button" aria-label="ปิดหน้าต่าง" disabled={busy} onClick={close} style={button}>✕</button>
        </div>
        {error && <p role="alert" style={{ padding: 12, background: "#FFF1F2", color: "#9F1239", borderRadius: 8 }}>{error}</p>}
        {!details && !error && <p>กำลังโหลดข้อมูลล่าสุด...</p>}
        {details && <>
          <p><strong>{details.booking.renter_name}</strong><br />REF {details.booking.ref_number}</p>
          <p style={{ padding: 12, background: "#FFF8E6", borderRadius: 8 }}>
            คืนเฉพาะมัดจำที่รับจริง {amountLabel} ไม่รวมค่าเช่าที่จะจ่ายหน้างาน<br />เก็บประวัติและสลิปเดิมไว้ ไม่ส่งข้อความ LINE
          </p>
          {!c ? <fieldset disabled={busy || !validAmount} style={{ border: 0, padding: 0, margin: 0 }}>
            {!details.can_cancel ? <p role="alert">{details.blocked_reason}</p> : <>
              <label>เหตุผลที่แอดมินอนุมัติยกเลิกและคืนมัดจำ
                <textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} rows={3} style={{ ...field, marginTop: 8 }} />
              </label>
              <label style={{ display: "flex", gap: 8, margin: "16px 0" }}>
                <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
                ตรวจแล้วว่าร้านรับมัดจำ {amountLabel} และอนุมัติคืนให้รายการนี้ การยกเลิกจะปล่อยเครื่องและเลนส์ให้จองได้อีก
              </label>
              <button type="button" disabled={!checked || reason.trim().length < 3} style={{ ...button, background: "#FFF1F2", color: "#9F1239" }}
                onClick={() => mutate("cancellation", "POST", { reason, confirmed_deposit: true, expected_refund_amount: refundAmount })}>
                ยืนยันยกเลิก — รอคืนมัดจำ {amountLabel}
              </button>
            </>}
          </fieldset> : <>
            <p><strong>{cancellationLabel(c)}</strong><br />ยกเลิกเมื่อ {date(c.cancelled_at)} โดย {c.cancelled_by_username}<br />เหตุผล: {c.reason}</p>
            {c.refund_status === "pending" && <>
              <p>กดรับงานก่อนโอนเงิน เพื่อกันแอดมินสองคนโอนซ้ำ ระบบไม่ได้โอนเงินให้อัตโนมัติ</p>
              <button type="button" disabled={busy || !validAmount} style={button} onClick={() => mutate("refund", "PATCH", { action: "claim", expected_refund_amount: refundAmount })}>รับงานคืนมัดจำ {amountLabel}</button>
            </>}
            {c.refund_status === "processing" && <>
              <p>ผู้รับงาน: <strong>{c.processing_by_username}</strong> · {c.processing_at ? date(c.processing_at) : ""}</p>
              {!details.can_manage_refund ? <p role="alert">แอดมินคนอื่นกำลังคืนเงิน ห้ามโอนซ้ำ กรุณาประสานผู้รับงาน</p> : <fieldset disabled={busy || !validAmount} style={{ border: 0, padding: 0, margin: 0 }}>
                <p>ตรวจสอบบัญชีปลายทางกับลูกค้าและโอนคืนเอง {amountLabel} จากนั้นบันทึกหลักฐานด้านล่าง หากโอนแล้วห้ามคืนงานหรือโอนซ้ำ</p>
                <label>เลขอ้างอิงธุรกรรมโอนคืน
                  <input value={reference} onChange={e => setReference(e.target.value)} maxLength={120} autoComplete="off" style={{ ...field, margin: "8px 0 14px" }} />
                </label>
                <label>ภาพหลักฐานโอนคืน (JPG / PNG / WebP ไม่เกิน 5 MB)
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setProof(e.target.files?.[0] ?? null)} style={{ ...field, marginTop: 8 }} />
                </label>
                <label style={{ display: "flex", gap: 8, margin: "16px 0" }}>
                  <input type="checkbox" checked={transferred} onChange={e => setTransferred(e.target.checked)} />โอนคืนให้ลูกค้าแล้ว {amountLabel} และหลักฐานเป็นของรายการนี้
                </label>
                <button type="button" disabled={!proof || reference.trim().length < 3 || !transferred} style={{ ...button, background: "#E1FAEC" }} onClick={() => {
                  if (!proof) return;
                  const form = new FormData(); form.set("proof", proof); form.set("reference", reference); form.set("transferred", "true");
                  form.set("expected_refund_amount", String(refundAmount));
                  void mutate("refund", "POST", form);
                }}>บันทึกคืนมัดจำแล้ว {amountLabel}</button>
                <button type="button" style={{ ...button, marginTop: 12 }} onClick={() => {
                  if (window.confirm("ยืนยันว่าคุณยังไม่ได้โอนเงินและไม่มีรายการโอนค้างอยู่? ห้ามคืนงานหากโอนไปแล้ว เพราะผู้อื่นอาจโอนซ้ำ")) {
                    void mutate("refund", "PATCH", { action: "release", not_transferred: true });
                  }
                }}>ยังไม่ได้โอน — คืนงานให้แอดมินคนอื่น</button>
              </fieldset>}
            </>}
            {c.refund_status === "refunded" && <>
              <p>บันทึกคืนเงินเมื่อ {c.refunded_at ? date(c.refunded_at) : "-"}<br />โดย {c.refunded_by_username}<br />เลขอ้างอิง: {c.refund_reference}</p>
              <p><strong>คืนเงินแล้ว ห้ามโอนซ้ำ</strong></p>
              <button type="button" onClick={viewProof} style={button}>ดูหลักฐานคืนเงิน</button>
              {proofUrl && <p><a href={proofUrl} target="_blank" rel="noreferrer">เปิดภาพหลักฐานคืนเงิน ↗</a></p>}
            </>}
          </>}
        </>}
        {busy && <p role="status">กำลังบันทึกและตรวจสอบสถานะล่าสุด...</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button type="button" disabled={busy} onClick={() => { setError(""); void reload().catch(e => setError(e.message)); }} style={button}>โหลดสถานะล่าสุด</button>
          <button type="button" disabled={busy} onClick={close} style={button}>ปิด</button>
        </div>
      </section>
    </div>
  );
}
