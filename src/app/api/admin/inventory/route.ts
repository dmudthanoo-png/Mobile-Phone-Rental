import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// GET /api/admin/inventory?session_id=xxx — ดู inventory ทั้งหมดของรอบนั้น
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const session_id = new URL(req.url).searchParams.get("session_id");
  if (!session_id) return NextResponse.json({ error: "missing session_id" }, { status: 400 });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("session_phone_inventory")
    .select(`
      session_id, qty,
      phones:phone_id ( id, model_name, image_url, price )
    `)
    .eq("session_id", session_id)
    .order("phones(model_name)", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inventory: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/inventory — ตั้ง/แก้จำนวน (upsert)
// body: { session_id, phone_id, qty }
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { session_id, phone_id, qty } = body ?? {};

  if (!session_id) return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  if (!phone_id) return NextResponse.json({ error: "phone_id is required" }, { status: 400 });
  if (qty === undefined || qty === null) return NextResponse.json({ error: "qty is required" }, { status: 400 });

  const parsedQty = Number(qty);
  if (!Number.isInteger(parsedQty) || parsedQty < 0) {
    return NextResponse.json({ error: "qty must be a non-negative integer" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from("session_phone_inventory")
    .upsert(
      { session_id, phone_id, qty: parsedQty },
      { onConflict: "session_id,phone_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, session_id, phone_id, qty: parsedQty });
}

// POST /api/admin/inventory/bulk — ตั้งหลายรายการพร้อมกัน
// body: { session_id, items: [{ phone_id, qty }] }
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { session_id, items } = body ?? {};

  if (!session_id) return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
  }

  // validate ทุก item
  for (const item of items) {
    if (!item.phone_id) return NextResponse.json({ error: "each item must have phone_id" }, { status: 400 });
    const q = Number(item.qty);
    if (!Number.isInteger(q) || q < 0) {
      return NextResponse.json({ error: `invalid qty for phone_id ${item.phone_id}` }, { status: 400 });
    }
  }

  const supabase = getSupabase();

  const rows = items.map((item: { phone_id: string; qty: number }) => ({
    session_id,
    phone_id: item.phone_id,
    qty: Number(item.qty),
  }));

  const { error } = await supabase
    .from("session_phone_inventory")
    .upsert(rows, { onConflict: "session_id,phone_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: rows.length });
}

// DELETE /api/admin/inventory?session_id=xxx&phone_id=yyy — ลบ inventory รายการเดียว
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const session_id = searchParams.get("session_id");
  const phone_id = searchParams.get("phone_id");

  if (!session_id) return NextResponse.json({ error: "missing session_id" }, { status: 400 });
  if (!phone_id) return NextResponse.json({ error: "missing phone_id" }, { status: 400 });

  const supabase = getSupabase();

  const { error } = await supabase
    .from("session_phone_inventory")
    .delete()
    .eq("session_id", session_id)
    .eq("phone_id", phone_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}