import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// PATCH /api/admin/concerts/[id]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const form = await req.formData();
  const title       = String(form.get("title")       ?? "").trim();
  const venue_name  = String(form.get("venue_name")  ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const poster      = form.get("poster");

  const sb = supabase();
  const updates: Record<string, any> = {};
  if (title)       updates.title       = title;
  if (venue_name)  updates.venue_name  = venue_name;
  if (description) updates.description = description;

  // อัปโหลดโปสเตอร์ใหม่ถ้ามี
  if (poster instanceof File && poster.size > 0) {
    const ext = poster.type === "image/png" ? "png" : poster.type === "image/webp" ? "webp" : "jpg";
    const fileName = `concerts/${id}_${Date.now()}.${ext}`;
    const buf = Buffer.from(await poster.arrayBuffer());

    const { error: upErr } = await sb.storage
      .from("posters")
      .upload(fileName, buf, { contentType: poster.type, upsert: true });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    updates.poster_url = sb.storage.from("posters").getPublicUrl(fileName).data.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "ไม่มีข้อมูลที่จะอัปเดต" }, { status: 400 });
  }

  const { error } = await sb.from("concerts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

// DELETE /api/admin/concerts/[id]
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase().from("concerts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}