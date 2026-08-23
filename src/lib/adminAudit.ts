import { createClient } from "@supabase/supabase-js";

// บันทึกประวัติการดำเนินการของแอดมิน — พังแล้วต้องไม่ทำให้ action หลักพังตาม
// จึงกลืน error เองแทนที่จะ throw ออกไป
export async function logAdminAction(params: {
  username: string;
  action: string;
  detail?: string;
}): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return;

    const supabase = createClient(url, serviceKey);
    await supabase.from("admin_audit_log").insert({
      admin_username: params.username,
      action: params.action,
      detail: params.detail ?? null,
    });
  } catch {
    // ไม่ throw — การบันทึก log ไม่ควรทำให้ action หลักของแอดมินล้มเหลว
  }
}
