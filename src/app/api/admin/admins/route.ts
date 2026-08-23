import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { hashPassword } from "@/lib/adminPassword";
import { logAdminAction } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

// GET /api/admin/admins — รายชื่อบัญชีแอดมินทั้งหมด (ไม่ส่ง password_hash กลับ)
// ถ้ายังไม่มีบัญชีแอดมินเลย ตอบ needsBootstrap:true โดยไม่ต้องล็อกอินก่อน
// (หน้า login ฝั่ง client ใช้เช็คว่าควรโชว์ฟอร์ม "ตั้งค่าบัญชีแรก" หรือฟอร์ม login ปกติ)
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "missing env" }, { status: 500 });

  const { count } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) === 0) {
    return NextResponse.json({ admins: [], needsBootstrap: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("admin_users")
    .select("id, username, created_at")
    .order("username", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { admins: data ?? [], needsBootstrap: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST /api/admin/admins — สร้างบัญชีแอดมินใหม่
// ถ้ายังไม่มีบัญชีแอดมินเลยในระบบ (ตาราง admin_users ว่าง) อนุญาตให้สร้างบัญชีแรกได้
// โดยไม่ต้องล็อกอินก่อน (bootstrap) เพราะยังไม่มีใครให้ล็อกอินอยู่แล้ว
export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "missing env" }, { status: 500 });

  const { count } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  const isBootstrap = (count ?? 0) === 0;

  let actorUsername = "";
  if (!isBootstrap) {
    const admin = await requireAdmin(req);
    if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    actorUsername = String(admin.payload.username ?? "");
  }

  const body = await req.json().catch(() => null);
  const username = String((body as { username?: string } | null)?.username ?? "").trim().toLowerCase();
  const password = String((body as { password?: string } | null)?.password ?? "");

  if (!username || username.length < 3) {
    return NextResponse.json({ error: "username ต้องมีอย่างน้อย 3 ตัวอักษร" }, { status: 400 });
  }
  if (!/^[a-z0-9_.-]+$/.test(username)) {
    return NextResponse.json({ error: "username ใช้ได้เฉพาะ a-z, 0-9, _ . -" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" }, { status: 400 });
  }

  const password_hash = hashPassword(password);
  const { data, error } = await supabase
    .from("admin_users")
    .insert({ username, password_hash })
    .select("id, username, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "username นี้มีคนใช้แล้ว" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    username: isBootstrap ? username : actorUsername,
    action: "admin_account_created",
    detail: isBootstrap ? `สร้างบัญชีแอดมินคนแรก: ${username}` : `สร้างบัญชีแอดมินใหม่: ${username}`,
  });

  return NextResponse.json({ ok: true, admin: data });
}
