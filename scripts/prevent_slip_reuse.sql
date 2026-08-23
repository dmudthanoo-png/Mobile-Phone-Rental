-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- กันสลิปโอนใบเดียวกัน (transaction reference เดียวกัน) ถูกใช้ยืนยันมากกว่า 1 booking
-- ใช้ partial unique index เฉพาะแถวที่ slip_verified = true และมี ref เท่านั้น
-- (แถวที่ยังไม่ verify หรือ verify ไม่ผ่านไม่ต้องกันซ้ำ เพราะไม่ได้ถูกใช้ "ยืนยัน" อะไรจริง)

create unique index if not exists bookings_slip_verify_ref_unique_when_verified
  on public.bookings (slip_verify_ref)
  where slip_verified = true and slip_verify_ref is not null;
