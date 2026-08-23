import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { requireAdmin } from "@/lib/adminAuth";
import { generateTotpSecret, generateTotpUri } from "@/lib/totp";

// POST /api/admin/2fa/setup — เริ่มเปิดใช้งาน 2FA ให้บัญชีตัวเอง
// สร้าง secret ใหม่ (ยังไม่ enable จนกว่าจะ /confirm ด้วยรหัสที่ถูกต้อง)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const adminId = String(admin.payload.admin_id ?? "");
  const username = String(admin.payload.username ?? "");
  if (!adminId || !username) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "missing env" }, { status: 500 });
  const supabase = createClient(url, serviceKey);

  const { data: account } = await supabase
    .from("admin_users")
    .select("totp_enabled")
    .eq("id", adminId)
    .maybeSingle();

  if (account?.totp_enabled) {
    return NextResponse.json({ error: "เปิดใช้งาน 2FA อยู่แล้ว ต้องปิดก่อนถึงจะตั้งค่าใหม่ได้" }, { status: 400 });
  }

  const secret = generateTotpSecret();

  const { error } = await supabase
    .from("admin_users")
    .update({ totp_secret: secret, totp_enabled: false })
    .eq("id", adminId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const otpauthUri = generateTotpUri(secret, username);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri);

  return NextResponse.json({ secret, otpauth_uri: otpauthUri, qr_data_url: qrDataUrl });
}
