"use client";

import { useEffect, useRef, useState } from "react";
import { cancellationLabel, formatRefundAmount, isRefundAmount } from "@/lib/bookingCancellation";
import type { CancellationRecord } from "@/lib/bookingCancellationServer";
import styles from "./BookingCancellationDialog.module.css";

type Details = {
  booking: { id: string; ref_number: string; renter_name: string; status: string };
  cancellation: CancellationRecord | null;
  refund_amount: number | null;
  can_cancel: boolean; blocked_reason: string | null; can_manage_refund: boolean;
  can_cancel_without_refund: boolean; no_refund_blocked_reason: string | null;
};
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
  const [cancellationMode, setCancellationMode] = useState<"refund" | "no_refund" | null>(null);
  const mounted = useRef(true);
  const readVersion = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    // Keep the form inside the visible screen when a mobile keyboard opens.
    // Do not resize during pinch zoom: users must still be able to magnify text.
    const viewport = window.visualViewport;
    const syncViewport = () => {
      if (!viewport || viewport.scale !== 1) return;
      overlay.style.setProperty("--cancel-viewport-height", `${viewport.height}px`);
      overlay.style.setProperty("--cancel-viewport-top", `${viewport.offsetTop}px`);
      overlay.toggleAttribute("data-compact-viewport", viewport.height < 460);
    };
    const bodyStyle = document.body.style;
    const overflow = bodyStyle.getPropertyValue("overflow");
    const priority = bodyStyle.getPropertyPriority("overflow");
    bodyStyle.setProperty("overflow", "hidden");
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      overlay.style.removeProperty("--cancel-viewport-height");
      overlay.style.removeProperty("--cancel-viewport-top");
      overlay.removeAttribute("data-compact-viewport");
      if (overflow) bodyStyle.setProperty("overflow", overflow, priority);
      else bodyStyle.removeProperty("overflow");
    };
  }, []);

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
  const modeAllowed = cancellationMode === "no_refund" ? details?.can_cancel_without_refund === true
    : cancellationMode === "refund" && details?.can_cancel === true && validAmount;
  const chooseMode = (mode: "refund" | "no_refund") => { setCancellationMode(mode); setChecked(false); };
  const close = () => { if (!busyRef.current) onClose(); };
  const reasonLength = reason.trim().length;
  const reasonInvalid = reason.length > 0 && reasonLength < 3;
  const canConfirm = !busy && modeAllowed && checked && reasonLength >= 3 && reasonLength <= 500;
  const actionHint = !cancellationMode ? "เลือกกรณีการยกเลิกก่อนดำเนินการ"
    : !modeAllowed ? "กรุณาตรวจสอบข้อมูลรายการก่อนดำเนินการ"
      : reasonLength < 3 ? "ระบุเหตุผลอย่างน้อย 3 ตัวอักษร เพื่อเปิดใช้งานปุ่ม"
        : !checked ? "ติ๊กยืนยันว่าตรวจสอบข้อมูลแล้วก่อนดำเนินการ" : "";
  return (
    <div ref={overlayRef} onClick={close} className={styles.overlay}>
      <section role="dialog" aria-modal="true" aria-labelledby="cancel-title" onClick={e => e.stopPropagation()}
        className={styles.dialog} aria-busy={busy}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.headerIcon} aria-hidden="true">↶</span>
            <div><p className={styles.eyebrow}>จัดการรายการจอง</p><h2 id="cancel-title" className={styles.title}>{c ? "ประวัติการยกเลิก" : "ยกเลิกการจอง"}</h2></div>
          </div>
          <button type="button" aria-label="ปิดหน้าต่าง" disabled={busy} onClick={close} className={styles.iconButton}>✕</button>
        </header>
        <div className={styles.body}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!details && !error && <p role="status" className={styles.loading}>กำลังโหลดข้อมูลล่าสุด...</p>}
        {details && <>
          <div className={styles.booking}>
            <div className={styles.customer}><span className={styles.avatar} aria-hidden="true">{details.booking.renter_name.slice(0, 1)}</span>
              <div><strong>{details.booking.renter_name}</strong><div className={styles.reference}>REF {details.booking.ref_number}</div></div>
            </div>
            <span className={styles.badge}>{details.booking.status === "cancelled" ? "ยกเลิกแล้ว" : details.booking.status === "confirmed" ? "ยืนยันแล้ว" : "ตรวจสอบสถานะ"}</span>
          </div>
          <div className={styles.info}>
            <span className={styles.infoIcon} aria-hidden="true">i</span>
            <p>นำออกจากติดตามงาน · คืนสต็อกเครื่องและเลนส์<br /><span>เก็บประวัติและสลิปเดิมไว้ · ไม่ส่งข้อความ LINE</span></p>
          </div>
          {!c ? <fieldset disabled={busy} className={styles.form}>
            {!details.can_cancel && !details.can_cancel_without_refund ? <p role="alert" className={styles.error}>{details.no_refund_blocked_reason ?? details.blocked_reason}</p> : <>
              <fieldset className={styles.choices}>
                <legend className={styles.sectionTitle}><span aria-hidden="true">1</span> เลือกกรณีการยกเลิก</legend>
                <div className={styles.choiceGrid}>
                <label className={`${styles.choice} ${cancellationMode === "refund" ? styles.selected : ""}`}>
                  <span className={styles.choiceHeading}><span>คืนมัดจำ</span>
                  <input type="radio" name="cancellation-mode" value="refund" checked={cancellationMode === "refund"} onChange={() => chooseMode("refund")} />
                  </span>
                  <strong className={styles.choiceValue}>{amountLabel}</strong>
                  <span className={styles.choiceCaption}>รับงานและบันทึกหลักฐานคืนเงิน</span>
                </label>
                <label className={`${styles.choice} ${cancellationMode === "no_refund" ? styles.selected : ""}`}>
                  <span className={styles.choiceHeading}><span>ไม่คืนมัดจำ</span>
                  <input type="radio" name="cancellation-mode" value="no_refund" checked={cancellationMode === "no_refund"} onChange={() => chooseMode("no_refund")} />
                  </span>
                  <strong className={styles.choiceValue}>ยกเลิกอย่างเดียว</strong>
                  <span className={styles.choiceCaption}>ไม่มีงานคืนเงิน ไม่ต้องแนบสลิป</span>
                </label>
                </div>
              </fieldset>
              <div className={styles.modeDescription} aria-live="polite">
                {!cancellationMode && <p>กรุณาเลือกกรณีคืนมัดจำหรือไม่คืนมัดจำก่อนยืนยัน</p>}
                {cancellationMode === "refund" && <p>คืนเฉพาะมัดจำที่รับจริง {amountLabel} ไม่รวมค่าเช่าหน้างาน เมื่อยกเลิกจะสร้างรายการรอคืนเงิน</p>}
                {cancellationMode === "no_refund" && <p>ยกเลิกโดยไม่คืนมัดจำ ไม่สร้างงานคืนเงิน และไม่ต้องแนบหลักฐานโอนคืน</p>}
              </div>
              {cancellationMode && !modeAllowed && <p role="alert" className={styles.error}>{cancellationMode === "refund" ? details.blocked_reason : details.no_refund_blocked_reason}</p>}
              <p className={styles.warning}><span aria-hidden="true">!</span> หลังยืนยันแล้ว ไม่สามารถสลับกรณีคืนมัดจำ/ไม่คืนมัดจำได้</p>
              <div className={styles.labelRow}>
                <label htmlFor="cancellation-reason" className={styles.sectionTitle}><span aria-hidden="true">2</span> เหตุผลในการยกเลิก</label>
                <span className={styles.counter}>{reasonLength}/500</span>
              </div>
              <textarea id="cancellation-reason" value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} rows={3}
                placeholder="เช่น ลูกค้าขอยกเลิกการจอง" aria-describedby="cancellation-reason-hint" aria-invalid={reasonInvalid}
                className={`${styles.field} ${reasonInvalid ? styles.invalid : ""}`} />
              <p id="cancellation-reason-hint" className={reasonInvalid ? styles.fieldError : styles.hint} aria-live="polite">
                {reasonInvalid ? `กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร (ตอนนี้ ${reasonLength} ตัวอักษร)` : "ระบุเหตุผล 3–500 ตัวอักษร · สำหรับประวัติภายในร้าน"}
              </p>
              <label className={`${styles.confirmation} ${!modeAllowed ? styles.unavailable : ""}`}>
                <input type="checkbox" disabled={!modeAllowed} checked={checked} onChange={e => setChecked(e.target.checked)} />
                <span>{cancellationMode === "no_refund" ? "ยืนยันยกเลิกโดยไม่คืนมัดจำ และรับทราบว่าเปลี่ยนกรณีภายหลังไม่ได้"
                  : cancellationMode === "refund" ? `ตรวจแล้วว่าร้านรับมัดจำ ${amountLabel} และอนุมัติคืนให้รายการนี้ โดยเปลี่ยนกรณีภายหลังไม่ได้`
                    : "เลือกกรณีการยกเลิกก่อนติ๊กยืนยัน"}</span>
              </label>
              <button type="button" disabled={!canConfirm} className={styles.primaryButton} aria-describedby={actionHint ? "cancellation-action-hint" : undefined}
                onClick={() => {
                  if (!canConfirm) return;
                  void mutate("cancellation", "POST", cancellationMode === "no_refund"
                    ? { reason, refund_mode: "no_refund", confirmed_no_refund: true }
                    : { reason, refund_mode: "refund", confirmed_deposit: true, expected_refund_amount: refundAmount });
                }}>
                {cancellationMode === "no_refund" ? "ยืนยันยกเลิก — ไม่คืนมัดจำ"
                  : cancellationMode === "refund" ? `ยืนยันยกเลิก — รอคืนมัดจำ ${amountLabel}` : "ยืนยันยกเลิก"}
              </button>
              {actionHint && <p id="cancellation-action-hint" className={styles.actionHint}>{actionHint}</p>}
            </>}
          </fieldset> : <>
            <div className={`${styles.statusCard} ${c.refund_status === "refunded" ? styles.completed : ""}`}>
              <p className={styles.eyebrow}>สถานะรายการ</p><h3>{cancellationLabel(c)}</h3>
              <dl className={styles.history}>
                <div><dt>ยกเลิกเมื่อ</dt><dd>{date(c.cancelled_at)}</dd></div>
                <div><dt>ผู้ทำรายการ</dt><dd>{c.cancelled_by_username}</dd></div>
                <div><dt>เหตุผล</dt><dd>{c.reason}</dd></div>
              </dl>
            </div>
            <p className={styles.warning}><span aria-hidden="true">!</span> กรณีการยกเลิกถูกยืนยันแล้ว ไม่สามารถสลับเป็นอีกกรณีได้</p>
            {c.refund_status === "not_entitled" && <p className={styles.description}>รายการนี้ไม่คืนมัดจำ ไม่มีงานคืนเงิน และไม่ต้องแนบหลักฐานโอนคืน</p>}
            {c.refund_status === "pending" && <>
              <p className={styles.description}>กดรับงานก่อนโอนเงิน เพื่อกันแอดมินสองคนโอนซ้ำ ระบบไม่ได้โอนเงินให้อัตโนมัติ</p>
              <button type="button" disabled={busy || !validAmount} className={styles.primaryButton} onClick={() => mutate("refund", "PATCH", { action: "claim", expected_refund_amount: refundAmount })}>รับงานคืนมัดจำ {amountLabel}</button>
            </>}
            {c.refund_status === "processing" && <>
              <p className={styles.description}>ผู้รับงาน: <strong>{c.processing_by_username}</strong> · {c.processing_at ? date(c.processing_at) : ""}</p>
              {!details.can_manage_refund ? <p role="alert" className={styles.error}>แอดมินคนอื่นกำลังคืนเงิน ห้ามโอนซ้ำ กรุณาประสานผู้รับงาน</p> : <fieldset disabled={busy || !validAmount} className={styles.form}>
                <p className={styles.description}>ตรวจสอบบัญชีปลายทางกับลูกค้าและโอนคืนเอง {amountLabel} จากนั้นบันทึกหลักฐานด้านล่าง หากโอนแล้วห้ามคืนงานหรือโอนซ้ำ</p>
                <label className={styles.inputLabel}>เลขอ้างอิงธุรกรรมโอนคืน
                  <input value={reference} onChange={e => setReference(e.target.value)} maxLength={120} autoComplete="off" placeholder="เลขอ้างอิงจากรายการโอนจริง" className={styles.field} />
                </label>
                <label className={styles.inputLabel}>ภาพหลักฐานโอนคืน (JPG / PNG / WebP ไม่เกิน 5 MB)
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setProof(e.target.files?.[0] ?? null)} className={`${styles.field} ${styles.fileInput}`} />
                </label>
                <label className={styles.confirmation}>
                  <input type="checkbox" checked={transferred} onChange={e => setTransferred(e.target.checked)} /><span>โอนคืนให้ลูกค้าแล้ว {amountLabel} และหลักฐานเป็นของรายการนี้</span>
                </label>
                <button type="button" disabled={!proof || reference.trim().length < 3 || !transferred} className={styles.primaryButton} onClick={() => {
                  if (!proof) return;
                  const form = new FormData(); form.set("proof", proof); form.set("reference", reference); form.set("transferred", "true");
                  form.set("expected_refund_amount", String(refundAmount));
                  void mutate("refund", "POST", form);
                }}>บันทึกคืนมัดจำแล้ว {amountLabel}</button>
                <button type="button" className={styles.releaseButton} onClick={() => {
                  if (window.confirm("ยืนยันว่าคุณยังไม่ได้โอนเงินและไม่มีรายการโอนค้างอยู่? ห้ามคืนงานหากโอนไปแล้ว เพราะผู้อื่นอาจโอนซ้ำ")) {
                    void mutate("refund", "PATCH", { action: "release", not_transferred: true });
                  }
                }}>ยังไม่ได้โอน — คืนงานให้แอดมินคนอื่น</button>
              </fieldset>}
            </>}
            {c.refund_status === "refunded" && <>
              <dl className={styles.history}>
                <div><dt>บันทึกคืนเงินเมื่อ</dt><dd>{c.refunded_at ? date(c.refunded_at) : "-"}</dd></div>
                <div><dt>ผู้คืนเงิน</dt><dd>{c.refunded_by_username}</dd></div>
                <div><dt>เลขอ้างอิง</dt><dd>{c.refund_reference}</dd></div>
              </dl>
              <p className={styles.success}><strong>คืนเงินแล้ว ห้ามโอนซ้ำ</strong></p>
              <button type="button" onClick={viewProof} className={styles.secondaryButton}>ดูหลักฐานคืนเงิน</button>
              {proofUrl && <p><a className={styles.proofLink} href={proofUrl} target="_blank" rel="noreferrer">เปิดภาพหลักฐานคืนเงิน ↗</a></p>}
            </>}
          </>}
        </>}
        {busy && <p role="status" className={styles.loading}>กำลังบันทึกและตรวจสอบสถานะล่าสุด...</p>}
        </div>
        <footer className={styles.footer}>
          <div><button type="button" disabled={busy} onClick={() => { setError(""); void reload().catch(e => setError(e.message)); }} className={styles.refreshButton}><span aria-hidden="true">↻</span> โหลดสถานะล่าสุด</button>
            <p>ดูข้อมูลล่าสุด ไม่ทำรายการซ้ำ</p></div>
          <button type="button" disabled={busy} onClick={close} className={styles.secondaryButton}>ปิด</button>
        </footer>
      </section>
    </div>
  );
}
