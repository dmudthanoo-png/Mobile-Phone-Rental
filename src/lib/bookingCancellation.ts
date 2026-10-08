// Shared, client-safe presentation types. Refund amounts are enforced in SQL.
export function isRefundAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0
    && amount <= 9999999999.99 && amount === Number(amount.toFixed(2));
}

export function formatRefundAmount(amount: number) {
  return amount.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

// Mirror the authoritative SQL checks. Never use rental price/current phone
// deposit, multiply by qty again, or trust an unverified slip as the sole source.
export function resolveCancellationDeposit(booking: {
  deposit_amount?: number | string | null;
  slip_verified?: boolean | null;
  slip_verify_amount?: number | string | null;
}): { amount: number | null; error: "DEPOSIT_UNKNOWN" | "DEPOSIT_INVALID" | "DEPOSIT_MISMATCH" | null } {
  const source = booking.deposit_amount ?? (booking.slip_verified === true ? booking.slip_verify_amount : null);
  if (source == null) return { amount: null, error: "DEPOSIT_UNKNOWN" };
  const amount = Number(source);
  if (!isRefundAmount(amount)) return { amount: null, error: "DEPOSIT_INVALID" };
  if (booking.slip_verify_amount != null && Number(booking.slip_verify_amount) !== amount) {
    return { amount: null, error: "DEPOSIT_MISMATCH" };
  }
  return { amount, error: null };
}
export type CancellationSummary = {
  booking_id: string;
  refund_amount: number;
  refund_status: "pending" | "processing" | "refunded";
  cancelled_at: string;
  refunded_at: string | null;
};

export function cancellationLabel(cancellation?: CancellationSummary | null) {
  if (!cancellation || !isRefundAmount(cancellation.refund_amount)) return "ยกเลิกแล้ว — กำลังตรวจสอบสถานะคืนเงิน";
  const amount = formatRefundAmount(cancellation.refund_amount);
  return cancellation.refund_status === "refunded"
    ? `ยกเลิกแล้ว — คืนมัดจำ ${amount} บาทแล้ว`
    : `ยกเลิกแล้ว — รอคืนมัดจำ ${amount} บาท`;
}
