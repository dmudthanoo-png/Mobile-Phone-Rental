import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

function getImageExt(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

// GET /api/admin/announcement — ดึงประกาศปัจจุบัน (ไม่ว่า active หรือไม่) มาให้แอดมินแก้
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, subtitle, emoji, image_url, active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ announcement: data ?? null }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/announcement — สร้าง/แก้ไขประกาศ (upsert แถวเดียว)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const form = await req.formData();

  const id       = (form.get("id") as string | null)?.trim() || null;
  const title    = (form.get("title") as string | null)?.trim() || null;
  const subtitle = (form.get("subtitle") as string | null)?.trim() || null;
  const emoji    = (form.get("emoji") as string | null)?.trim() || null;
  const active   = form.get("active") === "true";
  const removeImage = form.get("remove_image") === "true";
  const imageFile = form.get("image");

  const updates: Record<string, unknown> = { title, subtitle, emoji, active, updated_at: new Date().toISOString() };

  if (removeImage) {
    updates.image_url = null;
  }

  if (imageFile instanceof File && imageFile.size > 0) {
    const ext      = getImageExt(imageFile.type);
    const fileName = `announcement_${Date.now()}.${ext}`;
    const buffer   = Buffer.from(await imageFile.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from("announcements")
      .upload(fileName, buffer, { contentType: imageFile.type, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("announcements").getPublicUrl(fileName);
    updates.image_url = pub.publicUrl;
  }

  if (id) {
    const { data, error } = await supabase
      .from("announcements")
      .update(updates)
      .eq("id", id)
      .select("id, title, subtitle, emoji, image_url, active")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAdminAction({
      username: String(admin.payload.username ?? ""),
      action: "อัปเดตประกาศหน้าแรก",
      detail: `หัวข้อ: ${title ?? "-"}, สถานะ: ${active ? "เปิดใช้งาน" : "ปิดใช้งาน"}`,
    });

    return NextResponse.json({ ok: true, announcement: data });
  }

  const { data, error } = await supabase
    .from("announcements")
    .insert(updates)
    .select("id, title, subtitle, emoji, image_url, active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "อัปเดตประกาศหน้าแรก",
    detail: `หัวข้อ: ${title ?? "-"}, สถานะ: ${active ? "เปิดใช้งาน" : "ปิดใช้งาน"}`,
  });

  return NextResponse.json({ ok: true, announcement: data }, { status: 201 });
}
