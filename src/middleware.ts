import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════
// Rate limiter แบบ in-memory ครอบคลุมทุก /api/* route
//
// ข้อจำกัดที่ควรรู้: ตัวนับนี้เก็บอยู่ใน memory ของแต่ละ instance
// เท่านั้น ถ้า deploy บน Vercel และมีหลาย instance/region พร้อมกัน
// (traffic เยอะ) ตัวเลขจะไม่ถูกนับรวมข้าม instance ทำให้ผู้โจมตี
// ที่ไปโดนคนละ instance อาจหลุด limit ได้บ้าง — แต่ยังกันการยิงสแปม
// จากสคริปต์ทั่วไป (ที่ยิงรัวๆ จากเครื่องเดียว) ได้ผลดีในระดับหนึ่ง
//
// ถ้าต้องการความแม่นยำระดับ production จริงจัง (นับรวมทุก instance)
// แนะนำใช้ Vercel Firewall/Rate Limiting (แผน Pro) หรือ Upstash Redis
// ร่วมกับ @upstash/ratelimit แทนตัวนี้
// ═══════════════════════════════════════════════════════════════

const WINDOW_MS = 10_000;      // นับ request ภายในช่วง 10 วินาที
const MAX_REQUESTS = 40;       // ต่อ IP ต่อช่วงเวลา สำหรับ /api/* ทั่วไป

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

// กันไม่ให้ Map บวมไม่รู้จบถ้ามี IP แปลกใหม่เข้ามาเรื่อยๆ
const MAX_TRACKED_IPS = 5000;

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// ═══════════════════════════════════════════════════════════════
// เช็คแบนผู้ใช้แบบ real-time — ต้อง verify ลายเซ็น JWT ก่อนเชื่อ line_sub
// เสมอ (ใช้ Web Crypto ที่มีมากับ runtime อยู่แล้ว ไม่ต้องพึ่ง Node crypto
// เลยยัง Edge-compatible เหมือนเดิม) ถ้าไม่ verify ลายเซ็น ใครก็ปลอม
// cookie ใส่ line_sub อะไรก็ได้มาบังคับให้ middleware ยิง query ไป Supabase
// ทุกครั้ง กลายเป็นช่องทาง DoS/เดา ban status ได้แม้ signature จะไม่ผ่านจริง
// route handler ปลายทางเองก็ยัง verify ซ้ำอีกชั้นอยู่ดี อันนี้แค่กันไม่ให้
// query ฐานข้อมูลจาก token ปลอมที่ไม่มีทางผ่าน auth จริงได้ตั้งแต่แรก
// ถ้าโดนแบน จะเตะออกจาก session ทันทีโดยไม่ต้องรอ token หมดอายุ
// ═══════════════════════════════════════════════════════════════

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

function base64urlToBytes(b64url: string): Uint8Array {
  const base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifiedSessionLineSub(token: string): Promise<string | null> {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlToBytes(s) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`)
    );
    if (!isValid) return null;

    const json = new TextDecoder().decode(base64urlToBytes(p));
    const payload = JSON.parse(json) as { line_sub?: string; exp?: number };

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) return null;

    return payload.line_sub ?? null;
  } catch {
    return null;
  }
}

async function isUserBanned(lineSub: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_banned")
    .eq("line_sub", lineSub)
    .maybeSingle();
  return Boolean(data?.is_banned);
}

function clearSessionCookies(res: NextResponse) {
  res.cookies.set("app_session", "", { path: "/", maxAge: 0 });
  res.cookies.set("app_user_id", "", { path: "/", maxAge: 0 });
  res.cookies.set("line_sub", "", { path: "/", maxAge: 0 });
}

export async function middleware(req: NextRequest) {
  const ip = getClientIp(req);
  const now = Date.now();

  let bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    if (!buckets.has(ip) && buckets.size >= MAX_TRACKED_IPS) {
      // เต็มโควต้าแล้วและเป็น IP ใหม่ที่ไม่เคยเห็น — เขี่ยรายการที่เก่าที่สุดออกแค่ 1 รายการ
      // (Map ของ JS รักษาลำดับการ insert ไว้ ตัวแรกสุดที่ iterate เจอ = เก่าสุด) แทนที่จะทำ
      // อย่างใดอย่างหนึ่งจากสองแบบที่แย่กว่า: clear() ทั้ง Map (โดนยิง IP ปลอมจำนวนมากมา
      // บังคับรีเซ็ต limit ของทุกคนพร้อมกันได้) หรือปฏิเสธ IP ใหม่ทั้งหมดตลอดไปจนกว่า
      // instance จะ restart (ถ้าโดน flood ครั้งเดียวจน Map เต็ม ผู้ใช้ใหม่จริงจะโดนบล็อกค้าง)
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    bucket = { count: 0, windowStart: now };
    buckets.set(ip, bucket);
  }

  bucket.count += 1;

  if (bucket.count > MAX_REQUESTS) {
    return NextResponse.json(
      { error: "too_many_requests", message: "มีการเรียก API ถี่เกินไป กรุณาลองใหม่อีกครั้งในอีกสักครู่" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) } }
    );
  }

  // เส้นทาง login/logout ให้ route handler เองเป็นคนจัดการเรื่องแบน
  // (กันข้อความซ้ำซ้อน/ชนกับ redirect flow ของ LINE OAuth)
  //
  // เส้นทาง admin ต้องยกเว้นด้วย — ระบบ auth ของแอดมินแยกคนละชุดกับลูกค้า
  // (ใช้ admin_session + requireAdmin() ไม่เกี่ยวกับ profiles.is_banned เลย)
  // ถ้าไม่ยกเว้น: กรณีเบราว์เซอร์เดียวกันล็อกอินเป็นทั้งลูกค้า(ที่โดนแบน)และแอดมิน
  // การเรียก /api/admin/* (รวมถึง endpoint ปลดแบนเอง) จะโดน middleware
  // ตีกลับ 403 ไปก่อนถึง requireAdmin() ทำให้แอดมินล็อกตัวเองออกไปด้วย
  const pathname = req.nextUrl.pathname;
  const sessionToken = req.cookies.get("app_session")?.value;

  if (sessionToken && !pathname.startsWith("/api/auth/") && !pathname.startsWith("/api/admin/")) {
    const lineSub = await verifiedSessionLineSub(sessionToken);
    if (lineSub && (await isUserBanned(lineSub))) {
      const res = NextResponse.json(
        { error: "banned", message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน" },
        { status: 403 }
      );
      clearSessionCookies(res);
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
