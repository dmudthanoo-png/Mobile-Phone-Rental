-- รันครั้งเดียวใน Supabase SQL Editor เพื่อสร้างตารางเก็บรีวิวลูกค้า
-- (โปรเจกต์นี้ไม่มีระบบ migration ในโค้ด จึงต้องรันเองตรงนี้)

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  concert_title text,
  display_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(comment) between 1 and 1000),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists reviews_is_published_idx on public.reviews (is_published);
create index if not exists reviews_user_id_idx on public.reviews (user_id);

-- เปิด RLS แต่ไม่เพิ่ม policy ให้ anon/authenticated เพราะแอปนี้เข้าถึงทุกตารางผ่าน
-- service role key จาก API route ฝั่ง server เท่านั้น (แบบเดียวกับตาราง bookings เดิม)
alter table public.reviews enable row level security;
