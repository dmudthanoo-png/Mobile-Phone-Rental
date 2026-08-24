import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        {
          error: "missing env",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !url,
            SUPABASE_SERVICE_ROLE_KEY: !serviceKey,
          },
        },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(url, serviceKey);

    const { data, error } = await supabaseAdmin
      .from("concerts")
      .select("id, title, poster_url, venue_name, description, publish_at, created_at")
      .eq("archived", false)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // publish_at ในอนาคต = ยังไม่เปิดให้จอง แยกไปอยู่ใน category "เร็วๆ นี้" ต่างหาก
    // (null หรือถึงเวลาแล้ว = เผยแพร่ตามปกติ เหมือนพฤติกรรมเดิมก่อนมีฟีเจอร์นี้)
    const now = Date.now();
    const rows = data ?? [];
    const concerts = rows.filter((c) => !c.publish_at || new Date(c.publish_at).getTime() <= now);
    const upcoming = rows
      .filter((c) => c.publish_at && new Date(c.publish_at).getTime() > now)
      .sort((a, b) => new Date(a.publish_at!).getTime() - new Date(b.publish_at!).getTime());

    return NextResponse.json(
      { concerts, upcoming },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    console.error("GET /api/concerts error:", err);
    const message = err instanceof Error ? err.message : "server_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}