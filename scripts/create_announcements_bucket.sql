-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- แก้ปัญหา "upload failed: Bucket not found" ตอนอัปโหลดรูป banner ในแท็บ "ประกาศ"
-- เพราะยังไม่เคยสร้าง storage bucket ชื่อ "announcements" ไว้ (โค้ดอ้างถึงอยู่แล้วแต่ bucket ไม่มีจริง)
-- ตั้งเป็น public เหมือน bucket "posters"/"phones" เพราะเป็นรูปที่โชว์หน้าแรกให้ทุกคนเห็นอยู่แล้ว

insert into storage.buckets (id, name, public)
values ('announcements', 'announcements', true)
on conflict (id) do nothing;

-- เช็คผลลัพธ์
select id, name, public, created_at
from storage.buckets
where id = 'announcements';
