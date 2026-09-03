import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { validateImageUpload, sniffImageMimeType } from "@/lib/imageUpload";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// PATCH /api/admin/concerts/[id] — แก้ชื่อ/venue/โปสเตอร์
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const supabase = getSupabase();
  const form = await req.formData();

  const title = form.get("title") as string | null;
  const venueName = form.get("venue_name") as string | null;
  const posterFile = form.get("poster");

  const updates: Record<string, unknown> = {};
  if (title?.trim()) updates.title = title.trim();
  if (venueName?.trim()) updates.venue_name = venueName.trim();
  // หน้าแอดมินส่ง description มาด้วยเสมอ แต่เดิม API ไม่ได้อ่าน ทำให้แก้รายละเอียดแล้วไม่ถูกบันทึก
  // ส่งค่าว่างมา = ตั้งใจล้างรายละเอียดทิ้ง จึงเก็บเป็น null (ไม่ใช่ข้ามไปเฉยๆ)
  const description = form.get("description") as string | null;
  if (description !== null) updates.description = description.trim() || null;

  const archivedVal = form.get("archived");
  if (archivedVal !== null) updates.archived = archivedVal === "true";

  // is_visible: สลับซ่อน/แสดงคอนเสิร์ตจากหน้าแรกได้ทันที แยกจาก archived
  const visibleVal = form.get("is_visible");
  if (visibleVal !== null) updates.is_visible = visibleVal === "true";

  // publish_at: ส่งมาว่างๆ = เคลียร์ให้เผยแพร่ทันที, ส่งมาเป็นวันที่ = ตั้งเวลาเผยแพร่ล่วงหน้า
  const publishAtVal = form.get("publish_at");
  if (publishAtVal !== null) {
    const raw = String(publishAtVal).trim();
    if (!raw) {
      updates.publish_at = null;
    } else {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "publish_at ไม่ถูกต้อง" }, { status: 400 });
      updates.publish_at = d.toISOString();
    }
  }

  // อัปโหลดโปสเตอร์ใหม่ถ้ามี
  if (posterFile instanceof File && posterFile.size > 0) {
    const imgErr = validateImageUpload(posterFile);
    if (imgErr) return NextResponse.json({ error: imgErr }, { status: 400 });

    const buffer      = Buffer.from(await posterFile.arrayBuffer());
    const sniffedType = sniffImageMimeType(buffer);
    if (!sniffedType) {
      return NextResponse.json({ error: "ไฟล์ไม่ใช่รูปภาพที่รองรับ (ตรวจสอบจากเนื้อหาไฟล์จริงแล้วไม่ตรง)" }, { status: 400 });
    }

    const ext = sniffedType === "image/png" ? "png" : sniffedType === "image/webp" ? "webp" : "jpg";
    const fileName = `concert_${id}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("posters")
      .upload(fileName, buffer, { contentType: sniffedType, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("posters").getPublicUrl(fileName);
    updates.poster_url = pub.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error, count } = await supabase.from("concerts").update(updates, { count: "exact" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "ไม่พบคอนเสิร์ตนี้" }, { status: 404 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "แก้ไขคอนเสิร์ต",
    detail: `รหัส ${id}${title?.trim() ? ` ชื่อ ${title.trim()}` : ""}`,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/concerts/[id] — archive คอนเสิร์ต (ไม่ลบจริง)
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const supabase = getSupabase();

  const { error, count } = await supabase
    .from("concerts")
    .update({ archived: true }, { count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "ไม่พบคอนเสิร์ตนี้" }, { status: 404 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ลบคอนเสิร์ต",
    detail: `รหัส ${id}`,
  });

  return NextResponse.json({ ok: true });
}