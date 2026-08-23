import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

// GET /api/admin/me — ดูว่าตอนนี้ล็อกอินเป็นแอดมินคนไหนอยู่ + สถานะ 2FA ของตัวเอง
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const adminId = admin.payload.admin_id ?? null;

  let totpEnabled = false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (adminId && url && serviceKey) {
    const supabase = createClient(url, serviceKey);
    const { data } = await supabase
      .from("admin_users")
      .select("totp_enabled")
      .eq("id", adminId)
      .maybeSingle();
    totpEnabled = Boolean(data?.totp_enabled);
  }

  return NextResponse.json({
    admin_id: adminId,
    username: admin.payload.username ?? null,
    totp_enabled: totpEnabled,
  });
}
