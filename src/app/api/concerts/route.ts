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
      .select("id, title, poster_url, venue_name, description, created_at")
      .eq("archived", false)  
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(
      { concerts: data ?? [] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("GET /api/concerts error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}