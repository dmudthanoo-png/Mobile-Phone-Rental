// ═══════════════════════════════════════════════════════════════
// บันทึก error ฝั่งเซิร์ฟเวอร์ให้โผล่ใน Vercel Logs
//
// ที่มา: 12 ก.ย. 2569 เว็บมีอาการพังเป็นช่วงๆ พอไปเปิด Vercel Logs ดู
// เจอ 500 จริงแต่ช่อง Message ว่างเปล่าทุกแถว เพราะทุก route คืน 500
// ด้วย NextResponse.json(...) เฉยๆ ข้อความ error ไปอยู่ใน response body
// ที่ไม่มีใครเก็บ → ไล่หาสาเหตุไม่ได้เลยว่าพังเพราะอะไร
//
// ฟังก์ชันนี้ทำอย่างเดียวคือ console.error ให้ Vercel เก็บไว้
// ไม่เปลี่ยนสิ่งที่ตอบกลับไปหาผู้ใช้ (ตั้งใจให้พฤติกรรมเดิมทุกอย่าง)
// ═══════════════════════════════════════════════════════════════

function describe(err: unknown): string {
  if (err == null) return "(ไม่มีรายละเอียด)";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    // รูปแบบ error ของ supabase-js / PostgREST
    const parts = [o.message, o.code, o.details, o.hint]
      .filter((v) => v != null && v !== "")
      .map(String);
    if (parts.length > 0) return parts.join(" · ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * บันทึก error ที่ทำให้ route ตอบ 500
 * @param scope  เส้นทาง/จุดที่เกิด เช่น "GET /api/settings"
 * @param err    ค่า error ดิบ (supabase error, Error, string อะไรก็ได้)
 */
export function logServerError(scope: string, err: unknown): void {
  console.error(`[500] ${scope} — ${describe(err)}`);
}

/** บันทึกงานเบื้องหลังที่พลาด (ไม่ได้ทำให้ request พัง แต่ต้องรู้ว่าเกิดขึ้น) */
export function logBackgroundError(scope: string, err: unknown): void {
  console.error(`[bg] ${scope} — ${describe(err)}`);
}
