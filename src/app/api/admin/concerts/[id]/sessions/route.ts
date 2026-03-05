import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// GET /api/admin/concerts/[id]/sessions — ดูรอบทั้งหมดของคอนเสิร์ต
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing concert id" }, { status: 400 });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("concert_sessions")
    .select("id, start_at, end_at, note")
    .eq("concert_id", id)
    .order("start_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sessions: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/concerts/[id]/sessions — เพิ่มรอบใหม่
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: concert_id } = await ctx.params;
  if (!concert_id) return NextResponse.json({ error: "missing concert id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const { start_at, end_at, note } = body ?? {};

  if (!start_at || !end_at) {
    return NextResponse.json({ error: "start_at and end_at are required" }, { status: 400 });
  }

  const supabase = getSupabase();

  // ตรวจว่า concert มีอยู่จริง
  const { data: concert, error: cErr } = await supabase
    .from("concerts")
    .select("id")
    .eq("id", concert_id)
    .maybeSingle();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!concert) return NextResponse.json({ error: "concert not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("concert_sessions")
    .insert({ concert_id, start_at, end_at, note: note ?? null })
    .select("id, start_at, end_at, note")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, session: data }, { status: 201 });
}

// DELETE /api/admin/concerts/[id]/sessions?session_id=xxx — ลบรอบ
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: concert_id } = await ctx.params;
  const session_id = new URL(req.url).searchParams.get("session_id");

  if (!concert_id) return NextResponse.json({ error: "missing concert id" }, { status: 400 });
  if (!session_id) return NextResponse.json({ error: "missing session_id query param" }, { status: 400 });

  const supabase = getSupabase();

  // ลบ inventory ของรอบนี้ก่อน
  const { error: invErr } = await supabase
    .from("session_phone_inventory")
    .delete()
    .eq("session_id", session_id);

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // ลบ session (ต้อง match concert_id ด้วยกัน race condition)
  const { error } = await supabase
    .from("concert_sessions")
    .delete()
    .eq("id", session_id)
    .eq("concert_id", concert_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}