import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, signJWT } from "@/lib/adminAuth";
import { hashPassword, verifyPassword } from "@/lib/adminPassword";
import { logAdminAction } from "@/lib/adminAudit";

const MIN_PASSWORD_LENGTH = 8;

// POST /api/admin/change-password — เปลี่ยนรหัสผ่านบัญชีตัวเอง
// body: { current_password, new_password }
// เปลี่ยนสำเร็จแล้วจะออก session token ใหม่ให้ทันที (ไม่ต้อง login ซ้ำ) แต่ session อื่นที่ค้างอยู่
// (เครื่อง/เบราว์เซอร์อื่น หรือ token ที่หลุดไปอยู่ที่อื่น) จะถูกตัดสิทธิ์ในคำขอถัดไปทันที
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const adminId = String(admin.payload.admin_id ?? "");
  const username = String(admin.payload.username ?? "");
  if (!adminId) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const sessionSecret = process.env.APP_SESSION_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sessionSecret || !url || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const currentPassword = String((body as { current_password?: string } | null)?.current_password ?? "");
  const newPassword = String((body as { new_password?: string } | null)?.new_password ?? "");

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "กรอกรหัสผ่านให้ครบ" }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey);

  const { data: account } = await supabase
    .from("admin_users")
    .select("password_hash")
    .eq("id", adminId)
    .maybeSingle();

  if (!account || !verifyPassword(currentPassword, account.password_hash)) {
    return NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 401 });
  }

  const now = new Date();
  const { error } = await supabase
    .from("admin_users")
    .update({ password_hash: hashPassword(newPassword), password_changed_at: now.toISOString() })
    .eq("id", adminId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({ username, action: "เปลี่ยนรหัสผ่าน", detail: "เปลี่ยนรหัสผ่านบัญชีตัวเอง" });

  // ออก token ใหม่ให้ session ปัจจุบันทันที (ฝัง pwd_ver ใหม่) กัน admin โดนดีดตัวเองออกหลังเปลี่ยนรหัสผ่าน
  const token = signJWT(
    { role: "admin", admin_id: adminId, username, pwd_ver: now.getTime(), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 },
    sessionSecret
  );

  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
