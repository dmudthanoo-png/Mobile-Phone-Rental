import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// ขั้นตอนติดตามงาน → ชื่อคอลัมน์เวลาที่เก็บจริง
const STEP_COLUMN = {
  delivered: "delivered_at",
  returned: "returned_at",
  files_sent: "files_sent_at",
} as const;

const STEP_LABEL: Record<keyof typeof STEP_COLUMN, string> = {
  delivered: "ส่งมอบเครื่อง",
  returned: "คืนเครื่อง",
  files_sent: "ส่งไฟล์",
};

type Step = keyof typeof STEP_COLUMN;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// POST /api/admin/bookings/fulfillment
// รูปแบบที่ 1 — ติ๊ก/ยกเลิกขั้นตอน (รองรับทีละหลายรายการ):
//   { booking_ids: string[], step: "delivered"|"returned"|"files_sent", done: boolean }
// รูปแบบที่ 2 — บันทึกหมายเหตุของรายการเดียว:
//   { booking_id: string, note: string }
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as
    | { booking_ids?: unknown; step?: unknown; done?: unknown; booking_id?: unknown; note?: unknown }
    | null;

  const supabase = getSupabase();

  // ── รูปแบบที่ 2: บันทึกหมายเหตุ ──
  if (body && typeof body.booking_id === "string" && body.note !== undefined) {
    const note = String(body.note ?? "").trim().slice(0, 500);
    const { error, count } = await supabase
      .from("bookings")
      .update({ fulfillment_note: note || null }, { count: "exact" })
      .eq("id", body.booking_id)
      .eq("status", "confirmed");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!count) return NextResponse.json({ error: "ไม่พบรายการจองนี้ (หรือยังไม่ได้ยืนยัน)" }, { status: 404 });

    await logAdminAction({
      username: String(admin.payload.username ?? ""),
      action: "บันทึกหมายเหตุติดตามงาน",
      detail: note ? `${note.slice(0, 80)}` : "(ล้างหมายเหตุ)",
    });

    return NextResponse.json({ ok: true });
  }

  // ── รูปแบบที่ 1: ติ๊ก/ยกเลิกขั้นตอน ──
  const ids = Array.isArray(body?.booking_ids)
    ? (body.booking_ids as unknown[]).map((v) => String(v)).filter(Boolean)
    : [];
  const step = String(body?.step ?? "") as Step;
  const done = Boolean(body?.done);

  if (ids.length === 0) {
    return NextResponse.json({ error: "booking_ids ต้องมีอย่างน้อย 1 รายการ" }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: "ทำได้สูงสุด 100 รายการต่อครั้ง" }, { status: 400 });
  }
  if (!(step in STEP_COLUMN)) {
    return NextResponse.json({ error: `step ต้องเป็น ${Object.keys(STEP_COLUMN).join(" / ")}` }, { status: 400 });
  }

  // ติ๊กได้เฉพาะรายการที่ยืนยันแล้วเท่านั้น (รายการที่ยังรอตรวจสลิป/ถูกปฏิเสธ ไม่ควรมีขั้นตอนส่งมอบ)
  const { data, error } = await supabase
    .from("bookings")
    .update({ [STEP_COLUMN[step]]: done ? new Date().toISOString() : null })
    .in("id", ids)
    .eq("status", "confirmed")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const updated = (data ?? []).length;
  if (updated === 0) {
    return NextResponse.json({ error: "ไม่พบรายการที่ยืนยันแล้วตามที่เลือก" }, { status: 404 });
  }

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: done ? `ติ๊ก${STEP_LABEL[step]}` : `ยกเลิกติ๊ก${STEP_LABEL[step]}`,
    detail: `${updated} รายการ`,
  });

  return NextResponse.json({ ok: true, updated });
}
