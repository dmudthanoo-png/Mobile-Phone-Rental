import { createClient } from "@supabase/supabase-js";
import { downloadSlipBuffer } from "@/lib/slipStorage";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// รูปแบบ response ของ SlipOK — อิงตามเอกสารที่ทราบ แต่ field อาจต่างกันเล็กน้อย
// ตามบัญชี/แพ็กเกจจริง จึงพยายามอ่านแบบยืดหยุ่น (ลองหลายชื่อ field)
type SlipOkAccount = {
  name?: { th?: string; en?: string } | string;
  bank?: { id?: string; name?: string; short?: string };
  account?: { name?: { th?: string; en?: string }; bank?: { account?: string }; value?: string; type?: string };
  proxy?: { type?: string; account?: string; value?: string };
  displayName?: string;
};

type SlipOkResponse = {
  success?: boolean;
  message?: string;
  code?: number;
  data?: {
    code?: number;
    success?: boolean;
    message?: string;
    amount?: number;
    transRef?: string;
    transactionRef?: string;
    date?: string;
    receiver?: SlipOkAccount;
    receivingBank?: string;
  };
  receiver?: SlipOkAccount;
};

// ดึงข้อความทุกอย่างที่บอก "ผู้รับเงิน" ออกมาเป็นก้อนเดียว เพื่อเอาไปเทียบกับบัญชีร้าน
// (SlipOK คืนโครงสร้างต่างกันได้ตามธนาคาร/แพ็กเกจ จึงกวาดทุกชั้นแทนการอ่านเฉพาะ field เดียว)
function collectReceiverText(v: unknown, depth = 0): string {
  if (v == null || depth > 5) return "";
  if (typeof v === "string" || typeof v === "number") return " " + String(v);
  if (Array.isArray(v)) return v.map((x) => collectReceiverText(x, depth + 1)).join("");
  if (typeof v === "object") {
    return Object.values(v as Record<string, unknown>)
      .map((x) => collectReceiverText(x, depth + 1))
      .join("");
  }
  return "";
}

// เทียบแบบหลวมๆ: ตัดอักขระที่ไม่ใช่ตัวเลข/ตัวอักษรออก แล้วดูว่ามีคำที่ร้านตั้งไว้อยู่ไหม
function normalizeForMatch(s: string) {
  // หมายเหตุ: ต้องวางขีดกลางไว้ท้ายสุดของ [] ไม่งั้นจะกลายเป็น "ช่วงอักขระ" แล้วกินตัวอักษรไทยหมด
  return s.toLowerCase().replace(/[\s.,()฿*x×–—_-]/g, "");
}

export type SlipVerifyResult = {
  ok: true;
  verified: boolean;
  message: string;
  amount: number | null;
  expected_amount: number;
  trans_ref: string | null;
  raw: SlipOkResponse | null;
} | {
  ok: false;
  error: string;
};

/**
 * ตรวจสอบสลิปของ booking หนึ่งรายการผ่าน SlipOK แล้วบันทึกผลลง DB
 * ใช้ได้ทั้งแบบ "auto" (เรียกจาก upload-slip / update-slip แบบ best-effort)
 * และแบบ "manual" (แอดมินกดปุ่มตรวจสอบเอง)
 *
 * คืนค่า { ok:false, error } ถ้าเรียกไม่สำเร็จ — ผู้เรียกเลือกได้เองว่าจะ
 * โยน error ต่อ (กรณี manual) หรือแค่ log แล้วไปต่อ (กรณี auto/best-effort)
 */
export async function verifySlipForBooking(bookingId: string): Promise<SlipVerifyResult> {
  const apiUrl = process.env.SLIPOK_API_URL;
  const apiKey = process.env.SLIPOK_API_KEY;
  if (!apiUrl || !apiKey) {
    return { ok: false, error: "missing SLIPOK_API_URL / SLIPOK_API_KEY env" };
  }

  const supabase = getSupabase();

  // 0) เช็คว่าแอดมินปิดการตรวจสอบอัตโนมัติไว้ไหม (เช่น โควต้า SlipOK หมด)
  const { data: settings } = await supabase
    .from("app_settings")
    .select("slipok_enabled")
    .eq("id", true)
    .maybeSingle();

  if (settings?.slipok_enabled === false) {
    return { ok: false, error: "slipok_disabled_by_admin" };
  }

  // 1) ดึงข้อมูล booking + มัดจำต่อเครื่องของรุ่นนั้น (ยอดที่ควรจะโอนมา = มัดจำ x จำนวนเครื่อง)
  const { data: bookingRaw, error: bErr } = await supabase
    .from("bookings")
    .select("id, slip_url, qty, deposit_amount, phones ( deposit )")
    .eq("id", bookingId)
    .maybeSingle();

  if (bErr) return { ok: false, error: bErr.message };
  if (!bookingRaw) return { ok: false, error: "booking not found" };

  const booking = bookingRaw as unknown as { id: string; slip_url: string | null; qty: number | null; deposit_amount: number | null; phones: { deposit: number } | null };
  if (!booking.slip_url) return { ok: false, error: "booking has no slip" };

  // ใช้ยอดมัดจำที่บันทึกไว้ตอนจองเป็นหลัก — ถ้าคิดสดจากราคาปัจจุบันจะเพี้ยน 2 กรณี:
  // (1) แอดมินแก้ราคามัดจำทีหลัง แล้วตรวจสลิปเก่าซ้ำ  (2) กรณีมัดจำถูกจำกัดไม่ให้เกินยอดรวม
  const expectedAmount = booking.deposit_amount != null
    ? Number(booking.deposit_amount)
    : Number(booking.phones?.deposit ?? 0) * Number(booking.qty ?? 1);

  // 2) โหลดรูปสลิปจาก Supabase Storage ผ่าน service role โดยตรง
  //    (ใช้ได้ทั้งตอน bucket เป็น public หรือ private — ไม่ต้องพึ่ง URL สาธารณะ)
  const downloaded = await downloadSlipBuffer(booking.slip_url);
  if (!downloaded) return { ok: false, error: "cannot fetch slip image" };

  const { buffer: slipBuffer, contentType } = downloaded;

  // 3) ส่งไปให้ SlipOK ตรวจสอบ
  let slipOkResult: SlipOkResponse | null = null;
  let slipOkOk = false;
  try {
    const form = new FormData();
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    form.append("files", new Blob([slipBuffer], { type: contentType }), `slip.${ext}`);
    form.append("amount", String(expectedAmount));
    // ขอให้ SlipOK บันทึก/ตรวจกับบัญชีที่ผูกไว้กับสาขา และคืนข้อมูลผู้รับเงินกลับมา
    form.append("log", "true");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let slipOkRes: Response;
    try {
      slipOkRes = await fetch(apiUrl, {
        method: "POST",
        headers: { "x-authorization": apiKey },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    slipOkResult = await slipOkRes.json().catch(() => null);
    slipOkOk = slipOkRes.ok;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: isTimeout ? "เรียก SlipOK ไม่สำเร็จ: หมดเวลารอ" : `เรียก SlipOK ไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  // 4) แกะผลลัพธ์แบบยืดหยุ่น (รองรับทั้ง success ตรงๆ หรือซ้อนใน data)
  const d: {
    success?: boolean;
    message?: string;
    code?: number;
    amount?: number;
    transRef?: string;
    transactionRef?: string;
  } = slipOkResult?.data ?? slipOkResult ?? {};

  // ── แยกรหัสผลลัพธ์ของ SlipOK ──
  // 1012 = สลิปนี้เคยส่งตรวจแล้ว (ไม่ได้แปลว่าสลิปปลอม)
  // 1014 = สลิปซ้ำในระบบ
  // 1009 = ธนาคารขัดข้อง, 1010 = ข้อมูลยังไม่เข้าระบบธนาคาร ให้ลองใหม่ภายหลัง
  const rawCode = slipOkResult?.code ?? d.code ?? null;
  const code = rawCode != null ? Number(rawCode) : null;
  const isDuplicateCode = code === 1012 || code === 1014;
  const isRetryableCode = code === 1009 || code === 1010;

  // ⚠️ success ต้องเป็นจริง "ทั้งชั้นนอกและชั้นใน" ถ้ามีค่า
  // เดิมใช้ ?? ทำให้ชั้นนอก true บังชั้นใน false ได้
  const outerSuccess = slipOkResult?.success;
  const innerSuccess = d.success;
  const slipOkSuccess =
    outerSuccess === false || innerSuccess === false
      ? false
      : Boolean(outerSuccess ?? innerSuccess);

  // ⚠️ ข้อความ error ชั้นนอกต้องมาก่อน ไม่งั้นรหัสที่ "ไม่ผ่าน" อาจแสดงข้อความของ data ที่ดูเหมือนผ่าน
  const message = !slipOkSuccess
    ? (slipOkResult?.message || d.message || "ตรวจสอบไม่ผ่าน")
    : (d.message || slipOkResult?.message || "ตรวจสอบผ่าน");
  const readAmount = d.amount != null ? Number(d.amount) : null;
  const transRef = d.transRef || d.transactionRef || null;

  const amountMatches = readAmount != null ? Math.abs(readAmount - expectedAmount) < 1 : null;

  // ── ตรวจว่าเงินเข้าบัญชีของร้านจริง ──
  // ถ้าไม่ตรวจ สลิปที่โอนเข้าบัญชีคนอื่นแต่ยอดตรงพอดี จะขึ้นว่า "ตรวจสอบผ่าน" ได้
  // ตั้งชื่อ/เลขบัญชีร้านไว้ใน SLIPOK_RECEIVER_MATCH (คั่นด้วยจุลภาคได้หลายค่า เช่น เลขบัญชี 4 ตัวท้าย + ชื่อบัญชี)
  // ไม่ได้ตั้งไว้ = ข้ามการตรวจนี้ แต่จะไม่ตีตราว่า "ผ่าน" เต็มปาก และเตือนให้แอดมินดูเอง
  const receiverExpect = (process.env.SLIPOK_RECEIVER_MATCH ?? "")
    .split(",").map((x) => normalizeForMatch(x.trim())).filter(Boolean);
  const receiverText = normalizeForMatch(
    collectReceiverText(slipOkResult?.data?.receiver ?? slipOkResult?.receiver ?? null) +
    collectReceiverText(slipOkResult?.data?.receivingBank ?? null)
  );
  const receiverConfigured = receiverExpect.length > 0;
  const receiverKnown = receiverText.length > 0;
  const receiverMatches = receiverConfigured && receiverKnown
    ? receiverExpect.some((exp) => receiverText.includes(exp))
    : null;

  // ── ตัดสินผล ──
  // "ผ่าน" ต้องพิสูจน์ได้ครบจริงเท่านั้น: ยอดตรง + บัญชีปลายทางตรง + มีเลขอ้างอิงให้กันสลิปซ้ำได้
  // ถ้าข้อมูลไม่ครบ = "ตรวจไม่ครบ ต้องดูเอง" ไม่ใช่ "ผ่าน" (เดิมข้อมูลขาดแล้วยังตีว่าผ่าน)
  const missing: string[] = [];
  if (readAmount == null) missing.push("ไม่มีข้อมูลยอดเงิน");
  if (!receiverConfigured) missing.push("ยังไม่ได้ตั้งค่าบัญชีร้าน");
  else if (!receiverKnown) missing.push("ไม่มีข้อมูลบัญชีผู้รับ");
  if (!transRef) missing.push("ไม่มีเลขอ้างอิงรายการ");

  const hardFail =
    !slipOkOk ||
    (!slipOkSuccess && !isDuplicateCode && !isRetryableCode) ||
    amountMatches === false ||
    receiverMatches === false;

  let verified = !hardFail && missing.length === 0;

  let finalMessage = message;
  // ตัดข้อมูลผู้รับที่ SlipOK ส่งมาแบบย่อ ไว้ช่วยวินิจฉัยตอนตั้งค่าครั้งแรก
  // (เป็นข้อมูลบัญชีปลายทาง = ของร้านเอง ไม่ใช่ข้อมูลผู้โอน)
  const receiverHint = receiverText.slice(0, 90);

  if (isRetryableCode) {
    // ธนาคารขัดข้อง / ข้อมูลยังไม่เข้าระบบ — ยังสรุปไม่ได้ ต้องกดตรวจใหม่ภายหลัง
    finalMessage = "⏳ ยังตรวจไม่ได้ตอนนี้ (" + message + ") กรุณากดตรวจสอบสลิปอีกครั้งในภายหลัง";
  } else if (receiverMatches === false) {
    finalMessage =
      "บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของร้าน กรุณาตรวจสอบด้วยตนเอง" +
      " [ข้อมูลผู้รับที่อ่านได้: " + receiverHint + "]";
  } else if (amountMatches === false) {
    // ข้อความยอดไม่ตรงถูกตั้งไว้ด้านล่างอยู่แล้ว ไม่ต้องทำอะไรตรงนี้
  } else if (isDuplicateCode) {
    finalMessage = "สลิปนี้เคยถูกส่งตรวจมาก่อนแล้ว (" + message + ") กรุณาตรวจสอบด้วยตนเอง";
  } else if (!verified && missing.length > 0 && !hardFail) {
    finalMessage = "⚠️ ตรวจสอบอัตโนมัติไม่ครบ ต้องตรวจด้วยตนเอง — " + missing.join(", ");
  }
  if (slipOkOk && slipOkSuccess && amountMatches === false) {
    finalMessage = `ยอดเงินไม่ตรง: สลิปแจ้ง ฿${readAmount} แต่ควรเป็น ฿${expectedAmount}`;
  }

  // 4.5) กันสลิปใบเดียวกัน (transaction reference เดียวกัน) ถูกใช้ยืนยัน booking อื่นไปแล้ว
  // เช็คก่อนเขียนลง DB (มี unique index เป็นด่านสุดท้ายกันเรื่อง race ซ้ำอีกชั้นด้วย)
  if (verified && transRef) {
    const { data: dup } = await supabase
      .from("bookings")
      .select("id")
      .eq("slip_verify_ref", transRef)
      .eq("slip_verified", true)
      .neq("id", bookingId)
      .maybeSingle();

    if (dup) {
      verified = false;
      finalMessage = "สลิปนี้เคยถูกใช้ยืนยันการจองรายการอื่นไปแล้ว";
    }
  }

  // 5) บันทึกผลลง booking
  // ⚠️ ต้องผูกกับ "สลิปใบที่ตรวจ" ด้วย ไม่ใช่แค่ booking_id
  // ระหว่างที่รอ SlipOK ตอบ (นานได้ถึง 15 วิ และรันเบื้องหลัง) ลูกค้าอาจเปลี่ยนสลิปไปแล้ว
  // ถ้าเขียนด้วย id อย่างเดียว ผล "ผ่าน" ของใบเก่าจะไปติดกับใบใหม่ที่ยังไม่ได้ตรวจ
  const { error: updErr, count: updatedCount } = await supabase
    .from("bookings")
    .update({
      slip_verified: verified,
      slip_verify_message: finalMessage,
      slip_verify_amount: readAmount,
      slip_verify_ref: transRef,
      slip_verified_at: new Date().toISOString(),
    }, { count: "exact" })
    .eq("id", bookingId)
    .eq("slip_url", booking.slip_url);

  if (!updErr && !updatedCount) {
    // สลิปถูกเปลี่ยนไปแล้วระหว่างรอผล — ทิ้งผลนี้ไป ใบใหม่จะมีการตรวจของตัวเองตามมา
    return {
      ok: true, verified: false,
      message: "สลิปถูกเปลี่ยนระหว่างรอผลตรวจ ระบบจึงไม่นำผลเดิมมาใช้",
      amount: readAmount, expected_amount: expectedAmount, trans_ref: transRef, raw: slipOkResult,
    };
  }

  if (updErr) {
    // unique_violation = อีก request หนึ่งเพิ่ง verify สลิปเดียวกันสำเร็จไปพร้อมกันพอดี (race)
    // ให้ถือว่าไม่ verified แทนที่จะโยน error ดิบออกไป
    if ((updErr as { code?: string }).code === "23505") {
      // ⚠️ ต้องผูกกับสลิปใบที่ตรวจเหมือนทางปกติ ไม่งั้นผลของใบเก่าจะเขียนทับใบใหม่ได้
      await supabase
        .from("bookings")
        .update({
          slip_verified: false,
          slip_verify_message: "สลิปนี้เคยถูกใช้ยืนยันการจองรายการอื่นไปแล้ว",
          slip_verify_amount: readAmount,
          slip_verify_ref: transRef,
          slip_verified_at: new Date().toISOString(),
        })
        .eq("id", bookingId)
        .eq("slip_url", booking.slip_url);

      return {
        ok: true,
        verified: false,
        message: "สลิปนี้เคยถูกใช้ยืนยันการจองรายการอื่นไปแล้ว",
        amount: readAmount,
        expected_amount: expectedAmount,
        trans_ref: transRef,
        raw: slipOkResult,
      };
    }
    return { ok: false, error: updErr.message };
  }

  return {
    ok: true,
    verified,
    message: finalMessage,
    amount: readAmount,
    expected_amount: expectedAmount,
    trans_ref: transRef,
    raw: slipOkResult,
  };
}
