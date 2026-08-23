import crypto from "crypto";

// ไม่ใช้ bcrypt/argon2 (ต้อง native binding เพิ่ม dependency) ใช้ scrypt ที่มีมากับ Node แทน
// เก็บเป็น "salt:hash" ทั้งคู่เป็น hex เทียบแบบ constant-time กัน timing attack
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const given = crypto.scryptSync(password, salt, KEY_LEN);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}
