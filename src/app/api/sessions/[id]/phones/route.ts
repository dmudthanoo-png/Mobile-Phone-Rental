import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ดึงมือถือ+เลนส์+สต็อกคงเหลือของรอบนี้ทั้งหมดในคำสั่งเดียว ผ่าน RPC get_session_phones
// (เดิมต้องยิง query แยก 4 รอบ — ดูรายละเอียด logic เดิม/ที่มาได้ที่ scripts/add_get_session_phones_rpc.sql)
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

    const { id: sessionId } = await params;
    if (!sessionId) return NextResponse.json({ error: "missing session id" }, { status: 400 });

    const supabase = createClient(url, serviceKey);

    // กันรอบของคอนเสิร์ตที่ซ่อนอยู่/ยังไม่ถึงเวลาเผยแพร่ โชว์ข้อมูลสต็อกออกมาได้ผ่าน session_id ตรงๆ
    // (endpoint จองจริงกันไว้แล้ว แต่ endpoint นี้เป็นแค่ query ข้อมูล ไม่ได้เช็คมาก่อน)
    const { data: sessionCheck, error: sessionCheckErr } = await supabase
      .from("concert_sessions")
      .select("id, concerts ( archived, is_visible, publish_at )")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionCheckErr) return NextResponse.json({ error: sessionCheckErr.message }, { status: 500 });
    const concertRow = sessionCheck?.concerts as unknown as { archived: boolean; is_visible: boolean | null; publish_at: string | null } | null;
    if (!sessionCheck || !concertRow || concertRow.archived || concertRow.is_visible === false) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (concertRow.publish_at && new Date(concertRow.publish_at).getTime() > Date.now()) {
      return NextResponse.json({ error: "concert not published yet" }, { status: 403 });
    }

    const { data, error } = await supabase.rpc("get_session_phones", { p_session_id: sessionId });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(
      { phones: data ?? [] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server_error";
    console.error("GET /api/sessions/[id]/phones error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
