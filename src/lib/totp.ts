import crypto from "crypto";

// TOTP (RFC 6238) บน HOTP (RFC 4226) แบบมือ ไม่ใช้ lib สำเร็จรูป (ใช้ crypto ที่มีอยู่แล้ว)
// เข้ากันได้กับ Google Authenticator / Microsoft Authenticator ทุกตัวที่รองรับมาตรฐานนี้

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

// ── เข้ารหัส totp_secret ก่อนเก็บลง DB (AES-256-GCM, key แยกจาก DB ผ่าน env) ──
// ค่าที่เก็บจริงคือ "v1:<iv>:<authTag>:<ciphertext>" (ทุกส่วน base64)
// รองรับ secret เก่าที่ยังเป็น plaintext (ไม่มี prefix "v1:") เพื่อไม่ให้บัญชีที่เปิด 2FA
// ไว้ก่อนหน้านี้ใช้งานไม่ได้ทันที — เมื่อ verify ผ่านครั้งถัดไปจะเข้ารหัสทับให้อัตโนมัติ (self-heal)
const ENC_PREFIX = "v1:";

function getTotpEncryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) throw new Error("missing TOTP_ENCRYPTION_KEY env");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY ต้อง decode เป็น 32 bytes (base64 ของ AES-256 key)");
  }
  return key;
}

export function isLegacyPlaintextTotpSecret(stored: string): boolean {
  return !stored.startsWith(ENC_PREFIX);
}

export function encryptTotpSecret(plainSecret: string): string {
  const key = getTotpEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptTotpSecret(stored: string): string {
  if (isLegacyPlaintextTotpSecret(stored)) return stored;
  const key = getTotpEncryptionKey();
  const [, ivB64, tagB64, ctB64] = stored.split(":");
  const iv = Buffer.from(ivB64 ?? "", "base64");
  const authTag = Buffer.from(tagB64 ?? "", "base64");
  const ciphertext = Buffer.from(ctB64 ?? "", "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

// เหมือน decryptTotpSecret แต่ไม่ throw — ใช้ตอนต้อง fail ด้วย error message ที่ชัดเจน
// (เช่น TOTP_ENCRYPTION_KEY หายไปหลัง deploy หรือค่าที่เก็บไว้เสียหาย) แทนที่จะปล่อยให้ route แตกแบบ 500 เปล่าๆ
export function safeDecryptTotpSecret(stored: string): string | null {
  try {
    return decryptTotpSecret(stored);
  } catch {
    return null;
  }
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);

  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function generateTotpUri(secretBase32: string, username: string, issuer = "Crabby Admin"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// windowSteps=1 → ยอมรับรหัสของช่วงเวลาก่อน/หลังปัจจุบัน ±30 วิ กันนาฬิกาเหลื่อม
export function verifyTotpCode(secretBase32: string, code: string, windowSteps = 1): boolean {
  const cleanCode = String(code ?? "").trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const secret = base32Decode(secretBase32);
  const currentStep = Math.floor(Date.now() / 1000 / STEP_SECONDS);

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    if (hotp(secret, currentStep + offset) === cleanCode) return true;
  }
  return false;
}
