import { logBackgroundError } from "@/lib/apiLog";

// ═══════════════════════════════════════════════════════════════
// ลองใหม่อัตโนมัติเมื่อ query ไป Supabase พลาดแบบ "ชั่วคราว"
//
// ที่มา: 12 ก.ย. 2569 เจอ 500 สองครั้งติดกันภายในนาทีเดียว
// (/api/admin/bookings/summary กับ /api/settings) โดยพังใน 0.11 และ 0.02 วินาที
// เร็วเกินกว่าจะเป็น timeout = Supabase ตอบ error กลับมาทันที
// เดิมไม่มี retry ที่ไหนเลย เน็ตสะดุดแวบเดียวลูกค้าเห็นหน้าพังทันที
//
// ⚠️ ใช้กับ "การอ่าน" เท่านั้น
//    ห้ามเอาไปครอบ insert/update/delete หรือ RPC ที่เขียนข้อมูล เพราะถ้า
//    คำสั่งแรกถึงฐานข้อมูลแล้วแต่คำตอบหายกลางทาง การยิงซ้ำจะเขียนซ้ำสองรอบ
//    (เช่น สร้าง booking ซ้ำ / ตัดสต็อกสองครั้ง)
// ═══════════════════════════════════════════════════════════════

// อาการที่ถือว่า "ลองใหม่แล้วน่าจะหาย" — เน็ต/เกตเวย์ ไม่ใช่ข้อมูลผิด
// ถ้าเป็น error จากตัว query เอง (คอลัมน์ไม่มี, permission, constraint)
// ยิงซ้ำกี่รอบก็ได้ผลเดิม จึงต้องไม่ retry
const TRANSIENT =
  /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|Bad Gateway|Service Unavailable|Gateway Time|too many connections|connection closed|upstream/i;

function isTransient(err: unknown): boolean {
  if (err == null) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object"
        ? String((err as Record<string, unknown>).message ?? "")
        : String(err);
  return TRANSIENT.test(msg);
}

// เช็คจาก HTTP status ของผลลัพธ์ด้วย ไม่ใช่แค่ข้อความ error
//
// ⚠️ สำคัญ: เหตุจริงวันที่ 12 ก.ย. 2569 Supabase ตอบ 504 Gateway Timeout 13 ครั้ง
// (ขณะที่ฐานข้อมูลว่างสนิท CPU 0.8%) — body ของ 504 ที่ gateway ส่งมาไม่ใช่ JSON
// ของ PostgREST ข้อความที่ supabase-js แปลงออกมาจึงอาจไม่มีคำว่า "Gateway Timeout"
// ให้ regex จับได้เลย ถ้าดูแต่ข้อความ retry จะไม่ทำงานในเคสที่ต้องทำงานที่สุด
function isTransientStatus(status: unknown): boolean {
  if (typeof status !== "number") return false;
  // 5xx = ฝั่งเซิร์ฟเวอร์/เกตเวย์ · 408 = request timeout · 429 = ถูกจำกัดอัตรา
  return status >= 500 || status === 408 || status === 429;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * รัน query อ่านข้อมูล แล้วลองใหม่ถ้าพลาดแบบชั่วคราว
 *
 * ต้องส่งเป็น "ฟังก์ชันที่สร้าง query ใหม่" ไม่ใช่ตัว query สำเร็จรูป
 * เพราะ query builder ของ supabase-js ออกแบบมาให้ await ครั้งเดียว
 *
 * คืนค่าหน้าตาเดิมทุกอย่างที่ supabase-js ให้มา (data / error / count / status)
 * ถ้าครบจำนวนครั้งแล้วยังพลาด จะคืน error ครั้งสุดท้ายตามปกติ
 * ยกเว้นกรณี fetch โยน exception ออกมา — จะโยนต่อให้ route จัดการเอง
 *
 * @example
 *   const { data, error } = await retryRead("/api/settings", () =>
 *     supabase.from("app_settings").select("terms_conditions").eq("id", true).maybeSingle()
 *   );
 */
export async function retryRead<R extends { error: unknown; status?: unknown }>(
  scope: string,
  run: () => PromiseLike<R>,
  attempts = 3
): Promise<R> {
  const delays = [150, 400]; // หน่วงก่อนลองรอบถัดไป
  let last: R | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await run();
      if (!res.error) return res; // สำเร็จ
      // ลองใหม่เมื่อ "ข้อความบ่งบอกว่าชั่วคราว" หรือ "HTTP status เป็นฝั่งเซิร์ฟเวอร์"
      // อย่างใดอย่างหนึ่งก็พอ — 504 บางแบบมีแต่ status ไม่มีข้อความที่จับได้
      if (!isTransient(res.error) && !isTransientStatus(res.status)) return res;
      last = res;
      logBackgroundError(
        `${scope} (ลองใหม่ ${i + 1}/${attempts}${typeof res.status === "number" ? ` · HTTP ${res.status}` : ""})`,
        res.error
      );
    } catch (thrown) {
      // network error ระดับ fetch จะ throw ไม่ได้คืนมาใน error
      // ถ้าไม่ใช่อาการชั่วคราว หรือหมดโควต้าลองแล้ว ให้โยนต่อ ไม่กลืนไว้เงียบๆ
      if (!isTransient(thrown) || i === attempts - 1) throw thrown;
      logBackgroundError(`${scope} (ลองใหม่ ${i + 1}/${attempts})`, thrown);
    }

    if (i < attempts - 1) await sleep(delays[Math.min(i, delays.length - 1)]);
  }

  return last as R;
}
