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
