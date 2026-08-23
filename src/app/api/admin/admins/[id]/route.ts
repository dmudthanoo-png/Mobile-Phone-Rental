import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// DELETE /api/admin/admins/[id] — ลบบัญชีแอดมิน
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: `invalid admin id: ${id}` }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey);

  const { count } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: "ต้องมีบัญชีแอดมินเหลืออย่างน้อย 1 บัญชีเสมอ" }, { status: 400 });
  }

  const { data: target } = await supabase
    .from("admin_users")
    .select("username")
    .eq("id", id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "ไม่พบบัญชีนี้" }, { status: 404 });

  const { error } = await supabase.from("admin_users").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: "admin_account_deleted",
    detail: `ลบบัญชีแอดมิน: ${target.username}`,
  });

  return NextResponse.json({ ok: true });
}
