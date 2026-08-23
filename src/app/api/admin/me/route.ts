import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

// GET /api/admin/me — ดูว่าตอนนี้ล็อกอินเป็นแอดมินคนไหนอยู่
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({
    admin_id: admin.payload.admin_id ?? null,
    username: admin.payload.username ?? null,
  });
}
