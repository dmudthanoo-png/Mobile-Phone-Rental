// ============================================================
// 1) api/admin/concerts/route.ts
// ============================================================
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

// ============================================================
// 2) api/admin/concerts/[id]/route.ts
// ============================================================
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  const venue_name = String(form.get("venue_name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const poster = form.get("poster");

  const sb = supabase();
  const updates: Record<string, any> = {};
  if (title) updates.title = title;
  if (venue_name) updates.venue_name = venue_name;
  if (description) updates.description = description;

  if (poster instanceof File && poster.size > 0) {
    const ext = poster.type === "image/png" ? "png" : "jpg";
    const fileName = `concerts/${id}_${Date.now()}.${ext}`;
    const buf = Buffer.from(await poster.arrayBuffer());
    await sb.storage.from("posters").upload(fileName, buf, { contentType: poster.type, upsert: true });
    updates.poster_url = sb.storage.from("posters").getPublicUrl(fileName).data.publicUrl;
  }

  const { error } = await sb.from("concerts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { error } = await supabase().from("concerts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// 3) api/admin/concerts/[id]/sessions/route.ts
// ============================================================
// GET
export async function GET_SESSIONS(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const { data, error } = await supabase()
    .from("concert_sessions")
    .select("id, start_at, end_at, note, created_at")
    .eq("concert_id", id)
    .order("start_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

// POST  body: { start_at, end_at?, note? }
export async function POST_SESSION(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: concert_id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const { start_at, end_at, note } = body ?? {};
  if (!start_at) return NextResponse.json({ error: "missing start_at" }, { status: 400 });

  const { data, error } = await supabase()
    .from("concert_sessions")
    .insert({ concert_id, start_at, end_at: end_at || null, note: note || null })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data }, { status: 201 });
}

// ============================================================
// 4) api/admin/phones/route.ts
// ============================================================
// GET /api/admin/phones
export async function GET_PHONES(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase()
    .from("phones")
    .select("id, model_name, price, deposit, image_url, active, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phones: data ?? [] });
}

// POST /api/admin/phones  (multipart: model_name, price, deposit?, image?)
export async function POST_PHONE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const model_name = String(form.get("model_name") ?? "").trim();
  const price = Number(form.get("price") ?? 0);
  const deposit = Number(form.get("deposit") ?? 0);
  const image = form.get("image");

  if (!model_name) return NextResponse.json({ error: "missing model_name" }, { status: 400 });

  const sb = supabase();
  let image_url: string | null = null;

  if (image instanceof File && image.size > 0) {
    const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    const fileName = `phones/${Date.now()}.${ext}`;
    const buf = Buffer.from(await image.arrayBuffer());
    await sb.storage.from("phones").upload(fileName, buf, { contentType: image.type, upsert: true });
    image_url = sb.storage.from("phones").getPublicUrl(fileName).data.publicUrl;
  }

  const { data, error } = await sb.from("phones").insert({ model_name, price, deposit, image_url, active: true }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phone: data }, { status: 201 });
}

// ============================================================
// 5) api/admin/inventory/route.ts
// ============================================================
// POST /api/admin/inventory/set  body: { session_id, phone_id, qty }
export async function SET_INVENTORY(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { session_id, phone_id, qty } = body ?? {};

  if (!session_id || !phone_id || qty == null)
    return NextResponse.json({ error: "missing session_id / phone_id / qty" }, { status: 400 });

  const { error } = await supabase()
    .from("session_phone_inventory")
    .upsert({ session_id, phone_id, qty }, { onConflict: "session_id,phone_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// 6) api/admin/bookings/[id]/status/route.ts  (แก้จากเดิม)
// ============================================================
export async function PATCH_STATUS(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (!["confirmed", "rejected"].includes(status))
    return NextResponse.json({ error: "invalid status" }, { status: 400 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (status === "rejected") {
    // ✅ เรียก RPC คืนสต็อกพร้อมกัน
    const { error } = await sb.rpc("reject_booking_and_restore", { p_booking_id: id });
    if (error) {
      if (error.message.includes("NOT_PENDING"))
        return NextResponse.json({ error: "booking ไม่ได้อยู่ในสถานะ pending" }, { status: 400 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // confirmed → update ตรงได้เลย (สต็อกหักไปตอน pending แล้ว)
    const { error } = await sb.from("bookings").update({ status: "confirmed" }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}