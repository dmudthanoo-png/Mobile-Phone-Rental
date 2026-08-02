import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(_req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "missing env", missing: { NEXT_PUBLIC_SUPABASE_URL: !url, SUPABASE_SERVICE_ROLE_KEY: !serviceKey } },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(url, serviceKey);

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("rental_date, package_id, status")
      .in("status", ["pending", "confirmed"]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const counts: Record<string, Record<string, number>> = {};
    for (const row of data ?? []) {
      const date = String((row as any).rental_date);
      const pkg = String((row as any).package_id);
      if (!counts[date]) counts[date] = {};
      counts[date][pkg] = (counts[date][pkg] || 0) + 1;
    }

    return NextResponse.json({ counts }, { status: 200 });
  } catch (err: any) {
    console.error("calendar route error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}