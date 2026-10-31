import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, verifyJWT } from "@/lib/adminAuth";
import { findOrCreateLineUser } from "@/lib/lineSession";
import { logServerError } from "@/lib/apiLog";
import { discountErrors } from "@/lib/discounts";

export const discountUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function discountOriginError(req: NextRequest) {
  const origin=req.headers.get("origin");
  return req.method!=="GET" && (req.headers.get("sec-fetch-site")==="cross-site" || (origin && origin!==new URL(req.url).origin))
    ? NextResponse.json({error:"forbidden origin"},{status:403}) : null;
}
export function discountDatabaseError(error: {message:string;code?:string}) {
  logServerError("discounts",error.message);
  if(error.code==="P0001" && Object.hasOwn(discountErrors,error.message)) {
    return NextResponse.json({error:discountErrors[error.message],code:error.message},{status:409});
  }
  return NextResponse.json({error:["42P01","42703","42883","PGRST202","PGRST204","PGRST205"].includes(error.code??"")
    ? "ยังไม่ได้ติดตั้งระบบส่วนลด กรุณารัน migration booking_discount_codes ก่อนใช้งาน"
    : "ยังยืนยันผลไม่ได้ กรุณาโหลดรายการล่าสุดก่อนทำซ้ำ"},{status:503});
}
export function discountRpcError(data: unknown) {
  const r=data as {ok?:boolean;error?:string}|null;
  if(r?.error)return NextResponse.json({error:discountErrors[r.error]??"ดำเนินการไม่สำเร็จ",code:r.error},{status:r.error==="UNAUTHORIZED"?403:409});
  return r?.ok===true?null:discountDatabaseError({message:"Unexpected discount result"});
}
export async function discountAdminContext(req: NextRequest) {
  const admin=await requireAdmin(req).catch(()=>({ok:false as const}));
  if(!admin.ok || !discountUuid.test(String(admin.payload.admin_id??""))) return {error:NextResponse.json({error:"unauthorized"},{status:401})};
  const originError=discountOriginError(req);if(originError)return {error:originError};
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return {error:NextResponse.json({error:"missing env"},{status:503})};
  return {supabase:createClient(url,key),adminId:String(admin.payload.admin_id)};
}
export async function discountCustomerContext(req: NextRequest) {
  const originError=discountOriginError(req);if(originError)return {error:originError};
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,secret=process.env.APP_SESSION_SECRET;
  if(!url||!key||!secret)return {error:NextResponse.json({error:"missing env"},{status:503})};
  let payload;
  try {payload=verifyJWT(req.cookies.get("app_session")?.value??"",secret);} catch {payload=null;}
  if(!payload || typeof payload.line_sub!=="string" || !payload.line_sub || !payload.exp || payload.exp<=Date.now()/1000)
    return {error:NextResponse.json({error:"unauthorized"},{status:401})};
  const supabase=createClient(url,key);
  const user=await findOrCreateLineUser(supabase,payload.line_sub,typeof payload.name==="string"?payload.name:null,typeof payload.picture==="string"?payload.picture:null);
  if("error" in user)return {error:discountDatabaseError({message:user.error})};
  return {supabase,userId:user.userId};
}
