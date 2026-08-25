import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// GET /api/settings — ค่าตั้งค่าสาธารณะที่หน้าลูกค้าต้องใช้ (ไม่ต้อง login)
export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("app_settings")
    .select("terms_conditions")
    .eq("id", true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { terms_conditions: data?.terms_conditions ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
