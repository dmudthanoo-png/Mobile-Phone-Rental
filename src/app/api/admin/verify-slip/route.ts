import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { verifySlipForBooking } from "@/lib/slipOk";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// POST /api/admin/verify-slip — ให้แอดมินกดตรวจสอบซ้ำเองได้ (เช่น หลังลูกค้าเปลี่ยนสลิปใหม่)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const bookingId = (body as { booking_id?: string } | null)?.booking_id;
  if (!bookingId) return NextResponse.json({ error: "missing booking_id" }, { status: 400 });

  const result = await verifySlipForBooking(bookingId);
  if (!result.ok) {
    if (result.error === "slipok_disabled_by_admin") {
      return NextResponse.json(
        { error: "ปิดการตรวจสอบสลิปอัตโนมัติไว้อยู่ กรุณาเปิดใช้งานก่อน (ปุ่มด้านบนของหน้ารายการจอง)" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
