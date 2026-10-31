import { NextRequest, NextResponse } from "next/server";
import { discountCustomerContext, discountDatabaseError, discountRpcError, discountUuid } from "@/lib/discountServer";
import { normalizeDiscountCode, DISCOUNT_CODE_PATTERN } from "@/lib/discounts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req: NextRequest) {
  const ctx=await discountCustomerContext(req);if("error" in ctx)return ctx.error;
  const body=await req.json().catch(()=>null);
  const code=normalizeDiscountCode(body?.code),qty=Number(body?.qty),lensQty=Number(body?.lens_qty??0);
  const lens=body?.lens_id||null;
  if(!DISCOUNT_CODE_PATTERN.test(code)||!discountUuid.test(String(body?.session_id))||!discountUuid.test(String(body?.phone_id))||
    (lens&&!discountUuid.test(lens))||!Number.isInteger(qty)||qty<1||qty>10||!Number.isInteger(lensQty)||lensQty<0||lensQty>qty)
    return NextResponse.json({error:"กรุณาตรวจสอบโค้ดและรายการที่เลือก"},{status:400});
  const {data,error}=await ctx.supabase.rpc("booking_discount_quote",{p_user_id:ctx.userId,p_code:code,
    p_session_id:body.session_id,p_phone_id:body.phone_id,p_qty:qty,p_lens_id:lens,p_lens_qty:lensQty});
  if(error)return discountDatabaseError(error);
  return discountRpcError(data)??NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
}
