import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// GET /api/admin/concerts/[id]/sessions
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
  const { start_at, note } = (body ?? {}) as { start_at?: string; note?: string };

  if (!start_at) {
    return NextResponse.json({ error: "start_at is required" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: concert, error: cErr } = await supabase
    .from("concerts")
    .select("id")
    .eq("id", concert_id)
    .maybeSingle();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!concert) return NextResponse.json({ error: "concert not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("concert_sessions")
    .insert({ concert_id, start_at, end_at: null, note: note ?? null })
    .select("id, start_at, end_at, note")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "เพิ่มรอบการแสดง",
    detail: `concert_id: ${concert_id}, session_id: ${data?.id}, start_at: ${start_at}`,
  });

  return NextResponse.json({ ok: true, session: data }, { status: 201 });
}

// PATCH /api/admin/concerts/[id]/sessions — แก้ไขรอบ (รับ session_id จาก body)
// หมายเหตุ: session_id อยู่ใน body เพราะไฟล์นี้ handle path [id]/sessions ไม่ใช่ [id]/sessions/[session_id]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: concert_id } = await ctx.params;
  if (!concert_id) return NextResponse.json({ error: "missing concert id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const { session_id, start_at, note } = (body ?? {}) as {
    session_id?: string;
    start_at?: string;
    note?: string;
  };

  if (!session_id) return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  if (!start_at) return NextResponse.json({ error: "start_at is required" }, { status: 400 });

  const supabase = getSupabase();

  // ย้ายวันผ่าน RPC เพื่อให้ "ตรวจโควต้า + เขียนวันใหม่" อยู่ในทรานแซกชันเดียวกัน
  // เดิมตรวจแล้วค่อย update เป็นคนละคำสั่ง ทำให้ย้ายสองรอบเข้าวันเดียวกันพร้อมกันแล้วผ่านทั้งคู่
  // จนวันนั้นจัดสรรเกินสต็อกจริง (ดู scripts/add_move_session_rpc.sql)
  const { data: moveData, error: moveErr } = await supabase.rpc("move_concert_session", {
    p_concert_id: concert_id,
    p_session_id: session_id,
    p_start_at: start_at,
    p_note: note ?? null,
  });

  if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });

  const moveResult = moveData as {
    ok?: boolean; error?: string;
    phone_id?: string; lens_id?: string;
    moving_qty?: number; already_allocated?: number; total_qty?: number;
  } | null;

  if (moveResult?.error === "SESSION_NOT_FOUND") {
    return NextResponse.json({ error: "ไม่พบรอบการแสดงนี้" }, { status: 404 });
  }
  if (moveResult?.error === "PHONE_OVER_ALLOCATED" || moveResult?.error === "LENS_OVER_ALLOCATED") {
    const isLens = moveResult.error === "LENS_OVER_ALLOCATED";
    const unit = isLens ? "ชิ้น" : "เครื่อง";
    // ดึงชื่อมาแสดงให้แอดมินอ่านรู้เรื่อง (ถ้าดึงไม่ได้ค่อยใช้ id)
    let label = isLens ? moveResult.lens_id : moveResult.phone_id;
    if (isLens && moveResult.lens_id) {
      const { data } = await supabase.from("lenses").select("name").eq("id", moveResult.lens_id).maybeSingle();
      label = data?.name ?? label;
    } else if (moveResult.phone_id) {
      const { data } = await supabase.from("phones").select("model_name").eq("id", moveResult.phone_id).maybeSingle();
      label = data?.model_name ?? label;
    }
    return NextResponse.json(
      {
        error: `ย้ายวันไม่ได้: โควต้า${isLens ? "เลนส์ " : " "}${label} ของรอบนี้ (${moveResult.moving_qty} ${unit}) รวมกับรอบอื่นในวันใหม่ (${moveResult.already_allocated} ${unit}) จะเกินสต็อกจริง (${moveResult.total_qty} ${unit}) กรุณาปรับโควต้าก่อนย้ายวัน`,
      },
      { status: 400 }
    );
  }
  if (moveResult?.error) {
    return NextResponse.json({ error: moveResult.error }, { status: 400 });
  }

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "แก้ไขรอบการแสดง",
    detail: `concert_id: ${concert_id}, session_id: ${session_id}, start_at: ${start_at}`,
  });

  return NextResponse.json({ ok: true });
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

  const { error, count } = await supabase
    .from("concert_sessions")
    .delete({ count: "exact" })
    .eq("id", session_id)
    .eq("concert_id", concert_id); // double-check ป้องกัน cross-concert delete

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "ไม่พบรอบการแสดงนี้" }, { status: 404 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "ลบรอบการแสดง",
    detail: `concert_id: ${concert_id}, session_id: ${session_id}`,
  });

  return NextResponse.json({ ok: true });
}