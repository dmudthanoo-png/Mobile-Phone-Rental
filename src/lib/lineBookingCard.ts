import { SignJWT, jwtVerify } from "jose";

const CARD_AUDIENCE = "line-booking-card";
const CARD_ISSUER = "mobile-phone-rental";
const CARD_TOKEN_LIFETIME = "365d";

function getCardSigningSecret() {
  // แยก secret ได้เมื่อพร้อม แต่ใช้ session secret เดิมเป็น fallback เพื่อให้
  // deployment ปัจจุบันเปิดใช้บัตรภาพได้ทันทีโดยไม่ทำให้การแจ้งเตือนเดิมหยุดทำงาน
  return (
    process.env.LINE_BOOKING_CARD_SECRET?.trim() ||
    process.env.APP_SESSION_SECRET?.trim() ||
    null
  );
}

function getCardSigningKey() {
  const secret = getCardSigningSecret();
  return secret ? new TextEncoder().encode(secret) : null;
}

function toHttpsOrigin(value: string | undefined | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const withProtocol = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;

  try {
    const url = new URL(withProtocol);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * LINE ต้องดึงรูปจาก URL สาธารณะที่เป็น HTTPS เท่านั้น
 * APP_BASE_URL ใน .env.local อาจเป็น localhost จึงข้ามและ fallback ไปยัง
 * Vercel URL เมื่อรันบน deployment
 */
export function getLineBookingCardPublicOrigin() {
  return (
    toHttpsOrigin(process.env.LINE_BOOKING_CARD_BASE_URL) ||
    toHttpsOrigin(process.env.APP_BASE_URL) ||
    toHttpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    toHttpsOrigin(process.env.VERCEL_URL)
  );
}

export type LineBookingCardUrls = {
  originalContentUrl: string;
  previewImageUrl: string;
};

export async function createLineBookingCardUrls(
  bookingId: string
): Promise<LineBookingCardUrls | null> {
  const origin = getLineBookingCardPublicOrigin();
  const signingKey = getCardSigningKey();
  if (!origin || !signingKey || !bookingId) return null;

  const token = await new SignJWT({ purpose: CARD_AUDIENCE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(CARD_ISSUER)
    .setAudience(CARD_AUDIENCE)
    .setSubject(bookingId)
    .setIssuedAt()
    .setExpirationTime(CARD_TOKEN_LIFETIME)
    .sign(signingKey);

  const original = new URL(`/api/line/booking-card/${encodeURIComponent(bookingId)}`, origin);
  original.searchParams.set("token", token);

  const preview = new URL(original);
  preview.searchParams.set("preview", "1");

  return {
    originalContentUrl: original.toString(),
    previewImageUrl: preview.toString(),
  };
}

export async function verifyLineBookingCardToken(
  token: string | null | undefined,
  bookingId: string
) {
  const signingKey = getCardSigningKey();
  if (!token || !bookingId || !signingKey) return false;

  try {
    const { payload } = await jwtVerify(token, signingKey, {
      issuer: CARD_ISSUER,
      audience: CARD_AUDIENCE,
    });

    return payload.sub === bookingId && payload.purpose === CARD_AUDIENCE;
  } catch {
    return false;
  }
}
