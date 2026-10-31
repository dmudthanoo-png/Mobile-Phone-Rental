-- Run after 20261031121133_booking_discount_codes.sql.
-- No booking/price/refund data is rewritten. All app writes already use its
-- authenticated server APIs and service_role; browser database writes are denied.
begin;

revoke insert, update, delete, truncate, references, trigger on public.bookings from public, anon, authenticated;
grant select, insert, update, delete on public.bookings to service_role;
alter table public.bookings enable row level security;
-- Restrictive policies also protect against any old column-level grants.
drop policy if exists bookings_api_insert_only on public.bookings;
create policy bookings_api_insert_only on public.bookings as restrictive
  for insert to anon, authenticated with check (false);
drop policy if exists bookings_api_update_only on public.bookings;
create policy bookings_api_update_only on public.bookings as restrictive
  for update to anon, authenticated using (false) with check (false);
drop policy if exists bookings_api_delete_only on public.bookings;
create policy bookings_api_delete_only on public.bookings as restrictive
  for delete to anon, authenticated using (false);

-- The application uploads/downloads slips through service_role after checking
-- the customer's cookie and ownership. An old permissive upload policy must
-- not let an authenticated Supabase user bypass those checks.
-- Supabase owns this table and already enables RLS. Its postgres role can
-- manage policies through supautils.policy_grants, but cannot ALTER the table.
-- Check the prerequisite without changing ownership or silently skipping it.
do $$
begin
  if not exists (
    select 1 from pg_class
    where oid = 'storage.objects'::regclass and relrowsecurity
  ) then
    raise exception 'Storage RLS is not enabled on storage.objects'
      using hint = 'Check the managed Storage configuration with Supabase support before retrying; do not change table ownership.';
  end if;
end $$;
drop policy if exists slips_api_only on storage.objects;
create policy slips_api_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'slips') with check (bucket_id <> 'slips');

-- A hold can expire while its first slip is being committed. Serialize that
-- transition with stock reservations (phone then lens), then check REAL time
-- and capacity after waiting. Cover both new coupon and legacy finalize RPCs.
create or replace function public.lock_booking_hold_finalization()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_phone_quota integer; v_lens_quota integer; v_booked bigint;
begin
  if row(new.session_id,new.phone_id,new.qty,new.lens_id,new.lens_qty)
    is distinct from row(old.session_id,old.phone_id,old.qty,old.lens_id,old.lens_qty) then
    raise exception 'HOLD_MISMATCH';
  end if;
  select qty into v_phone_quota from public.session_phone_inventory
    where session_id=old.session_id and phone_id=old.phone_id for update;
  if not found then raise exception 'SOLD_OUT_PHONE'; end if;
  if old.lens_id is not null and coalesce(old.lens_qty,0)>0 then
    select qty into v_lens_quota from public.session_lens_inventory
      where session_id=old.session_id and lens_id=old.lens_id for update;
    if not found then raise exception 'SOLD_OUT_LENS'; end if;
  end if;
  if old.discount_code_id is not null and old.pending_expires_at <= clock_timestamp() then
    raise exception 'DISCOUNT_HOLD_EXPIRED';
  end if;
  select coalesce(sum(qty),0) into v_booked from public.bookings
    where session_id=old.session_id and phone_id=old.phone_id and id<>old.id
      and (status='confirmed' or (status='pending' and
        (pending_expires_at is null or pending_expires_at>clock_timestamp())));
  if v_booked+old.qty>v_phone_quota then raise exception 'SOLD_OUT_PHONE'; end if;
  if old.lens_id is not null and coalesce(old.lens_qty,0)>0 then
    select coalesce(sum(lens_qty),0) into v_booked from public.bookings
      where session_id=old.session_id and lens_id=old.lens_id and id<>old.id
        and (status='confirmed' or (status='pending' and
          (pending_expires_at is null or pending_expires_at>clock_timestamp())));
    if v_booked+old.lens_qty>v_lens_quota then raise exception 'SOLD_OUT_LENS'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.lock_booking_hold_finalization() from public, anon, authenticated;
drop trigger if exists a_lock_booking_hold_finalization on public.bookings;
create trigger a_lock_booking_hold_finalization before update of slip_url on public.bookings
  for each row when (old.status='pending' and old.pending_expires_at is not null
    and old.slip_url is null and new.slip_url is not null)
  execute function public.lock_booking_hold_finalization();

notify pgrst, 'reload schema';
commit;
