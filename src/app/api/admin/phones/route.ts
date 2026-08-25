import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { validateImageUpload, sniffImageMimeType } from "@/lib/imageUpload";

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
    .select("id, model_name, image_url, price, deposit, qty, active")
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

  if (!model_name) return NextResponse.json({ error: "model_name is required" }, { status: 400 });
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: "price must be a finite number > 0" }, { status: 400 });
  if (!Number.isFinite(deposit) || deposit < 0) return NextResponse.json({ error: "deposit must be a finite number >= 0" }, { status: 400 });
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) return NextResponse.json({ error: "qty must be a non-negative integer" }, { status: 400 });

  let image_url: string | null = null;

  if (imageFile instanceof File && imageFile.size > 0) {
    const imgErr = validateImageUpload(imageFile);
    if (imgErr) return NextResponse.json({ error: imgErr }, { status: 400 });

    const buffer      = Buffer.from(await imageFile.arrayBuffer());
    const sniffedType = sniffImageMimeType(buffer);
    if (!sniffedType) {
      return NextResponse.json({ error: "ไฟล์ไม่ใช่รูปภาพที่รองรับ (ตรวจสอบจากเนื้อหาไฟล์จริงแล้วไม่ตรง)" }, { status: 400 });
    }

    const ext      = getImageExt(sniffedType);
    const fileName = `phone_${model_name.replace(/\s+/g, "_")}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("phones")
      .upload(fileName, buffer, { contentType: sniffedType, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("phones").getPublicUrl(fileName);
    image_url = pub.publicUrl;
  }

  const { data, error } = await supabase
    .from("phones")
    .insert({ model_name, price, deposit, image_url, qty })
    .select("id, model_name, image_url, price, deposit, qty, active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "เพิ่มมือถือ",
    detail: `เพิ่มมือถือ ${model_name} (id: ${data?.id})`,
  });

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
  const active     = form.get("active");
  const imageFile  = form.get("image");

  if (model_name) updates.model_name = model_name;
  if (active !== null) updates.active = active === "true";
  if (price !== null && price !== "") {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return NextResponse.json({ error: "price must be a finite number > 0" }, { status: 400 });
    updates.price = p;
  }
  if (deposit !== null && deposit !== "") {
    const d = Number(deposit);
    if (!Number.isFinite(d) || d < 0) return NextResponse.json({ error: "deposit must be a finite number >= 0" }, { status: 400 });
    updates.deposit = d;
  }
  if (qty !== null && qty !== "") {
    const q = Number(qty);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q < 0) return NextResponse.json({ error: "qty must be a non-negative integer" }, { status: 400 });

    // ถ้าลดจำนวนเครื่องรวม ต้องไม่ต่ำกว่าโควต้าที่จัดสรรให้รอบต่างๆ ไปแล้วรวมกันในวันใดวันหนึ่ง
    // (กันลด stock รวมแล้วโควต้าเดิมที่ตั้งไว้เกินจำนวนเครื่องจริงแบบไม่รู้ตัว)
    const { data: allocRows, error: allocErr } = await supabase
      .from("session_phone_inventory")
      .select("qty, concert_sessions ( start_at )")
      .eq("phone_id", id);
    if (allocErr) return NextResponse.json({ error: allocErr.message }, { status: 500 });

    const totalByDay: Record<string, number> = {};
    for (const row of allocRows ?? []) {
      const startAt = (row.concert_sessions as unknown as { start_at: string } | null)?.start_at;
      if (!startAt) continue;
      const dayKey = new Date(startAt).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      totalByDay[dayKey] = (totalByDay[dayKey] ?? 0) + Number(row.qty ?? 0);
    }
    const maxDayTotal = Object.values(totalByDay).reduce((max, v) => Math.max(max, v), 0);
    if (q < maxDayTotal) {
      return NextResponse.json(
        { error: `ลดจำนวนเครื่องรวมต่ำกว่า ${maxDayTotal} ไม่ได้ เพราะมีวันที่จัดสรรโควต้าให้รอบต่างๆ ไปแล้วรวมกัน ${maxDayTotal} เครื่อง กรุณาลดโควต้าของรอบนั้นๆ ก่อน` },
        { status: 400 }
      );
    }
    updates.qty = q;
  }

  if (imageFile instanceof File && imageFile.size > 0) {
    const imgErr = validateImageUpload(imageFile);
    if (imgErr) return NextResponse.json({ error: imgErr }, { status: 400 });

    const buffer      = Buffer.from(await imageFile.arrayBuffer());
    const sniffedType = sniffImageMimeType(buffer);
    if (!sniffedType) {
      return NextResponse.json({ error: "ไฟล์ไม่ใช่รูปภาพที่รองรับ (ตรวจสอบจากเนื้อหาไฟล์จริงแล้วไม่ตรง)" }, { status: 400 });
    }

    const ext      = getImageExt(sniffedType);
    const fileName = `phone_${id}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("phones")
      .upload(fileName, buffer, { contentType: sniffedType, upsert: true });

    if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = supabase.storage.from("phones").getPublicUrl(fileName);
    updates.image_url = pub.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error, count } = await supabase.from("phones").update(updates, { count: "exact" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "ไม่พบมือถือรุ่นนี้" }, { status: 404 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "แก้ไขมือถือ",
    detail: `แก้ไขมือถือ id: ${id}${model_name ? ` เป็น ${model_name}` : ""}`,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/phones?id=xxx
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id query param" }, { status: 400 });

  const supabase = getSupabase();

  // เช็คว่ามี booking ที่อ้างอิงมือถือรุ่นนี้อยู่ไหมก่อน กันกรณีลบ phones ไม่ผ่าน (FK ชน)
  // แต่ session_phone_inventory ถูกลบไปแล้วก่อนหน้า (ไม่มี transaction ครอบสอง delete นี้)
  const { count: bookingCount, error: bookingCountErr } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("phone_id", id);

  if (bookingCountErr) return NextResponse.json({ error: bookingCountErr.message }, { status: 500 });
  if ((bookingCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `ลบไม่ได้ เพราะมีประวัติการจองมือถือรุ่นนี้อยู่ ${bookingCount} รายการ ปิดการใช้งาน (active=false) แทนได้` },
      { status: 400 }
    );
  }

  const { error: invErr } = await supabase
    .from("session_phone_inventory")
    .delete()
    .eq("phone_id", id);

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  const { error, count } = await supabase.from("phones").delete({ count: "exact" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "ไม่พบมือถือรุ่นนี้" }, { status: 404 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ลบมือถือ",
    detail: `ลบมือถือ id: ${id}`,
  });

  return NextResponse.json({ ok: true });
}