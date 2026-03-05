// src/app/api/admin/concerts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

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
    .select("id, title, venue_name, description, poster_url, archived, created_at")
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
  const poster = form.get("poster");

  if (!title) return NextResponse.json({ error: "missing title" }, { status: 400 });

  const sb = supabase();
  let poster_url: string | null = null;

  if (poster instanceof File && poster.size > 0) {
    const ext = poster.type === "image/png" ? "png" : poster.type === "image/webp" ? "webp" : "jpg";
    const fileName = `concerts/${Date.now()}.${ext}`;
    const buf = Buffer.from(await poster.arrayBuffer());
    const { error: upErr } = await sb.storage.from("posters").upload(fileName, buf, { contentType: poster.type, upsert: true });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    poster_url = sb.storage.from("posters").getPublicUrl(fileName).data.publicUrl;
  }

  const { data, error } = await sb.from("concerts").insert({ title, venue_name, description, poster_url }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ concert: data }, { status: 201 });
}