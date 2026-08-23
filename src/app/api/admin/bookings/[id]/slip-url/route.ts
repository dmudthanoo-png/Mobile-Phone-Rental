import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { createSignedSlipUrl } from "@/lib/slipStorage";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// GET /api/admin/bookings/[id]/slip-url — ออกลิงก์ชั่วคราวไว้ดูสลิป (bucket private)
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: `invalid booking id: ${id}` }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "missing env" }, { status: 500 });
  const supabase = createClient(url, serviceKey);

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("slip_url")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!booking?.slip_url) return NextResponse.json({ error: "ไม่มีสลิป" }, { status: 404 });

  const signedUrl = await createSignedSlipUrl(booking.slip_url);
  if (!signedUrl) return NextResponse.json({ error: "สร้างลิงก์ดูสลิปไม่สำเร็จ" }, { status: 500 });

  return NextResponse.json({ url: signedUrl });
}
