-- ให้ผู้ใช้รันเองใน Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- แก้เฉพาะหน้า: เพิ่มเลนส์เข้า "การจองที่แอดมินยืนยันไปแล้ว" ทีละ 1 รายการ
--
-- ใช้ตอนลูกค้าลืมเลือกเลนส์ แล้วแอดมินกดยืนยันการจองไปแล้ว จึงกดแก้ในหน้าแอดมินไม่ได้
--
-- สคริปต์นี้ตรวจให้ครบเหมือนตอนลูกค้าจองเอง:
--   • ล็อกแถวโควต้าเลนส์ของรอบนั้นไว้ก่อน (กันแอดมิน/ลูกค้าคนอื่นแย่งพร้อมกัน)
--   • นับเลนส์ที่ถูกจองไปแล้วในรอบนั้น (confirmed + pending ที่ยังไม่หมดเวลา)
--   • ถ้าโควต้าไม่พอ → ยกเลิกทั้งหมด ไม่แก้อะไรเลย
--
-- เรื่องเงิน: total_amount จะเพิ่มขึ้นตามค่าเลนส์ แต่ deposit_amount (มัดจำที่โอนมาแล้ว)
-- ไม่เปลี่ยน → ลูกค้าจ่ายส่วนต่างเพิ่มที่หน้างาน ไม่ต้องโอนเพิ่มและไม่ต้องคืนเงิน
-- ═══════════════════════════════════════════════════════════════

-- ⚠️ แก้ 3 ค่าใน declare ข้างล่างก่อนรัน
do $$
declare
  p_ref       text    := 'BK260907ABCDEFGH';  -- ← เลขที่การจอง (ref_number) ที่เห็นในหน้าแอดมิน
  p_lens_name text    := '70-200mm';          -- ← ชื่อเลนส์ ต้องตรงกับ lenses.name ในระบบ
  p_lens_qty  integer := 1;                   -- ← จำนวนเลนส์ที่จะเพิ่ม

  v_booking_id   uuid;
  v_session_id   uuid;
  v_status       text;
  v_old_lens_id  uuid;
  v_old_lens_qty integer;
  v_total        integer;
  v_deposit      integer;

  v_lens_id      uuid;
  v_lens_price   numeric;
  v_quota        integer;
  v_booked       integer;
  v_add_amount   integer;
begin
  if p_lens_qty is null or p_lens_qty < 1 then
    raise exception 'p_lens_qty ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป (ได้รับ %)', p_lens_qty;
  end if;

  -- ── 1) หาการจอง + ล็อกแถวไว้ ──
  select b.id, b.session_id, b.status, b.lens_id, coalesce(b.lens_qty, 0),
         coalesce(b.total_amount, 0), b.deposit_amount
    into v_booking_id, v_session_id, v_status, v_old_lens_id, v_old_lens_qty,
         v_total, v_deposit
  from public.bookings b
  where b.ref_number = p_ref
  for update;

  if v_booking_id is null then
    raise exception 'ไม่พบการจองเลขที่ % (ตรวจตัวพิมพ์ใหญ่-เล็กด้วย)', p_ref;
  end if;

  if v_status <> 'confirmed' then
    raise exception 'การจอง % อยู่ในสถานะ % ไม่ใช่ confirmed — ถ้ายังรอตรวจสอบให้ปฏิเสธแล้วให้ลูกค้าจองใหม่ได้เลย', p_ref, v_status;
  end if;

  if v_old_lens_id is not null and v_old_lens_qty > 0 then
    raise exception 'การจอง % มีเลนส์อยู่แล้ว (lens_id=%, จำนวน %) — สคริปต์นี้ใช้เพิ่มเลนส์ให้รายการที่ยังไม่มีเลนส์เท่านั้น กันคิดเงินซ้ำ', p_ref, v_old_lens_id, v_old_lens_qty;
  end if;

  -- ── 2) หาเลนส์ + ราคา ──
  select l.id, l.price into v_lens_id, v_lens_price
  from public.lenses l
  where l.name = p_lens_name;

  if v_lens_id is null then
    raise exception 'ไม่พบเลนส์ชื่อ "%" — รายชื่อที่มี: %',
      p_lens_name,
      (select string_agg(name, ', ' order by name) from public.lenses);
  end if;

  -- ── 3) ล็อกโควต้าเลนส์ของรอบนี้ แล้วเช็คว่าพอไหม ──
  select sli.qty into v_quota
  from public.session_lens_inventory sli
  where sli.session_id = v_session_id and sli.lens_id = v_lens_id
  for update;

  if v_quota is null then
    raise exception 'รอบนี้ยังไม่ได้ตั้งโควต้าเลนส์ "%" ไว้เลย — ไปตั้งโควต้าในหน้าแอดมินก่อน แล้วรันสคริปต์นี้อีกครั้ง', p_lens_name;
  end if;

  select coalesce(sum(b.lens_qty), 0) into v_booked
  from public.bookings b
  where b.lens_id = v_lens_id
    and b.session_id = v_session_id
    and (
      b.status = 'confirmed'
      or (b.status = 'pending' and (b.pending_expires_at is null or b.pending_expires_at > now()))
    );

  if v_booked + p_lens_qty > v_quota then
    raise exception 'โควต้าเลนส์ "%" ของรอบนี้ไม่พอ: ตั้งไว้ % ชิ้น ถูกจองไปแล้ว % ชิ้น เพิ่มอีก % ชิ้นไม่ได้ (ต้องเพิ่มโควต้าก่อน)',
      p_lens_name, v_quota, v_booked, p_lens_qty;
  end if;

  -- ── 4) เขียนค่าใหม่ ──
  v_add_amount := round(v_lens_price * p_lens_qty)::integer;

  update public.bookings
  set lens_id      = v_lens_id,
      lens_qty     = p_lens_qty,
      add_lens     = true,
      lens_price   = v_add_amount,
      total_amount = v_total + v_add_amount
  where id = v_booking_id;

  raise notice '─────────────────────────────────────────';
  raise notice 'เพิ่มเลนส์สำเร็จ — การจอง %', p_ref;
  raise notice 'เลนส์: % × % ชิ้น = % บาท', p_lens_name, p_lens_qty, v_add_amount;
  raise notice 'โควต้าเลนส์รอบนี้: % / % (รวมรายการนี้แล้ว)', v_booked + p_lens_qty, v_quota;
  raise notice 'ยอดรวม: % → % บาท', v_total, v_total + v_add_amount;
  raise notice 'มัดจำที่โอนมาแล้ว: % บาท (ไม่เปลี่ยน)', coalesce(v_deposit, 0);
  raise notice 'ลูกค้าจ่ายเพิ่มหน้างาน: % บาท (เดิม %)',
    (v_total + v_add_amount) - coalesce(v_deposit, 0), v_total - coalesce(v_deposit, 0);
  raise notice '─────────────────────────────────────────';
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ตรวจผลหลังรัน (แก้ 'BK260907ABCDEFGH' เป็นเลขที่เดียวกับข้างบน)
-- ═══════════════════════════════════════════════════════════════
select
  b.ref_number,
  b.status,
  b.renter_name,
  p.model_name              as phone,
  b.qty,
  l.name                    as lens,
  b.lens_qty,
  b.lens_price,
  b.total_amount,
  b.deposit_amount,
  b.total_amount - coalesce(b.deposit_amount, 0) as pay_on_pickup
from public.bookings b
left join public.phones p on p.id = b.phone_id
left join public.lenses l on l.id = b.lens_id
where b.ref_number = 'BK260907ABCDEFGH';
