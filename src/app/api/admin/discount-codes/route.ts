import { NextRequest, NextResponse } from "next/server";
import { discountAdminContext, discountDatabaseError, discountRpcError, discountUuid } from "@/lib/discountServer";
import { DISCOUNT_CODE_PATTERN, normalizeDiscountCode } from "@/lib/discounts";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(req: NextRequest) {
  const ctx=await discountAdminContext(req);if("error" in ctx)return ctx.error;
  const params=new URL(req.url).searchParams;
  const page=Math.max(0,Math.min(100000,Math.floor(Number(params.get("page"))||0)));
  const id=params.get("id");
  if(id&&!discountUuid.test(id))return NextResponse.json({error:"invalid code id"},{status:400});
  const {data,error}=id?await ctx.supabase.rpc("admin_discount_usage",{p_id:id,p_offset:page*50})
    :await ctx.supabase.rpc("admin_discount_code_list",{p_offset:page*50,p_deleted:params.get("deleted")==="true"});
  return error?discountDatabaseError(error):NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req: NextRequest) {
  const ctx=await discountAdminContext(req);if("error" in ctx)return ctx.error;
  const b=await req.json().catch(()=>null);
  if(!b||!["create","update","set_active","delete"].includes(b.action)||(b.action!=="create"&&!discountUuid.test(String(b.id))))
    return NextResponse.json({error:"invalid request"},{status:400});
  const edit=b.action==="create"||b.action==="update";
  if(b.action==="set_active"&&typeof b.active!=="boolean")return NextResponse.json({error:"invalid active state"},{status:400});
  if(edit&&(!DISCOUNT_CODE_PATTERN.test(normalizeDiscountCode(b.code))||
    !Number.isInteger(b.amount)||b.amount<1||b.amount>1000000||typeof b.name!=="string"||!b.name.trim()||b.name.trim().length>100||
    typeof b.active!=="boolean"||typeof b.starts_at!=="string"||typeof b.expires_at!=="string"||
    !/(Z|[+-]\d{2}:\d{2})$/.test(b.starts_at)||!/(Z|[+-]\d{2}:\d{2})$/.test(b.expires_at)||
    !Number.isFinite(Date.parse(b.starts_at))||!Number.isFinite(Date.parse(b.expires_at))||Date.parse(b.expires_at)<=Date.parse(b.starts_at)))
    return NextResponse.json({error:"กรุณาตรวจสอบจำนวนส่วนลดและวันเวลา"},{status:400});
  const {data,error}=await ctx.supabase.rpc("admin_save_discount_code",{p_admin_id:ctx.adminId,p_action:b.action,
    p_id:b.action==="create"?null:b.id,p_code:edit?normalizeDiscountCode(b.code):null,
    p_name:edit?b.name.trim():null,p_amount:edit?b.amount:null,
    p_starts_at:edit?new Date(b.starts_at).toISOString():null,
    p_expires_at:edit?new Date(b.expires_at).toISOString():null,p_active:b.action==="delete"?null:b.active});
  return error?discountDatabaseError(error):discountRpcError(data)??NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
}
