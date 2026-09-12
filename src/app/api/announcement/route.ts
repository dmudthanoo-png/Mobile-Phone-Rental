import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logServerError } from "@/lib/apiLog";
import { retryRead } from "@/lib/supabaseRetry";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      logServerError("/api/announcement", "missing env");
      return NextResponse.json({ error: "missing env" }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey);

    // อ่านอย่างเดียว → ลองใหม่ได้ถ้าเน็ต/เกตเวย์สะดุดชั่วคราว
    const { data, error } = await retryRead("/api/announcement", () =>
      supabase
        .from("announcements")
        .select("id, title, subtitle, emoji, image_url, active")
        .eq("active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    if (error) { logServerError("/api/announcement", error); return NextResponse.json({ error: error.message }, { status: 500 }); }

    return NextResponse.json(
      { announcement: data ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server_error";
    logServerError("/api/announcement", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
