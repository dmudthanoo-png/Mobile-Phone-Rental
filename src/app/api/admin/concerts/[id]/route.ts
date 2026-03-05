import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

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
  const posterFile = form.get("poster") as File | null;

  const updates: Record<string, any> = {};
  if (title) updates.title = title;
  if (venueName) updates.venue_name = venueName;
  const archivedVal = form.get("archived");
  if (archivedVal !== null) updates.archived = archivedVal === "true";

  // อัปโหลดโปสเตอร์ใหม่ถ้ามี
  if (posterFile instanceof File) {
    const ext = posterFile.type === "image/png" ? "png" : "jpg";
    const fileName = `concert_${id}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(await posterFile.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from("posters")
      .upload(fileName, buffer, { contentType: posterFile.type, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("posters").getPublicUrl(fileName);
    updates.poster_url = pub.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error } = await supabase.from("concerts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  const { error } = await supabase
    .from("concerts")
    .update({ archived: true })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}