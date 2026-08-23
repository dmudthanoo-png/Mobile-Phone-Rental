import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// DELETE /api/admin/reviews/[id] — แอดมินลบรีวิวที่ไม่เหมาะสม/สแปมทิ้ง
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: `invalid review id: ${id}` }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
