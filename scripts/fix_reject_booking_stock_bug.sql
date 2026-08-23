-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- แก้บั๊ก: reject_booking_and_restore บวก phones.qty เพิ่มทุกครั้งที่ปฏิเสธการจอง
-- ทั้งที่ create_pending_booking_if_available_v2 ไม่เคยหักลบ phones.qty ตอนสร้าง booking เลย
-- (คำนวณ "คงเหลือ" แบบสดจากการนับ booking ที่ status เป็น confirmed/pending ทุกครั้งอยู่แล้ว)
-- ผลคือทุกครั้งที่ปฏิเสธการจอง phones.qty จะถูกบวกเพิ่มถาวรทีละ 1 แบบผิดๆ

-- ═══════════════════════════════════════════════════════════════
-- 1) แก้ reject_booking_and_restore — เอาการบวก qty ที่ผิดออก
--    (แค่เปลี่ยนสถานะเป็น rejected ก็พอ ไม่ต้องคืนสต็อกเพราะไม่เคยถูกหักไป)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reject_booking_and_restore(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update bookings
  set status = 'rejected'
  where id = p_booking_id
    and status = 'pending';

  if not found then
    raise exception 'NOT_PENDING';
  end if;
end;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 2) [ยกเลิกแล้ว — ห้ามรันไฟล์นี้ซ้ำถ้าเคยรัน add_mandatory_session_phone_quota.sql ไปแล้ว]
--    เดิมส่วนนี้เคยมี CREATE OR REPLACE FUNCTION create_pending_booking_if_available_v2
--    เวอร์ชันที่ยัง check stock จาก phones.qty (จำนวนรวมร้าน) ซึ่งถูกแทนที่ไปแล้วด้วย
--    เวอร์ชันใหม่ใน scripts/add_mandatory_session_phone_quota.sql ที่ check จาก
--    session_phone_inventory (โควต้าต่อรอบ) แทน — เอาออกจากไฟล์นี้แล้วเพื่อไม่ให้ใครรัน
--    ไฟล์นี้ซ้ำแล้วไปทับเวอร์ชันใหม่กลับเป็นเวอร์ชันเก่าโดยไม่ตั้งใจ
--    ถ้าต้องการแก้ create_pending_booking_if_available_v2 ให้ไปแก้ที่
--    scripts/add_mandatory_session_phone_quota.sql เท่านั้น (เป็นไฟล์ที่ current จริง)
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 3) (แนะนำให้รันดูก่อน — ยังไม่แก้อะไร) ประเมินว่า phones.qty
--    แต่ละรุ่นถูกบั๊กนี้บวกเกินไปเท่าไหร่แล้ว โดยนับจากประวัติ
--    booking ที่เคยถูกปฏิเสธทั้งหมด (ทุกครั้งที่ reject = บวกผิด +1)
--
--    estimated_correct_qty เป็นแค่ "ค่าประมาณ" โดยสมมติว่าไม่เคยมีใคร
--    แก้ phones.qty ด้วยมือเพื่อชดเชยบั๊กนี้มาก่อน — ควรเทียบกับจำนวน
--    เครื่องจริงที่ร้านมีก่อนตัดสินใจว่าจะ UPDATE ค่าไหน
-- ═══════════════════════════════════════════════════════════════
select
  p.id,
  p.model_name,
  p.qty as current_qty,
  coalesce(r.rejected_count, 0) as excess_added_by_bug,
  p.qty - coalesce(r.rejected_count, 0) as estimated_correct_qty
from public.phones p
left join (
  select phone_id, count(*) as rejected_count
  from public.bookings
  where status = 'rejected'
  group by phone_id
) r on r.phone_id = p.id
order by excess_added_by_bug desc;
