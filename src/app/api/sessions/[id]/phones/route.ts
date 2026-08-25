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
