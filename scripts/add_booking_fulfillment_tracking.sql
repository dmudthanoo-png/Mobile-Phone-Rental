-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
--
-- ═══ ระบบติดตามงานหลังยืนยันการจอง (ส่งมอบเครื่อง / คืนเครื่อง / ส่งไฟล์) ═══
--
-- ⚠️ ตั้งใจ "ไม่" เพิ่มค่าใหม่ในคอลัมน์ status เดิม เพราะ status = 'confirmed' ถูกใช้นับสต็อกอยู่ 23 จุด
-- ถ้าเปลี่ยน status เป็น 'delivered'/'returned' ระบบจะเลิกนับเครื่องนั้นว่าถูกจอง → เครื่องที่อยู่กับ
-- ลูกค้าจะกลายเป็น "ว่าง" ให้คนอื่นจองซ้อนได้ทันที จึงแยกเป็นคอลัมน์เวลาต่างหากแทน
--
-- เก็บเป็น "เวลาที่ทำเสร็จ" (ไม่ใช่ true/false) เพราะได้ข้อมูลว่าทำเมื่อไหร่มาฟรีๆ
-- ค่าว่าง (null) = ยังไม่ได้ทำ · กดผิดก็ล้างกลับเป็น null ได้

alter table public.bookings
  add column if not exists delivered_at    timestamptz,  -- ส่งมอบเครื่องให้ลูกค้าแล้ว
  add column if not exists returned_at     timestamptz,  -- ลูกค้าคืนเครื่องแล้ว
  add column if not exists files_sent_at   timestamptz,  -- ส่งไฟล์รูป/วิดีโอให้ลูกค้าแล้ว
  add column if not exists fulfillment_note text;        -- หมายเหตุ เช่น สภาพเครื่องตอนคืน/ความเสียหาย

-- ช่วยให้หน้า "ติดตามงาน" ที่กรองตามความคืบหน้าเร็วขึ้น (เฉพาะรายการที่ยืนยันแล้วเท่านั้นที่เข้าหน้านี้)
create index if not exists bookings_fulfillment_idx
  on public.bookings (status, delivered_at, returned_at, files_sent_at)
  where status = 'confirmed';
