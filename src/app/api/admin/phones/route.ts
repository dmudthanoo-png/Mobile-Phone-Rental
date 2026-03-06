import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

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

// GET /api/admin/phones
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("phones")
    .select("id, model_name, image_url, price, deposit, qty, lens_addon_price") // ← เพิ่ม
    .order("model_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ phones: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/phones — เพิ่มมือถือใหม่
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const form = await req.formData();

  const model_name = (form.get("model_name") as string | null)?.trim();
  const price      = Number(form.get("price")   ?? 0);
  const deposit    = Number(form.get("deposit") ?? 0);
  const qty        = Number(form.get("qty")      ?? 0);
  const imageFile  = form.get("image");

  // lens_addon_price: ถ้าไม่ได้ส่งมาหรือว่าง = null (ไม่มี option)
  const lensRaw         = (form.get("lens_addon_price") as string | null)?.trim();
  const lens_addon_price = lensRaw ? Number(lensRaw) : null;

  if (!model_name) return NextResponse.json({ error: "model_name is required" }, { status: 400 });
  if (!price || price <= 0) return NextResponse.json({ error: "price must be > 0" }, { status: 400 });
  if (qty < 0) return NextResponse.json({ error: "qty must be >= 0" }, { status: 400 });
  if (lens_addon_price !== null && lens_addon_price < 0) {
    return NextResponse.json({ error: "lens_addon_price must be >= 0" }, { status: 400 });
  }

  let image_url: string | null = null;

  if (imageFile instanceof File && imageFile.size > 0) {
    const ext      = getImageExt(imageFile.type);
    const fileName = `phone_${model_name.replace(/\s+/g, "_")}_${Date.now()}.${ext}`;
    const buffer   = Buffer.from(await imageFile.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from("phones")
      .upload(fileName, buffer, { contentType: imageFile.type, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("phones").getPublicUrl(fileName);
    image_url = pub.publicUrl;
  }

  const { data, error } = await supabase
    .from("phones")
    .insert({ model_name, price, deposit, image_url, qty, lens_addon_price }) // ← เพิ่ม deposit + lens
    .select("id, model_name, image_url, price, deposit, qty, lens_addon_price")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, phone: data }, { status: 201 });
}

// PATCH /api/admin/phones — แก้ข้อมูลมือถือ
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const form = await req.formData();

  const id = (form.get("id") as string | null)?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};

  const model_name = (form.get("model_name") as string | null)?.trim();
  const price      = form.get("price");
  const deposit    = form.get("deposit");
  const qty        = form.get("qty");
  const imageFile  = form.get("image");

  // lens_addon_price: ว่างเปล่า = ลบ option (null), มีค่า = ตั้งราคาใหม่
  const lensRaw = form.get("lens_addon_price") as string | null;
  if (lensRaw !== null) {
    updates.lens_addon_price = lensRaw.trim() ? Number(lensRaw.trim()) : null;
  }

  if (model_name) updates.model_name = model_name;
  if (price !== null && price !== "") {
    const p = Number(price);
    if (p <= 0) return NextResponse.json({ error: "price must be > 0" }, { status: 400 });
    updates.price = p;
  }
  if (deposit !== null && deposit !== "") updates.deposit = Number(deposit);
  if (qty !== null && qty !== "") {
    const q = Number(qty);
    if (q < 0) return NextResponse.json({ error: "qty must be >= 0" }, { status: 400 });
    updates.qty = q;
  }

  if (imageFile instanceof File && imageFile.size > 0) {
    const ext      = getImageExt(imageFile.type);
    const fileName = `phone_${id}_${Date.now()}.${ext}`;
    const buffer   = Buffer.from(await imageFile.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from("phones")
      .upload(fileName, buffer, { contentType: imageFile.type, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("phones").getPublicUrl(fileName);
    updates.image_url = pub.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error } = await supabase.from("phones").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/phones?id=xxx
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id query param" }, { status: 400 });

  const supabase = getSupabase();

  const { error: invErr } = await supabase
    .from("session_phone_inventory")
    .delete()
    .eq("phone_id", id);

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  const { error } = await supabase.from("phones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}