-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เพิ่มสถานะ "แสดงผล/ไม่แสดงผล" (is_visible) ให้คอนเสิร์ต แยกต่างหากจาก archived
-- archived = คอนเสิร์ตที่จบ/เลิกใช้แล้ว (ย้ายไปอยู่แท็บ "ที่ archive แล้ว")
-- is_visible = สลับซ่อน/แสดงคอนเสิร์ตปัจจุบันจากหน้าแรกได้ทันที โดยไม่ต้องย้ายไป archive
-- ต้องเป็นทั้ง archived=false และ is_visible=true ถึงจะโชว์ในหน้าแรกลูกค้า

alter table public.concerts
  add column if not exists is_visible boolean not null default true;
