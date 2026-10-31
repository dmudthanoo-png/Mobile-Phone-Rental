"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DISCOUNT_CODE_PATTERN, normalizeDiscountCode, thaiDateTimeInput, thaiDateTimeISO } from "@/lib/discounts";
import styles from "./DiscountCodesPanel.module.css";
type Code={id:string;code:string;name:string;amount:number;starts_at:string;expires_at:string;active:boolean;deleted_at:string|null;
  used_count:number;discount_total:number;confirmed_discount_total:number};
type Usage={booking_id:string|null;ref_number:string;amount:number;consumed_at:string;renter_name:string|null;status:string|null;total_amount:number|null};
type Form={id:string|null;code:string;name:string;amount:string;start:string;end:string;active:boolean};
const freshForm=():Form=>({id:null,code:"",name:"",amount:"50",start:thaiDateTimeInput(new Date().toISOString()),
  end:thaiDateTimeInput(new Date(Date.now()+7*86400000).toISOString()),active:true});
const amount=(n:number)=>Number(n).toLocaleString("th-TH");
const date=(value:string)=>new Date(value).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"medium",timeStyle:"short"});
const statusText:Record<string,string>={pending:"รอตรวจสอบ",confirmed:"ยืนยันแล้ว",rejected:"ปฏิเสธ",cancelled:"ยกเลิกแล้ว"};
export default function DiscountCodesPanel(){
  const [codes,setCodes]=useState<Code[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[deleted,setDeleted]=useState(false);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [form,setForm]=useState<Form|null>(null),[history,setHistory]=useState<Code|null>(null),[uses,setUses]=useState<Usage[]>([]);
  const [usagePage,setUsagePage]=useState(0),[usageTotal,setUsageTotal]=useState(0),[usageLoading,setUsageLoading]=useState(false),[usageError,setUsageError]=useState("");
  const mutation=useRef(false),readVersion=useRef(0),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const reload=useCallback(async()=>{
    const version=++readVersion.current;setLoading(true);setError("");
    try{
      const res=await fetch(`/api/admin/discount-codes?page=${page}&deleted=${deleted}`,{cache:"no-store"});
      const out=await res.json();if(!res.ok)throw new Error(out.error||"โหลดโค้ดไม่สำเร็จ");
      if(mounted.current&&version===readVersion.current){setCodes(out.codes??[]);setTotal(Number(out.total)||0);}
    }catch(e){if(mounted.current&&version===readVersion.current)setError(e instanceof Error?e.message:"โหลดโค้ดไม่สำเร็จ");}
    finally{if(mounted.current&&version===readVersion.current)setLoading(false);}
  },[page,deleted]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{
    if(!history)return;
    const controller=new AbortController();setUsageLoading(true);setUsageError("");setUses([]);
    fetch(`/api/admin/discount-codes?id=${history.id}&page=${usagePage}`,{cache:"no-store",signal:controller.signal})
      .then(async res=>{const out=await res.json();if(!res.ok)throw new Error(out.error||"โหลดประวัติไม่สำเร็จ");return out;})
      .then(out=>{if(!controller.signal.aborted){setUses(out.uses??[]);setUsageTotal(Number(out.total)||0);}})
      .catch(e=>{if(!controller.signal.aborted)setUsageError(e instanceof Error?e.message:"โหลดประวัติไม่สำเร็จ");})
      .finally(()=>{if(!controller.signal.aborted)setUsageLoading(false);});
    return()=>controller.abort();
  },[history,usagePage]);
  async function save(body:object){
    if(mutation.current)return;mutation.current=true;setBusy(true);setError("");
    try{
      const res=await fetch("/api/admin/discount-codes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
      const out=await res.json();if(!res.ok||out.ok!==true)throw new Error(out.error||"ยังยืนยันผลไม่ได้ กรุณาโหลดรายการล่าสุดก่อนทำซ้ำ");
      if(mounted.current){setForm(null);await reload();}
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  function submit(){
    if(!form)return;
    const code=normalizeDiscountCode(form.code),value=Number(form.amount),start=thaiDateTimeISO(form.start),end=thaiDateTimeISO(form.end);
    if(!DISCOUNT_CODE_PATTERN.test(code)||!form.name.trim()||!Number.isInteger(value)||value<1||value>1000000||!start||!end||Date.parse(end)<=Date.parse(start)){
      setError("กรอกโค้ด 3–32 ตัว (A–Z, 0–9, _ หรือ -) จำนวนเต็ม 1–1,000,000 บาท และเวลาหมดอายุต้องอยู่หลังเวลาเริ่ม");return;
    }
    void save({action:form.id?"update":"create",id:form.id,code,name:form.name.trim(),amount:value,starts_at:start,expires_at:end,active:form.active});
  }
  function edit(c:Code){setForm({id:c.id,code:c.code,name:c.name,amount:String(c.amount),start:thaiDateTimeInput(c.starts_at),end:thaiDateTimeInput(c.expires_at),active:c.active});setError("");}
  return <section className={styles.panel} aria-label="จัดการโค้ดส่วนลด">
    <div className={styles.heading}><div><h2>โค้ดส่วนลด</h2><p>ลดเป็นบาทจากยอดรวม · ทุกคอนเสิร์ต · บัญชีละ 1 ครั้งต่อโค้ด · ไม่จำกัดสิทธิ์รวม</p></div>
      <button type="button" className={styles.primary} disabled={busy} onClick={()=>{setForm(freshForm());setError("");}}>+ สร้างโค้ด</button></div>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {form&&<form onSubmit={e=>{e.preventDefault();submit();}} className={styles.card}>
      <h3>{form.id?`แก้ไข ${form.code}`:"สร้างโค้ดส่วนลด"}</h3>
      <fieldset disabled={busy} className={styles.fields}>
        <label>รหัสโค้ด<input value={form.code} readOnly={!!form.id} maxLength={32} required autoComplete="off" spellCheck={false} autoCapitalize="characters" onChange={e=>setForm({...form,code:normalizeDiscountCode(e.target.value)})}/></label>
        <label>ชื่อโปรโมชัน<input value={form.name} maxLength={100} required onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>ลดกี่บาทต่อการจอง<input type="number" inputMode="numeric" min={1} max={1000000} step={1} value={form.amount} required onChange={e=>setForm({...form,amount:e.target.value})}/></label>
        <label>เริ่มใช้ (เวลาไทย)<input type="datetime-local" value={form.start} required onChange={e=>setForm({...form,start:e.target.value})}/></label>
        <label>หมดอายุ (เวลาไทย)<input type="datetime-local" value={form.end} required onChange={e=>setForm({...form,end:e.target.value})}/></label>
        <label className={styles.check}><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> เปิดใช้งาน</label>
      </fieldset>
      <p className={styles.note}>ไม่ลดมัดจำ · แก้เงื่อนไขมีผลกับการใช้ใหม่เท่านั้น รายการที่กันส่วนลดไว้แล้วใช้ยอดเดิมจนหมดเวลากันเครื่อง</p>
      {form.id&&<p className={styles.note}>รหัสโค้ดเปลี่ยนไม่ได้ เพื่อรักษาประวัติและสิทธิ์ใช้ครั้งเดียว</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy?"กำลังบันทึก…":"บันทึกโค้ด"}</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>ปิดฟอร์ม</button></div>
    </form>}
    <div className={styles.toolbar}><label className={styles.check}><input type="checkbox" checked={deleted} disabled={busy} onChange={e=>{setDeleted(e.target.checked);setPage(0);}}/> แสดงโค้ดที่ลบแล้ว</label>
      <button type="button" disabled={busy||loading} onClick={()=>void reload()}>โหลดรายการล่าสุด</button></div>
    <p className={styles.note}>“ยอดส่วนลดที่ใช้” รวมรายการรอตรวจ ปฏิเสธ และยกเลิก แยกจากยอดส่วนลดของรายการยืนยันแล้วด้านล่าง</p>
    {loading?<p role="status">กำลังโหลด…</p>:<div className={styles.grid}>{codes.map(c=>{
      const now=Date.now(),state=c.deleted_at?"ลบแล้ว":!c.active?"พักใช้งาน":now>=Date.parse(c.expires_at)?"หมดอายุ":now<Date.parse(c.starts_at)?"ยังไม่เริ่ม":"ใช้งานได้";
      return <article key={c.id} className={styles.card}>
        <div className={styles.codeRow}><h3>{c.code}</h3><span className={styles.badge}>{state}</span></div><p>{c.name}</p>
        <div className={styles.value}>ลด {amount(c.amount)} บาท</div>
        <p className={styles.note}>{date(c.starts_at)} — {date(c.expires_at)} (ไทย)</p>
        <dl><div><dt>ใช้แล้ว</dt><dd>{amount(c.used_count)} บัญชี</dd></div><div><dt>ยอดส่วนลดที่ใช้</dt><dd>{amount(c.discount_total)} บาท</dd></div>
          <div><dt>เฉพาะการจองยืนยันแล้ว</dt><dd>{amount(c.confirmed_discount_total)} บาท</dd></div></dl>
        <div className={styles.actions}><button type="button" onClick={()=>{setHistory(c);setUsagePage(0);}}>ดูประวัติ</button>
          {!c.deleted_at&&<><button type="button" disabled={busy} onClick={()=>edit(c)}>แก้ไข</button>
            <button type="button" disabled={busy} onClick={()=>void save({id:c.id,action:"set_active",active:!c.active})}>{c.active?"พักโค้ด":"เปิดโค้ด"}</button>
            <button type="button" className={styles.danger} disabled={busy} onClick={()=>{if(window.confirm(`ลบโค้ด ${c.code}? จะหยุดรับการใช้ใหม่ แต่เก็บประวัติและส่วนลดของการจองเดิมไว้`))void save({action:"delete",id:c.id});}}>ลบโค้ด</button></>}
        </div>
      </article>;
    })}{codes.length===0&&<p>ไม่มีโค้ดในรายการนี้</p>}</div>}
    <div className={styles.actions}><button type="button" disabled={loading||page===0} onClick={()=>setPage(page-1)}>ก่อนหน้า</button><span>หน้า {page+1} · {amount(total)} โค้ด</span><button type="button" disabled={loading||(page+1)*50>=total} onClick={()=>setPage(page+1)}>ถัดไป</button></div>
    {history&&<section className={styles.card} aria-label={`ประวัติ ${history.code}`}><div className={styles.heading}><h3>ประวัติใช้ {history.code}</h3><button type="button" onClick={()=>setHistory(null)}>ปิดประวัติ</button></div>
      {usageError&&<p role="alert" className={styles.error}>{usageError}</p>}
      {usageLoading?<p role="status">กำลังโหลดประวัติ…</p>:uses.map(u=><article className={styles.usage} key={u.ref_number}><strong>{u.ref_number}</strong><span>{u.renter_name??"รายการถูกลบแล้ว"} · {statusText[u.status??""]??"ไม่มีรายการจองแล้ว"}</span><span>ส่วนลด {amount(u.amount)} บาท · {date(u.consumed_at)}</span></article>)}
      {!usageLoading&&!usageError&&uses.length===0&&<p>ยังไม่มีการใช้โค้ดที่ส่งสลิปแล้ว</p>}
      <div className={styles.actions}><button type="button" disabled={usageLoading||usagePage===0} onClick={()=>setUsagePage(usagePage-1)}>ก่อนหน้า</button><span>หน้า {usagePage+1} · {amount(usageTotal)} รายการ</span><button type="button" disabled={usageLoading||(usagePage+1)*50>=usageTotal} onClick={()=>setUsagePage(usagePage+1)}>ถัดไป</button></div>
    </section>}
  </section>;
}
