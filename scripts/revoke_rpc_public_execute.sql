-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ปิดสิทธิ์เรียก RPC โดยตรงสำหรับ role anon/authenticated
--
-- เหตุผล: Postgres มี default behavior ว่า function ใหม่ใน schema public จะได้สิทธิ์
-- EXECUTE ให้ role PUBLIC (รวม anon และ authenticated ที่ Supabase ใช้) โดยอัตโนมัติ
-- เว้นแต่จะ REVOKE ออกเอง ฟังก์ชัน create_pending_booking_if_available_v2 และ
-- reject_booking_and_restore ทั้งคู่รับพารามิเตอร์ตรงๆ (เช่น p_user_id, p_total_amount)
-- โดยไม่เช็ค session/ราคา/สลิปเองเลย — ฝั่ง Next.js (upload-slip route) เป็นคนตรวจสอบ
-- ทั้งหมดนี้ก่อนเรียก RPC ถ้า role anon/authenticated เรียก RPC ตรงได้ (ผ่าน anon key
-- ที่เป็นสาธารณะอยู่แล้ว) จะข้ามการตรวจสอบทั้งหมดนั้นไปได้ทันที เช่น ปลอม user_id
-- เป็นคนอื่น หรือใส่ total_amount เป็น 0 ได้ตรงๆ
--
-- โค้ดของแอปเองเรียกผ่าน service role key เสมอ (ไม่ได้รับผลกระทบจากการ revoke นี้)

-- ต้อง revoke จาก PUBLIC ด้วยเสมอ — Postgres ให้สิทธิ์ EXECUTE กับ PUBLIC (ทุก role
-- รวม anon/authenticated โดย inherit มาอัตโนมัติ) เป็นค่าเริ่มต้นตอนสร้างฟังก์ชัน
-- revoke แค่ anon/authenticated เฉยๆ ไม่มีผล เพราะสิทธิ์ที่ inherit จาก PUBLIC ยังอยู่
revoke execute on function public.create_pending_booking_if_available_v2(
  uuid, uuid, uuid, integer, uuid, integer, text, text, numeric, text, text
) from PUBLIC, anon, authenticated;

revoke execute on function public.reject_booking_and_restore(uuid) from PUBLIC, anon, authenticated;

-- ── เช็คก่อน/หลัง: ดูว่า function ไหนใน public schema ยังให้สิทธิ์ anon/authenticated
-- เรียกตรงได้อยู่บ้าง (โดยเฉพาะตัวที่ไม่ได้ตั้งใจให้เรียกจาก client โดยตรง) ──
-- select
--   p.proname as function_name,
--   pg_get_userbyid(p.proowner) as owner,
--   has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
--   has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
-- order by function_name;
