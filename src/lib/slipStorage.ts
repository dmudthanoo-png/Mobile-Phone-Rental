import { createClient } from "@supabase/supabase-js";

const BUCKET = "slips";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

// slip_url ในฐานข้อมูลเก็บเป็นลิงก์เต็มมาตั้งแต่ตอน bucket ยังเป็น public
// (ทั้งแบบ .../object/public/slips/... และแบบ signed .../object/sign/slips/...?token=...)
// ฟังก์ชันนี้แกะเอาแค่ "path" ในตัว bucket ออกมา ใช้ได้กับค่าเก่า/ใหม่ทั้งหมด
// เพราะ path ของไฟล์ไม่เคยเปลี่ยน เปลี่ยนแค่วิธีเข้าถึงเท่านั้น
export function extractSlipPath(slipUrl: string): string | null {
  const markers = [`/object/public/${BUCKET}/`, `/object/sign/${BUCKET}/`];
  for (const marker of markers) {
    const idx = slipUrl.indexOf(marker);
    if (idx !== -1) {
      const rest = slipUrl.slice(idx + marker.length).split("?")[0];
      return rest ? decodeURIComponent(rest) : null;
    }
  }
  return null;
}

// โหลดไฟล์สลิปมาเป็นไบต์ตรงๆ ผ่าน service role — ใช้ได้ไม่ว่า bucket จะ public หรือ private
export async function downloadSlipBuffer(slipUrl: string) {
  const path = extractSlipPath(slipUrl);
  if (!path) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  return { buffer, contentType };
}

// สร้างลิงก์ชั่วคราวไว้ให้ browser เปิดดูรูปสลิปได้ (bucket private ต้องใช้ทางนี้)
export async function createSignedSlipUrl(
  slipUrl: string,
  expiresInSeconds = 300
): Promise<string | null> {
  const path = extractSlipPath(slipUrl);
  if (!path) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
