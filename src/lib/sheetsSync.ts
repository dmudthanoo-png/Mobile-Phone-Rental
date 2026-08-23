// ── Sync ข้อมูลการจองไปยัง Google Sheet ผ่าน Apps Script Web App ──
// ตั้งค่า SHEETS_WEBHOOK_URL ใน env ถ้ายังไม่ตั้ง จะข้ามการ sync แบบเงียบๆ
// การ sync เป็น "best-effort" — ถ้าพลาด (Sheets ล่ม/timeout) จะไม่ทำให้
// การจองหรือการเปลี่ยนสถานะล้มเหลวตามไปด้วย

export type SheetBookingPayload = {
  event: "created" | "status_changed";
  booking_id: string;
  ref_number: string | null;
  status: string;
  renter_name: string;
  renter_phone: string;
  concert_title?: string | null;
  session_label?: string | null;
  phone_model?: string | null;
  qty?: number | null;
  lens_name?: string | null;
  lens_qty?: number | null;
  total_amount?: number | null;
  created_at?: string | null;
};

// กัน Spreadsheet Formula Injection — ถ้า Apps Script ปลายทางเขียนค่าลง cell ตรงๆ
// ค่าที่ขึ้นต้นด้วย =, +, -, @ จะถูกตีความเป็นสูตรได้ (เช่น renter_name ที่ผู้ใช้กรอกเอง)
// เติม ' นำหน้าให้สเปรดชีตส่วนใหญ่ตีความเป็นข้อความธรรมดาแทน
function sanitizeForSheet(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function sanitizePayload(payload: SheetBookingPayload): SheetBookingPayload {
  const sanitized = { ...payload };
  for (const key of Object.keys(sanitized) as (keyof SheetBookingPayload)[]) {
    const value = sanitized[key];
    if (typeof value === "string") {
      (sanitized[key] as string) = sanitizeForSheet(value);
    }
  }
  return sanitized;
}

export async function syncBookingToSheet(payload: SheetBookingPayload) {
  const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
  if (!webhookUrl) return; // ยังไม่ได้ตั้งค่า — ข้ามเงียบๆ

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sanitizePayload(payload)),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err) {
    // ไม่ throw — sync พลาดไม่ควรทำให้ booking flow ล้มเหลว
    console.error("syncBookingToSheet failed:", err instanceof Error ? err.message : err);
  }
}
