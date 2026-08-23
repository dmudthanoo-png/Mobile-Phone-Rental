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

// GET /api/admin/settings — ดึงค่าตั้งค่าปัจจุบัน
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("app_settings")
    .select("slipok_enabled")
    .eq("id", true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ถ้ายังไม่มีแถวเลย (ยังไม่ได้รัน migration ครบ) ให้ default เป็นเปิด
  return NextResponse.json({
    slipok_enabled: data?.slipok_enabled ?? true,
  });
}

// POST /api/admin/settings — แก้ไขค่าตั้งค่า { slipok_enabled: boolean }
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const slipokEnabled = (body as { slipok_enabled?: boolean } | null)?.slipok_enabled;
  if (typeof slipokEnabled !== "boolean") {
    return NextResponse.json({ error: "slipok_enabled must be boolean" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: true, slipok_enabled: slipokEnabled, updated_at: new Date().toISOString() });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "อัปเดตการตั้งค่าระบบ",
    detail: `slipok_enabled: ${slipokEnabled}`,
  });

  return NextResponse.json({ ok: true, slipok_enabled: slipokEnabled });
}
