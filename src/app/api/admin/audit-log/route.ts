import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/audit-log — ประวัติการดำเนินการของแอดมิน (กรองตามชื่อได้)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "missing env" }, { status: 500 });
  const supabase = createClient(url, serviceKey);

  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") || "").trim().toLowerCase();

  let query = supabase
    .from("admin_audit_log")
    .select("id, admin_username, action, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (username) query = query.eq("admin_username", username);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
