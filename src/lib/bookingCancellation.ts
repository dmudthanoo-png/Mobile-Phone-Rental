// Shared, client-safe presentation types. Refund amounts are enforced in SQL.
export const CANCELLATION_REFUND_AMOUNT = 100;
export type CancellationSummary = {
  booking_id: string;
  refund_amount: number;
  refund_status: "pending" | "processing" | "refunded";
  cancelled_at: string;
  refunded_at: string | null;
};

export function cancellationLabel(cancellation?: CancellationSummary | null) {
  if (!cancellation) return "ยกเลิกแล้ว — กำลังตรวจสอบสถานะคืนเงิน";
  return cancellation.refund_status === "refunded"
    ? "ยกเลิกแล้ว — คืนมัดจำ 100 บาทแล้ว"
    : "ยกเลิกแล้ว — รอคืนมัดจำ 100 บาท";
}
