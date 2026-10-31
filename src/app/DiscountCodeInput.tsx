"use client";
import { useEffect, useRef, useState } from "react";
import { normalizeDiscountCode, validDiscountQuote, type DiscountQuote } from "@/lib/discounts";
import styles from "./DiscountCodeInput.module.css";
type Props = { value:string; quote:DiscountQuote|null; disabled:boolean;
  cart:{session_id:string|null;phone_id:string|null;qty:number;lens_id:string|null;lens_qty:number};
  onChange:(value:string)=>void;onApply:(quote:DiscountQuote|null)=>void; };
export default function DiscountCodeInput({value,quote,disabled,cart,onChange,onApply}:Props) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function apply() {
    if(busy||disabled)return;
    const controller=new AbortController();request.current?.abort();request.current=controller;
    setBusy(true);setError("");onApply(null);
    try {
      const res=await fetch("/api/bookings/discount",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...cart,code:normalizeDiscountCode(value)}),cache:"no-store",signal:controller.signal});
      const out=await res.json();if(!res.ok)throw new Error(out.error||"ตรวจสอบโค้ดไม่สำเร็จ");
      if(!validDiscountQuote(out))throw new Error("ข้อมูลส่วนลดไม่ครบ กรุณาลองใหม่");
      if(!controller.signal.aborted)onApply(out);
    } catch(e) {if(!controller.signal.aborted){onApply(null);setError(e instanceof Error?e.message:"ตรวจสอบโค้ดไม่สำเร็จ");}}
    finally {if(!controller.signal.aborted)setBusy(false);}
  }
  return <section className={styles.box} aria-label="โค้ดส่วนลด">
    <label htmlFor="booking-discount-code" className={styles.label}>โค้ดส่วนลด <span>(ถ้ามี)</span></label>
    <div className={styles.row}>
      <input id="booking-discount-code" value={value} maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false}
        placeholder="เช่น CRABBY50" disabled={busy||disabled} onChange={e=>{onChange(e.target.value);setError("");}}
        aria-describedby="discount-feedback" onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void apply();}}}/>
      <button type="button" disabled={busy||disabled||!value.trim()} onClick={()=>void apply()}>{busy?"กำลังตรวจ…":"ใช้โค้ด"}</button>
    </div>
    <div id="discount-feedback" aria-live="polite">
      {quote ? <p className={styles.success}>ใช้ {quote.code} ลด {quote.discount_amount.toLocaleString("th-TH")} บาท
        <button type="button" className={styles.remove} disabled={disabled||busy} onClick={()=>{onChange("");setError("");}}>นำออก</button></p>
        :error?<p role="alert" className={styles.error}>{error}</p>
          :<p className={styles.hint}>{value.trim()?"กดใช้โค้ดให้สำเร็จก่อน หรือเอาโค้ดออกเพื่อจองราคาปกติ":"ลดจากยอดรวมเครื่องและเลนส์ · ไม่ลดมัดจำ · บัญชีละ 1 ครั้งต่อโค้ด"}</p>}
    </div>
  </section>;
}
