import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { verifyTotpCode, safeDecryptTotpSecret } from "@/lib/totp";
import { logAdminAction } from "@/lib/adminAudit";

// POST /api/admin/2fa/disable — ปิดใช้งาน 2FA (ต้องกรอกรหัสปัจจุบันยืนยันก่อน กัน session หลุดแล้วโดนปิดเฉยๆ)
// body: { code }
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const adminId = String(admin.payload.admin_id ?? "");
  const username = String(admin.payload.username ?? "");
  if (!adminId) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const code = String((body as { code?: string } | null)?.code ?? "");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || !process.env.TOTP_ENCRYPTION_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey);

  const { data: account } = await supabase
    .from("admin_users")
    .select("totp_secret, totp_enabled")
    .eq("id", adminId)
    .maybeSingle();

  if (!account?.totp_enabled || !account.totp_secret) {
    return NextResponse.json({ error: "ยังไม่ได้เปิดใช้งาน 2FA" }, { status: 400 });
  }

  const plainSecret = safeDecryptTotpSecret(account.totp_secret);
  if (plainSecret === null) {
    return NextResponse.json(
      { error: "อ่านค่า 2FA ไม่ได้ (encryption key อาจไม่ถูกต้องหรือข้อมูลเสียหาย) กรุณาติดต่อผู้ดูแลระบบ" },
      { status: 500 }
    );
  }

  if (!verifyTotpCode(plainSecret, code)) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง กรุณาลองใหม่" }, { status: 401 });
  }

  const { error } = await supabase
    .from("admin_users")
    .update({ totp_enabled: false, totp_secret: null })
    .eq("id", adminId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({ username, action: "ปิดใช้งาน 2FA", detail: "ปิดใช้งาน Google Authenticator" });

  return NextResponse.json({ ok: true });
}
