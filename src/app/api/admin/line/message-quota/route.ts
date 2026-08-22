import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type LineQuotaResponse = {
  type?: unknown;
  value?: unknown;
};

type LineConsumptionResponse = {
  totalUsage?: unknown;
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// GET /api/admin/line/message-quota — สถานะ Messaging API + โควต้าของเดือนปัจจุบัน
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return response({ error: "unauthorized" }, 401);

  const accessToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return response({
      status: "not_configured",
      used: null,
      limit: null,
      remaining: null,
      refreshedAt: new Date().toISOString(),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const [quotaRes, consumptionRes] = await Promise.all([
      fetch("https://api.line.me/v2/bot/message/quota", {
        headers,
        signal: controller.signal,
      }),
      fetch("https://api.line.me/v2/bot/message/quota/consumption", {
        headers,
        signal: controller.signal,
      }),
    ]);

    if (!quotaRes.ok || !consumptionRes.ok) {
      console.error("LINE quota lookup failed", {
        quotaStatus: quotaRes.status,
        consumptionStatus: consumptionRes.status,
      });
      return response(
        {
          status: "error",
          message:
            quotaRes.status === 401 || consumptionRes.status === 401
              ? "invalid_or_expired_token"
              : "line_api_unavailable",
          used: null,
          limit: null,
          remaining: null,
          refreshedAt: new Date().toISOString(),
        },
        502
      );
    }

    const quota = (await quotaRes.json()) as LineQuotaResponse;
    const consumption = (await consumptionRes.json()) as LineConsumptionResponse;
    const used =
      typeof consumption.totalUsage === "number" && Number.isFinite(consumption.totalUsage)
        ? Math.max(0, Math.floor(consumption.totalUsage))
        : 0;

    if (quota.type !== "limited" || typeof quota.value !== "number" || !Number.isFinite(quota.value)) {
      return response({
        status: "connected",
        quotaType: "none",
        used,
        limit: null,
        remaining: null,
        refreshedAt: new Date().toISOString(),
      });
    }

    const limit = Math.max(0, Math.floor(quota.value));
    return response({
      status: "connected",
      quotaType: "limited",
      used,
      limit,
      remaining: Math.max(limit - used, 0),
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.error("LINE quota lookup failed:", timedOut ? "request timed out" : error);
    return response(
      {
        status: "error",
        message: timedOut ? "request_timed_out" : "connection_failed",
        used: null,
        limit: null,
        remaining: null,
        refreshedAt: new Date().toISOString(),
      },
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}
