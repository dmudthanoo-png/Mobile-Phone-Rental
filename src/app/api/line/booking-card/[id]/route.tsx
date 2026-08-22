import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineBookingCardToken } from "@/lib/lineBookingCard";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const thaiFont = fetch(new URL("./NotoSansThai-Regular.ttf", import.meta.url)).then(
  (response) => response.arrayBuffer()
);

type BookingCardRow = {
  id: string;
  status: string | null;
  ref_number: string | null;
  renter_name: string | null;
  total_amount: number | null;
  qty: number | null;
  lens_qty: number | null;
  phones: { model_name: string | null } | null;
  lenses: { name: string | null } | null;
  concert_sessions: {
    start_at: string | null;
    note: string | null;
    concerts: { title: string | null; venue_name: string | null } | null;
  } | null;
};

type BookingCardRowRaw = BookingCardRow | BookingCardRow[] | null;

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cleanText(value: string | null | undefined, fallback = "-") {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function clampText(value: string | null | undefined, maxLength: number, fallback = "-") {
  const normalized = cleanText(value, fallback);
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1))}…` : normalized;
}

function positiveQuantity(value: number | null | undefined, fallback = 1) {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : fallback;
}

function formatAmount(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `฿${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(
    Number.isFinite(amount) ? Math.max(0, amount) : 0
  )}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function BookingCard({
  booking,
  logoUrl,
  preview,
}: {
  booking: BookingCardRow;
  logoUrl: string;
  preview: boolean;
}) {
  const scale = preview ? 0.5 : 1;
  const size = (value: number) => Math.round(value * scale);
  const session = firstRelation(booking.concert_sessions);
  const concert = firstRelation(session?.concerts);
  const phone = firstRelation(booking.phones);
  const lens = firstRelation(booking.lenses);
  const lensQty = positiveQuantity(booking.lens_qty, 0);
  const hasLens = Boolean(lens?.name && lensQty > 0);
  const rows = [
    { label: "งาน", value: clampText(concert?.title, 56) },
    { label: "ผู้จอง", value: clampText(booking.renter_name, 42) },
    {
      label: "วันรับ",
      value: clampText(
        `${formatDateTime(session?.start_at)}${session?.note ? ` • ${cleanText(session.note)}` : ""}`,
        50
      ),
    },
    {
      label: "มือถือ",
      value: clampText(`${cleanText(phone?.model_name)} × ${positiveQuantity(booking.qty)} เครื่อง`, 46),
    },
    ...(hasLens
      ? [
          {
            label: "เลนส์เสริม",
            value: clampText(`${cleanText(lens?.name)} × ${lensQty} ชิ้น`, 46),
            highlighted: true,
          },
        ]
      : []),
    { label: "ยอดชำระ", value: formatAmount(booking.total_amount) },
  ];

  return (
    <div
      style={{
        width: size(1080),
        height: size(1440),
        display: "flex",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#fde8ee",
        color: "#2d2020",
        fontFamily: "Noto Sans Thai",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          width: size(520),
          height: size(520),
          left: size(-245),
          top: size(-172),
          borderRadius: "999px",
          backgroundColor: "#f9cdd9",
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          width: size(400),
          height: size(400),
          right: size(-165),
          bottom: size(-135),
          borderRadius: "999px",
          backgroundColor: "#f7c8d6",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: size(908),
          height: size(1280),
          margin: `${size(80)}px ${size(86)}px`,
          backgroundColor: "#fffdfd",
          borderRadius: size(42),
          overflow: "hidden",
          border: `${size(4)}px solid #ef9aab`,
          boxShadow: `0 ${size(20)}px ${size(46)}px rgba(81, 35, 44, 0.2)`,
        }}
      >
        <div
          style={{
            minHeight: size(176),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: size(20),
            padding: `0 ${size(42)}px`,
            color: "#fff",
            backgroundColor: "#f15e76",
            backgroundImage: "linear-gradient(135deg, #ff866d 0%, #ed537a 100%)",
          }}
        >
          <div
            style={{
              display: "flex",
              width: size(54),
              height: size(54),
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "999px",
              border: `${size(4)}px solid rgba(255,255,255,.9)`,
              fontSize: size(32),
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <div style={{ display: "flex", fontSize: size(61), fontWeight: 700, letterSpacing: size(1) }}>
            จองสำเร็จ
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: `${size(42)}px ${size(55)}px ${size(40)}px`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: size(17), color: "#e95e77" }}>
            <div
              style={{
                display: "flex",
                width: size(42),
                height: size(42),
                alignItems: "center",
                justifyContent: "center",
                borderRadius: size(10),
                border: `${size(3)}px solid #e95e77`,
                fontSize: size(24),
              }}
            >
              ▤
            </div>
            <div style={{ display: "flex", fontSize: size(39), fontWeight: 700 }}>รายละเอียดการจอง</div>
          </div>
          <div style={{ display: "flex", height: size(3), margin: `${size(28)}px 0 ${size(16)}px`, backgroundColor: "#f6c6d1" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: size(8) }}>
            {rows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  minHeight: size(72),
                  padding: row.highlighted ? `${size(6)}px ${size(14)}px` : 0,
                  borderRadius: row.highlighted ? size(15) : 0,
                  backgroundColor: row.highlighted ? "#fff1e9" : "transparent",
                }}
              >
                <div style={{ display: "flex", width: size(190), color: "#78545a", fontSize: size(29), fontWeight: 700 }}>
                  {row.label}
                </div>
                <div
                  style={{
                    display: "flex",
                    flex: 1,
                    fontSize: size(row.label === "ยอดชำระ" ? 37 : 30),
                    fontWeight: row.label === "ยอดชำระ" ? 700 : 400,
                    color: row.label === "ยอดชำระ" ? "#e45471" : "#2d2020",
                    lineHeight: 1.22,
                  }}
                >
                  {row.value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", height: size(3), margin: `${size(22)}px 0 ${size(12)}px`, backgroundColor: "#f6c6d1" }} />
          <div style={{ display: "flex", justifyContent: "center", height: size(200), alignItems: "center" }}>
            {/* ImageResponse renders a remote image source; next/image is unavailable in an OG route. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              width={size(290)}
              height={size(180)}
              style={{ objectFit: "contain" }}
              alt="Crabby เช่ามือถือ"
            />
          </div>
          <div style={{ display: "flex", height: size(3), margin: `${size(6)}px 0 ${size(25)}px`, backgroundColor: "#f6c6d1" }} />

          <div style={{ display: "flex", alignItems: "center", gap: size(15), color: "#e95e77" }}>
            <div
              style={{
                display: "flex",
                width: size(39),
                height: size(39),
                alignItems: "center",
                justifyContent: "center",
                borderRadius: size(9),
                border: `${size(3)}px solid #e95e77`,
                fontSize: size(22),
              }}
            >
              #
            </div>
            <div style={{ display: "flex", fontSize: size(30), fontWeight: 700 }}>เลขอ้างอิง</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: size(88),
              marginTop: size(16),
              borderRadius: size(18),
              border: `${size(3)}px dashed #ef9aab`,
              color: "#292020",
              fontSize: size(39),
              fontWeight: 700,
              letterSpacing: size(2),
            }}
          >
            {clampText(booking.ref_number, 36)}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: "auto",
              color: "#d95e77",
            }}
          >
            <div style={{ display: "flex", fontSize: size(29), fontWeight: 700 }}>ขอบคุณที่ใช้บริการ</div>
            <div style={{ display: "flex", marginTop: size(4), fontSize: size(25), color: "#382426", fontWeight: 700 }}>
              CRABBY เช่ามือถือ
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  const { id } = await ctx.params;
  const token = request.nextUrl.searchParams.get("token");
  if (!id || !(await verifyLineBookingCardToken(token, id))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new NextResponse("Unable to render booking card", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: bookingRaw, error } = await supabase
    .from("bookings")
    .select(
      "id, status, ref_number, renter_name, total_amount, qty, lens_qty, " +
        "phones:phone_id ( model_name ), lenses:lens_id ( name ), " +
        "concert_sessions:session_id ( start_at, note, concerts:concert_id ( title, venue_name ) )"
    )
    .eq("id", id)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error || !bookingRaw) {
    return new NextResponse("Not found", { status: 404 });
  }

  const booking = bookingRaw as unknown as BookingCardRowRaw;
  if (Array.isArray(booking) || !booking) {
    return new NextResponse("Not found", { status: 404 });
  }

  const preview = request.nextUrl.searchParams.get("preview") === "1";
  const logoUrl = new URL("/crabby-logo.png", request.nextUrl.origin).toString();
  const fontData = await thaiFont;

  return new ImageResponse(<BookingCard booking={booking} logoUrl={logoUrl} preview={preview} />, {
    width: preview ? 540 : 1080,
    height: preview ? 720 : 1440,
    fonts: [
      {
        name: "Noto Sans Thai",
        data: fontData,
        weight: 400,
        style: "normal",
      },
      {
        name: "Noto Sans Thai",
        data: fontData,
        weight: 700,
        style: "normal",
      },
    ],
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
