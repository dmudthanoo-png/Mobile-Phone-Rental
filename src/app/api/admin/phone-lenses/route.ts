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

// GET /api/admin/phone-lenses?phone_id=xxx — เลนส์ที่ผูกกับมือถือรุ่นนี้
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const phone_id = new URL(req.url).searchParams.get("phone_id");
  if (!phone_id) return NextResponse.json({ error: "missing phone_id query param" }, { status: 400 });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("phone_lenses")
    .select("lens_id, lenses ( id, name, focal_mm, price, qty, active )")
    .eq("phone_id", phone_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { lenses: (data ?? []).map((r) => r.lenses).filter(Boolean) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST /api/admin/phone-lenses — ผูกเลนส์เข้ากับมือถือ { phone_id, lens_id }
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const phone_id = String(body?.phone_id ?? "").trim();
  const lens_id  = String(body?.lens_id ?? "").trim();

  if (!phone_id || !lens_id) {
    return NextResponse.json({ error: "phone_id and lens_id are required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("phone_lenses").upsert({ phone_id, lens_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ผูกเลนส์กับมือถือ",
    detail: `phone_id: ${phone_id}, lens_id: ${lens_id}`,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/phone-lenses?phone_id=xxx&lens_id=yyy — เลิกผูก
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const phone_id = sp.get("phone_id");
  const lens_id  = sp.get("lens_id");
  if (!phone_id || !lens_id) {
    return NextResponse.json({ error: "phone_id and lens_id query params are required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("phone_lenses")
    .delete()
    .eq("phone_id", phone_id)
    .eq("lens_id", lens_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ยกเลิกผูกเลนส์กับมือถือ",
    detail: `phone_id: ${phone_id}, lens_id: ${lens_id}`,
  });

  return NextResponse.json({ ok: true });
}
