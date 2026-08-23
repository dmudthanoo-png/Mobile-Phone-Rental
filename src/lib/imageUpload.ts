const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

// เช็ค MIME type จริงจาก client + ขนาดไฟล์ ก่อนอัปโหลดรูปภาพใดๆ ในหน้าแอดมิน
// (โปสเตอร์คอนเสิร์ต, รูปมือถือ, รูปประกาศ) กันไฟล์แปลกปลอมถูกอัปโหลดแล้ว serve
// เป็น content-type ที่ผู้ใช้กำหนดเองแบบไม่ตรวจสอบ
export function validateImageUpload(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `ไฟล์ต้องเป็นรูปภาพ (jpg/png/webp) เท่านั้น ได้รับ: ${file.type || "ไม่ทราบชนิดไฟล์"}`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`;
  }
  return null;
}

// เช็ค magic bytes จริงของไฟล์ (ไม่เชื่อแค่ Content-Type ที่ client ส่งมา ซึ่งปลอมได้ง่าย)
// คืนชนิดไฟล์จริงที่ตรวจเจอ หรือ null ถ้าไม่ตรงกับรูปภาพที่รองรับเลย
export function sniffImageMimeType(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // "RIFF"
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// เช็คว่า buffer จริงของไฟล์เป็นรูปภาพที่รองรับหรือไม่ (แยกจาก validateImageUpload ที่เช็คแค่
// Content-Type/ขนาดจาก client) ใช้คู่กันเสมอ — client บอกอะไรมาไม่สำคัญเท่าไบต์จริงในไฟล์
export function validateImageBuffer(buffer: Buffer): string | null {
  if (!sniffImageMimeType(buffer)) {
    return "ไฟล์ไม่ใช่รูปภาพที่รองรับ (jpg/png/webp) ตรวจสอบจากเนื้อหาไฟล์จริงแล้วไม่ตรง";
  }
  return null;
}
