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

export async function syncBookingToSheet(payload: SheetBookingPayload) {
  const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
  if (!webhookUrl) return; // ยังไม่ได้ตั้งค่า — ข้ามเงียบๆ

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err) {
    // ไม่ throw — sync พลาดไม่ควรทำให้ booking flow ล้มเหลว
    console.error("syncBookingToSheet failed:", err instanceof Error ? err.message : err);
  }
}
