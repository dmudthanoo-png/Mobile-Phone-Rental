import { createLineBookingCardUrls } from "@/lib/lineBookingCard";

type BookingApprovedLineMessageInput = {
  bookingId: string;
  lineUserId: string | null | undefined;
  refNumber: string | null;
  concertTitle: string | null;
  sessionLabel: string | null;
  phoneModel: string | null;
  qty: number | null;
  lensName: string | null;
  lensQty: number | null;
  totalAmount: number | null;
};

export type LinePushResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "not_configured"
        | "missing_recipient"
        | "invalid_recipient"
        | "recipient_unavailable"
        | "quota_exceeded"
        | "delivery_failed"
        | "timed_out";
      httpStatus?: number;
      errorDetail?: string;
      requestId?: string;
    };

const lineUserIdRe = /^U[0-9a-f]{32}$/i;

function displayValue(value: string | null | undefined, fallback = "-") {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 300) : fallback;
}

function displayQty(value: number | null) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 1;
}

function displayAmount(value: number | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(
    Number.isFinite(amount) ? Math.max(amount, 0) : 0
  );
}

function buildBookingApprovedText(input: BookingApprovedLineMessageInput) {
  const lines = [
    "🎉 การจองของคุณได้รับการยืนยันแล้ว",
    "",
    `เลขที่การจอง: ${displayValue(input.refNumber)}`,
    `งาน: ${displayValue(input.concertTitle)}`,
    `รอบ: ${displayValue(input.sessionLabel)}`,
    `มือถือ: ${displayValue(input.phoneModel)} × ${displayQty(input.qty)} เครื่อง`,
  ];

  const lensQty = Number.isFinite(input.lensQty)
    ? Math.max(Number(input.lensQty), 0)
    : 0;
  if (input.lensName && lensQty > 0) {
    lines.push(`เลนส์: ${displayValue(input.lensName)} × ${lensQty} ชิ้น`);
  }

  lines.push(
    `ยอดชำระ: ฿${displayAmount(input.totalAmount)}`,
    "",
    "ดูรายละเอียดได้ที่เมนู ‘ประวัติการจอง’ ในระบบ"
  );

  return lines.join("\n");
}

function normalizeLineErrorMessage(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 300) : null;
}

type LineApiFailureDetails = {
  httpStatus: number;
  errorDetail?: string;
  requestId?: string;
};

async function readLineApiFailure(response: Response): Promise<LineApiFailureDetails> {
  const lineError = await response.json().catch(() => null) as {
    message?: unknown;
  } | null;
  const errorDetail =
    normalizeLineErrorMessage(lineError?.message) ??
    normalizeLineErrorMessage(response.statusText);
  const requestId = response.headers.get("x-line-request-id") ?? undefined;

  return {
    httpStatus: response.status,
    ...(errorDetail ? { errorDetail } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

async function checkLineRecipient(
  accessToken: string,
  lineUserId: string,
  signal: AbortSignal
): Promise<LineApiFailureDetails | null> {
  const response = await fetch(
    `https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    }
  );

  return response.ok ? null : readLineApiFailure(response);
}

/**
 * ส่งข้อความ Push ผ่าน LINE Messaging API หลังแอดมินยืนยันการจอง
 *
 * LINE Login และ Messaging API ต้องอยู่ใต้ Provider เดียวกัน จึงจะใช้
 * LINE user ID เดียวกันได้ และผู้ใช้ต้องเพิ่ม LINE OA เป็นเพื่อนแล้ว
 */
export async function sendBookingApprovedLineMessage(
  input: BookingApprovedLineMessageInput
): Promise<LinePushResult> {
  const accessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    console.error("LINE approval notification skipped: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured");
    return { sent: false, reason: "not_configured" };
  }

  const lineUserId = input.lineUserId?.trim();
  if (!lineUserId) {
    console.error("LINE approval notification skipped: booking has no LINE user ID");
    return { sent: false, reason: "missing_recipient" };
  }
  if (!lineUserIdRe.test(lineUserId)) {
    console.error("LINE approval notification skipped: invalid LINE user ID format");
    return { sent: false, reason: "invalid_recipient" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const bookingCardUrls = await createLineBookingCardUrls(input.bookingId);

  // ใน production ส่งบัตรภาพที่มีข้อมูลการจองจริง ส่วน local ที่ LINE เข้าถึง
  // ไม่ได้ (เช่น APP_BASE_URL = localhost) จะยังส่งข้อความปกติแทน เพื่อไม่ให้
  // การยืนยันการจองขาดหายระหว่างพัฒนา
  const messages = bookingCardUrls
    ? [
        {
          type: "image" as const,
          originalContentUrl: bookingCardUrls.originalContentUrl,
          previewImageUrl: bookingCardUrls.previewImageUrl,
        },
      ]
    : [{ type: "text" as const, text: buildBookingApprovedText(input) }];

  if (!bookingCardUrls) {
    console.warn(
      "LINE approval notification is using text fallback because a public HTTPS booking-card URL is unavailable"
    );
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // LINE uses HTTP 429 for both API rate limits and the monthly message
      // limit. Only classify it as a quota issue when LINE explicitly says so.
      const pushFailure = await readLineApiFailure(response);
      const quotaExceeded =
        pushFailure.httpStatus === 429 &&
        typeof pushFailure.errorDetail === "string" &&
        /reached\s+your\s+monthly\s+limit/i.test(pushFailure.errorDetail);

      // Failed-to-send (400) is usually caused by a LINE user ID that is not
      // valid for this OA. Confirm it using LINE's profile endpoint so the
      // booking status gives an actionable answer instead of a generic 400.
      if (pushFailure.httpStatus === 400) {
        const recipientFailure = await checkLineRecipient(
          accessToken,
          lineUserId,
          controller.signal
        );

        if (recipientFailure) {
          const recipientDetail = [
            pushFailure.errorDetail,
            `ตรวจสอบผู้รับไม่ผ่าน: HTTP ${recipientFailure.httpStatus}`,
            recipientFailure.errorDetail,
          ]
            .filter((value): value is string => Boolean(value))
            .join(" · ");

          console.error("LINE approval recipient is unavailable", {
            pushStatus: pushFailure.httpStatus,
            recipientStatus: recipientFailure.httpStatus,
            requestId: pushFailure.requestId,
          });
          return {
            sent: false,
            reason: "recipient_unavailable",
            httpStatus: pushFailure.httpStatus,
            ...(recipientDetail ? { errorDetail: recipientDetail } : {}),
            ...(pushFailure.requestId ? { requestId: pushFailure.requestId } : {}),
          };
        }

        // The recipient is valid for this OA, so leave evidence in the record
        // that the remaining issue is the push request rather than the user ID.
        const verifiedRecipientDetail = [
          pushFailure.errorDetail,
          "ตรวจสอบผู้รับผ่าน (HTTP 200)",
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ");
        return {
          sent: false,
          reason: "delivery_failed",
          httpStatus: pushFailure.httpStatus,
          ...(verifiedRecipientDetail ? { errorDetail: verifiedRecipientDetail } : {}),
          ...(pushFailure.requestId ? { requestId: pushFailure.requestId } : {}),
        };
      }

      console.error("LINE approval notification failed", {
        status: pushFailure.httpStatus,
        errorDetail: pushFailure.errorDetail,
        requestId: pushFailure.requestId,
      });
      return {
        sent: false,
        reason: quotaExceeded ? "quota_exceeded" : "delivery_failed",
        ...pushFailure,
      };
    }

    return { sent: true };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.error(
      "LINE approval notification failed:",
      timedOut ? "request timed out" : error instanceof Error ? error.message : error
    );
    return { sent: false, reason: timedOut ? "timed_out" : "delivery_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
