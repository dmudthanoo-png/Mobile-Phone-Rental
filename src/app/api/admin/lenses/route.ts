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

// GET /api/admin/lenses — รายการเลนส์ทั้งหมด
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("lenses")
    .select("id, name, focal_mm, price, qty, active")
    .order("focal_mm", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lenses: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/lenses — เพิ่มเลนส์ใหม่
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const body = await req.json().catch(() => null);

  const name     = String(body?.name ?? "").trim();
  const focal_mm = body?.focal_mm != null && body?.focal_mm !== "" ? Number(body.focal_mm) : null;
  const price    = Number(body?.price ?? 0);
  const qty      = Number(body?.qty ?? 0);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (price < 0) return NextResponse.json({ error: "price must be >= 0" }, { status: 400 });
  if (qty < 0) return NextResponse.json({ error: "qty must be >= 0" }, { status: 400 });

  const { data, error } = await supabase
    .from("lenses")
    .insert({ name, focal_mm, price, qty })
    .select("id, name, focal_mm, price, qty, active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "เพิ่มเลนส์",
    detail: `เพิ่มเลนส์ ${name}`,
  });

  return NextResponse.json({ ok: true, lens: data }, { status: 201 });
}

// PATCH /api/admin/lenses — แก้ไขเลนส์
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const body = await req.json().catch(() => null);

  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body?.name !== undefined) updates.name = String(body.name).trim();
  if (body?.focal_mm !== undefined) updates.focal_mm = body.focal_mm === "" || body.focal_mm === null ? null : Number(body.focal_mm);
  if (body?.price !== undefined) updates.price = Number(body.price);
  if (body?.qty !== undefined) updates.qty = Number(body.qty);
  if (body?.active !== undefined) updates.active = Boolean(body.active);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error } = await supabase.from("lenses").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "แก้ไขเลนส์",
    detail: `แก้ไขเลนส์ id ${id}`,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/lenses?id=xxx
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id query param" }, { status: 400 });

  const supabase = getSupabase();

  const { error } = await supabase.from("lenses").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ลบเลนส์",
    detail: `ลบเลนส์ id ${id}`,
  });

  return NextResponse.json({ ok: true });
}
