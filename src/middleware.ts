import { NextRequest, NextResponse } from "next/server";

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

export function middleware(req: NextRequest) {
  const ip = getClientIp(req);
  const now = Date.now();

  let bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    if (buckets.size >= MAX_TRACKED_IPS) {
      // ล้างของเก่าทิ้งกัน memory บวม (ทำแบบหยาบๆ พอ ไม่ต้องแม่นยำ)
      buckets.clear();
    }
    buckets.set(ip, bucket);
  }

  bucket.count += 1;

  if (bucket.count > MAX_REQUESTS) {
    return NextResponse.json(
      { error: "too_many_requests", message: "มีการเรียก API ถี่เกินไป กรุณาลองใหม่อีกครั้งในอีกสักครู่" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
