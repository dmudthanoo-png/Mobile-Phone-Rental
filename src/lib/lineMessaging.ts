type BookingApprovedLineMessageInput = {
  lineUserId: string | null | undefined;
  refNumber: string | null;
  renterName: string | null;
  concertTitle: string | null;
  sessionLabel: string | null;
  phoneModel: string | null;
  qty: number | null;
  lensName: string | null;
  lensQty: number | null;
  totalAmount: number | null;
  depositPaid: number | null;
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

// ── brand tokens (ต้องตรงกับธีมเว็บ: accent ชมพู + accentStrong เข้ม + accent2 ม่วง) ──
const BRAND = {
  accent: "#F2467E",
  accentStrong: "#D81F5E",
  accent2: "#8354E8",
  accentSoft: "#FFE3EE",
  gradientStart: "#FF9966",
  gradientText: "#C1440E",
  peachSoft: "#FFE8D6",
  good: "#14B866",
  goodSoft: "#E1FAEC",
  ink: "#241F1C",
  sub: "#7A6D61",
  muted: "#AB9C8D",
  line: "#F2E4D6",
  white: "#FFFFFF",
};

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

function resolveAppOrigin() {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

type FlexRowOptions = { emphasize?: boolean; highlightBg?: string; valueColor?: string };

function flexRow(label: string, value: string, opts: FlexRowOptions = {}) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    ...(opts.highlightBg
      ? { backgroundColor: opts.highlightBg, cornerRadius: "8px", paddingAll: "6px" }
      : {}),
    contents: [
      {
        type: "text",
        text: label,
        color: BRAND.sub,
        size: "sm",
        weight: "bold",
        flex: 2,
        wrap: true,
      },
      {
        type: "text",
        text: value,
        color: opts.valueColor ?? (opts.emphasize ? BRAND.accentStrong : BRAND.ink),
        size: opts.emphasize ? "md" : "sm",
        weight: opts.emphasize ? "bold" : "regular",
        flex: 3,
        wrap: true,
      },
    ],
  };
}

/**
 * สร้าง LINE Flex Message การ์ดยืนยันการจอง — แทนที่การ์ดรูปภาพเดิม (next/og)
 * ข้อดี: ไม่ต้องพึ่ง public HTTPS origin สำหรับรูป จึงใช้งานได้เหมือนกันทั้ง
 * local dev และ production, และแก้ไขดีไซน์ได้ทันทีโดยไม่ต้อง deploy รูปใหม่
 */
function buildBookingApprovedFlexMessage(input: BookingApprovedLineMessageInput) {
  const lensQty = Number.isFinite(input.lensQty) ? Math.max(Number(input.lensQty), 0) : 0;
  const hasLens = Boolean(input.lensName && lensQty > 0);
  const totalAmount = Number(input.totalAmount ?? 0);
  const depositPaid = Math.max(0, Number(input.depositPaid ?? 0));
  const balanceDue = Math.max(0, totalAmount - depositPaid);

  const rows = [
    flexRow("🎫 งาน", displayValue(input.concertTitle)),
    ...(input.renterName ? [flexRow("👤 ผู้จอง", displayValue(input.renterName))] : []),
    flexRow("🕐 รอบ", displayValue(input.sessionLabel)),
    flexRow("📱 มือถือ", `${displayValue(input.phoneModel)} × ${displayQty(input.qty)} เครื่อง`),
    ...(hasLens
      ? [flexRow("🔭 เลนส์เสริม", `${displayValue(input.lensName)} × ${lensQty} ชิ้น`, { highlightBg: BRAND.peachSoft })]
      : []),
    flexRow("💰 ยอดเช่ารวม", `฿${displayAmount(totalAmount)}`, { emphasize: true }),
    flexRow("✅ โอนแล้ว (มัดจำ)", `฿${displayAmount(depositPaid)}`, {
      emphasize: true,
      valueColor: BRAND.good,
      highlightBg: BRAND.goodSoft,
    }),
    flexRow("🏷️ ชำระตอนรับเครื่อง", `฿${displayAmount(balanceDue)}`, {
      emphasize: true,
      valueColor: BRAND.gradientText,
      highlightBg: BRAND.peachSoft,
    }),
  ];

  const origin = resolveAppOrigin();

  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      background: {
        type: "linearGradient",
        angle: "135deg",
        startColor: BRAND.gradientStart,
        endColor: BRAND.accent,
      },
      contents: [
        {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          alignItems: "center",
          contents: [
            {
              type: "box",
              layout: "vertical",
              width: "32px",
              height: "32px",
              cornerRadius: "16px",
              borderWidth: "2px",
              borderColor: "#FFFFFF",
              justifyContent: "center",
              alignItems: "center",
              contents: [
                { type: "text", text: "✓", color: BRAND.white, size: "md", weight: "bold", align: "center" },
              ],
            },
            {
              type: "text",
              text: "🎉 จองสำเร็จแล้ว",
              color: BRAND.white,
              size: "xl",
              weight: "bold",
              wrap: true,
            },
          ],
        },
      ],
    },
    ...(origin
      ? {
          hero: {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            backgroundColor: BRAND.white,
            contents: [
              {
                type: "image",
                url: `${origin}/crabby-logo.png`,
                size: "sm",
                align: "center",
                aspectMode: "fit",
              },
            ],
          },
        }
      : {}),
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        { type: "text", text: "📋 รายละเอียดการจอง", color: BRAND.gradientText, weight: "bold", size: "sm" },
        { type: "separator", color: BRAND.line, margin: "md" },
        { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: rows },
        { type: "separator", color: BRAND.line, margin: "md" },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          alignItems: "center",
          background: {
            type: "linearGradient",
            angle: "135deg",
            startColor: BRAND.peachSoft,
            endColor: BRAND.accentSoft,
          },
          borderWidth: "1px",
          borderColor: BRAND.gradientStart,
          cornerRadius: "12px",
          paddingAll: "12px",
          contents: [
            { type: "text", text: "🔖 เลขที่การจอง", color: BRAND.sub, size: "xs" },
            { type: "text", text: displayValue(input.refNumber), color: BRAND.accentStrong, size: "lg", weight: "bold", margin: "xs" },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        ...(origin
          ? [
              {
                type: "button",
                style: "primary",
                color: BRAND.gradientText,
                action: {
                  type: "uri",
                  label: "📋 ดูรายละเอียดการจอง",
                  uri: `${origin}/bookings`,
                },
              },
            ]
          : []),
        {
          type: "text",
          text: "💌 ขอบคุณที่ใช้บริการ CRABBY เช่ามือถือ",
          size: "xs",
          color: BRAND.muted,
          align: "center",
          margin: "sm",
        },
      ],
    },
  };

  const altText = `🎉 จองสำเร็จ! เลขที่การจอง ${displayValue(input.refNumber)} • ${displayValue(input.concertTitle)}`.slice(0, 400);

  return { type: "flex" as const, altText, contents: bubble };
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

export type LineFriendshipCheck =
  | { ok: true; isFriend: boolean }
  | { ok: false; reason: "not_configured" | "invalid_recipient" | "check_failed" };

/**
 * เช็คว่า LINE user นี้เพิ่มเพื่อน OA (Messaging API channel) แล้วหรือยัง —
 * ใช้ endpoint เดียวกับที่ sendBookingApprovedLineMessage ใช้วินิจฉัยตอน push
 * ล้มเหลว (200 = เป็นเพื่อน/ยังไม่บล็อก, 404 = ยังไม่เพิ่มเพื่อนหรือบล็อกอยู่)
 * เรียกจากฝั่งลูกค้าได้เองก่อนแอดมินอนุมัติ เพื่อให้มั่นใจว่าจะส่ง push ได้จริง
 */
export async function checkLineFriendshipStatus(
  lineUserId: string
): Promise<LineFriendshipCheck> {
  const accessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?.trim();
  if (!accessToken) return { ok: false, reason: "not_configured" };
  if (!lineUserIdRe.test(lineUserId)) return { ok: false, reason: "invalid_recipient" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      }
    );
    if (response.status === 404) return { ok: true, isFriend: false };
    if (response.ok) return { ok: true, isFriend: true };
    return { ok: false, reason: "check_failed" };
  } catch {
    return { ok: false, reason: "check_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ส่งข้อความ Push (Flex Message) ผ่าน LINE Messaging API หลังแอดมินยืนยันการจอง
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

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [buildBookingApprovedFlexMessage(input)],
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
