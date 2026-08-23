import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// PATCH /api/admin/users/[id]/ban — แอดมินแบน/ปลดแบนผู้ใช้
// body: { banned: boolean, reason?: string }
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !uuidRe.test(id)) {
    return NextResponse.json({ error: `invalid user id: ${id}` }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const banned = (body as { banned?: boolean } | null)?.banned;
  const reason = (body as { reason?: string } | null)?.reason ?? null;

  if (typeof banned !== "boolean") {
    return NextResponse.json({ error: "missing_or_invalid_banned" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);
  const { error } = await supabase
    .from("profiles")
    .update({
      is_banned: banned,
      banned_at: banned ? new Date().toISOString() : null,
      ban_reason: banned ? reason : null,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    username: String(admin.payload.username ?? ""),
    action: banned ? "แบนผู้ใช้" : "ปลดแบนผู้ใช้",
    detail: `user_id: ${id}${banned && reason ? ` · เหตุผล: ${reason}` : ""}`,
  });

  return NextResponse.json({ ok: true, banned });
}
