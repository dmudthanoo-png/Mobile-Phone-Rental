// src/app/api/admin/concerts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { validateImageUpload, sniffImageMimeType } from "@/lib/imageUpload";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/admin/concerts
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase()
    .from("concerts")
    .select("id, title, venue_name, description, poster_url, archived, publish_at, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ concerts: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/concerts  (multipart: title, venue_name, description, poster?)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  const venue_name = String(form.get("venue_name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const publishAtRaw = String(form.get("publish_at") ?? "").trim();
  const poster = form.get("poster");

  if (!title) return NextResponse.json({ error: "missing title" }, { status: 400 });

  let publish_at: string | null = null;
  if (publishAtRaw) {
    const d = new Date(publishAtRaw);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "publish_at ไม่ถูกต้อง" }, { status: 400 });
    publish_at = d.toISOString();
  }

  const sb = supabase();
  let poster_url: string | null = null;

  if (poster instanceof File && poster.size > 0) {
    const imgErr = validateImageUpload(poster);
    if (imgErr) return NextResponse.json({ error: imgErr }, { status: 400 });

    const buf         = Buffer.from(await poster.arrayBuffer());
    const sniffedType = sniffImageMimeType(buf);
    if (!sniffedType) {
      return NextResponse.json({ error: "ไฟล์ไม่ใช่รูปภาพที่รองรับ (ตรวจสอบจากเนื้อหาไฟล์จริงแล้วไม่ตรง)" }, { status: 400 });
    }

    const ext = sniffedType === "image/png" ? "png" : sniffedType === "image/webp" ? "webp" : "jpg";
    const fileName = `concerts/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from("posters").upload(fileName, buf, { contentType: sniffedType, upsert: true });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    poster_url = sb.storage.from("posters").getPublicUrl(fileName).data.publicUrl;
  }

  const { data, error } = await sb.from("concerts").insert({ title, venue_name, description, poster_url, publish_at }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "สร้างคอนเสิร์ตใหม่",
    detail: `คอนเสิร์ต: ${title}`,
  });

  return NextResponse.json({ concert: data }, { status: 201 });
}