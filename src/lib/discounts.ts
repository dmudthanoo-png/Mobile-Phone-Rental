export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
export const normalizeDiscountCode = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : "";
export type DiscountQuote = {
  code: string; discount_amount: number; subtotal_amount: number;
  total_amount: number; deposit_amount: number; expires_at: string;
};
export type DiscountHold = DiscountQuote & { booking_id: string };

export function validDiscountQuote(value: unknown): value is DiscountQuote {
  const q = value as DiscountQuote | null;
  return !!q && DISCOUNT_CODE_PATTERN.test(q.code ?? "") &&
    [q.discount_amount,q.subtotal_amount,q.total_amount,q.deposit_amount].every(n => Number.isSafeInteger(n) && n >= 0) &&
    q.discount_amount > 0 && q.total_amount + q.discount_amount === q.subtotal_amount &&
    q.total_amount >= q.deposit_amount && Number.isFinite(Date.parse(q.expires_at));
}

export const discountErrors: Record<string,string> = {
  DISCOUNT_UNAVAILABLE: "ไม่พบโค้ดนี้ หรือโค้ดถูกพัก/ลบแล้ว",
  DISCOUNT_NOT_STARTED: "โค้ดนี้ยังไม่ถึงเวลาเริ่มใช้งาน",
  DISCOUNT_EXPIRED: "โค้ดนี้หมดอายุแล้ว",
  DISCOUNT_ALREADY_USED: "บัญชีนี้ใช้โค้ดนี้แล้ว ใช้ซ้ำกับการจองใหม่ไม่ได้",
  DISCOUNT_BELOW_DEPOSIT: "ใช้ส่วนลดนี้ไม่ได้ เพราะยอดหลังลดต่ำกว่ามัดจำ",
  DISCOUNT_CHANGED: "เงื่อนไขส่วนลดเปลี่ยนแล้ว กรุณากดใช้โค้ดใหม่เพื่อตรวจสอบยอด",
  DISCOUNT_HOLD_EXPIRED: "การกันเครื่องและส่วนลดหมดเวลาแล้ว กรุณาติดต่อร้านหากโอนแล้ว ห้ามโอนซ้ำ",
  DISCOUNT_HOLD_MISMATCH: "ข้อมูลไม่ตรงกับรายการที่กันไว้ กรุณาตรวจสอบรายการ ห้ามโอนซ้ำ",
  DISCOUNT_CODE_EXISTS: "โค้ดนี้มีอยู่แล้ว รวมถึงโค้ดที่เคยลบ กรุณาใช้ชื่อโค้ดใหม่",
  DISCOUNT_CODE_READ_ONLY: "เปลี่ยนรหัสโค้ดเดิมไม่ได้ กรุณาสร้างโค้ดใหม่",
  DISCOUNT_DELETED: "โค้ดนี้ถูกลบแล้ว",
  INVALID_DISCOUNT: "กรุณาตรวจสอบโค้ด จำนวนส่วนลด และช่วงเวลาให้ถูกต้อง",
  INVALID_QUANTITY: "จำนวนเครื่องหรือเลนส์ไม่ถูกต้อง",
  TOO_MANY_PENDING: "มีการจองที่รอยืนยันอยู่แล้ว กรุณารอให้แอดมินตรวจสอบก่อน",
  SESSION_UNAVAILABLE: "รอบนี้ไม่เปิดให้จองแล้ว", PHONE_UNAVAILABLE: "มือถือรุ่นนี้ไม่พร้อมให้จอง",
  LENS_UNAVAILABLE: "เลนส์นี้ไม่พร้อมให้จอง", NOT_FOUND: "ไม่พบรายการ",
  UNAUTHORIZED: "ไม่มีสิทธิ์ดำเนินการ", INVALID_ACTION: "คำสั่งไม่ถูกต้อง",
};

// datetime-local in the admin form always means Thailand time, not the device zone.
export function thaiDateTimeInput(iso: string) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time + 7*60*60*1000).toISOString().slice(0,16) : "";
}
export function thaiDateTimeISO(local: string) {
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? Date.parse(`${local}:00+07:00`) : NaN;
  return Number.isFinite(time) && thaiDateTimeInput(new Date(time).toISOString()) === local ? new Date(time).toISOString() : "";
}
