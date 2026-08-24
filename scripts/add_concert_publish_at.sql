-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- เพิ่มการตั้งเวลาเผยแพร่คอนเสิร์ตล่วงหน้า (publish_at)
-- null = เผยแพร่ทันที (พฤติกรรมเดิม), มีค่า + อยู่ในอนาคต = ไปอยู่ใน category "เร็วๆ นี้" ในหน้าแรก
-- ผู้ใช้กดดู detail ได้ (ชื่อ/โปสเตอร์/รายละเอียด/วันที่จะเปิดจอง) แต่จองไม่ได้จนกว่าจะถึงเวลา

alter table public.concerts
  add column if not exists publish_at timestamptz;
