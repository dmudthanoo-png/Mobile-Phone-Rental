import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json({ error: "missing env" }, { status: 500 });
    }

    const { id: concertId } = await params;
    if (!concertId) {
      return NextResponse.json({ error: "missing concert id" }, { status: 400 });
    }

    const supabase = createClient(url, serviceKey);

    // กันโชว์/จองรอบของคอนเสิร์ตที่ archive ไปแล้ว (ยังเปิดตรงๆ ผ่าน id ได้ถ้าไม่เช็ค)
    const { data: concertRow, error: concertErr } = await supabase
      .from("concerts")
      .select("archived")
      .eq("id", concertId)
      .maybeSingle();

    if (concertErr) return NextResponse.json({ error: concertErr.message }, { status: 500 });
    if (!concertRow || concertRow.archived) {
      return NextResponse.json({ error: "concert not found" }, { status: 404 });
    }

    // ดึง sessions พร้อม inventory ของแต่ละ session — เอาเฉพาะรอบที่ยังไม่ผ่านไป
    const { data, error } = await supabase
      .from("concert_sessions")
      .select("id, concert_id, start_at, end_at, note, created_at")
      .eq("concert_id", concertId)
      .gte("start_at", new Date().toISOString())
      .order("start_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { sessions: data ?? [] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server_error";
    console.error("GET /api/concerts/[id] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}