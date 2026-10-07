-- Run once in Supabase SQL Editor BEFORE deploying the cancellation feature.
-- Additive migration: does not cancel/refund any existing booking or change stock.
-- Scope: one confirmed, not-yet-delivered booking; refund exactly THB 100; no LINE.
begin;

create table if not exists public.booking_cancellations (
  booking_id uuid primary key references public.bookings(id),
  refund_amount integer not null default 100 check (refund_amount = 100),
  refund_status text not null default 'pending' check (refund_status in ('pending', 'processing', 'refunded')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  cancelled_at timestamptz not null default now(),
  cancelled_by uuid not null,
  cancelled_by_username text not null,
  processing_by uuid,
  processing_by_username text,
  processing_at timestamptz,
  refunded_at timestamptz,
  refunded_by uuid,
  refunded_by_username text,
  refund_reference text unique,
  refund_proof_path text unique,
  constraint booking_cancellation_refund_state check (
    (refund_status = 'pending' and processing_by is null and processing_at is null
      and refunded_at is null and refunded_by is null and refund_reference is null and refund_proof_path is null)
    or (refund_status = 'processing' and processing_by is not null and processing_at is not null
      and refunded_at is null and refunded_by is null and refund_reference is null and refund_proof_path is null)
    or (refund_status = 'refunded' and processing_by is not null and processing_at is not null
      and refunded_at is not null and refunded_by is not null and refund_reference is not null and refund_proof_path is not null)
  )
);
create index if not exists booking_cancellations_status_idx on public.booking_cancellations(refund_status);
alter table public.booking_cancellations enable row level security;
revoke all on public.booking_cancellations from PUBLIC, anon, authenticated;
grant select, insert, update on public.booking_cancellations to service_role;

-- Separate PRIVATE bucket: never expose bank refund evidence as a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('refund-proofs', 'refund-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Also deny browser roles if the project has a broad permissive storage policy.
-- Other buckets retain their existing policies; service_role bypasses RLS.
drop policy if exists refund_proofs_service_only on storage.objects;
create policy refund_proofs_service_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'refund-proofs') with check (bucket_id <> 'refund-proofs');

create or replace function public.admin_cancel_booking(p_booking_id uuid, p_admin_id uuid, p_reason text)
returns jsonb language plpgsql set search_path = public as $function$
declare
  b public.bookings%rowtype;
  c public.booking_cancellations%rowtype;
  v_username text;
begin
  select username into v_username from public.admin_users where id = p_admin_id;
  if not found then return jsonb_build_object('error', 'UNAUTHORIZED'); end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    return jsonb_build_object('error', 'INVALID_REASON');
  end if;

  -- Same first lock as lens editing and fulfillment updates. Recheck after lock.
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into c from public.booking_cancellations where booking_id = p_booking_id;
  if b.status = 'cancelled' and found then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  if coalesce(b.status, '') <> 'confirmed' then
    return jsonb_build_object('error', 'NOT_CONFIRMED');
  end if;
  if b.delivered_at is not null or b.returned_at is not null or b.files_sent_at is not null then
    return jsonb_build_object('error', 'ALREADY_FULFILLED');
  end if;
  -- Never infer money from the current phone price. A confirmed booking is the
  -- admin's acceptance of the payment; a verified slip can cover old NULL deposits.
  if b.deposit_amount is not null then
    if b.deposit_amount <> 100 then return jsonb_build_object('error', 'DEPOSIT_NOT_100'); end if;
  elsif b.slip_verified is not true or b.slip_verify_amount is distinct from 100::numeric then
    return jsonb_build_object('error', 'DEPOSIT_UNKNOWN');
  end if;
  if b.slip_verified is true and b.slip_verify_amount is not null and b.slip_verify_amount <> 100 then
    return jsonb_build_object('error', 'DEPOSIT_MISMATCH');
  end if;

  insert into public.booking_cancellations(booking_id, reason, cancelled_by, cancelled_by_username)
  values (p_booking_id, btrim(p_reason), p_admin_id, v_username);
  -- Stock is counted from active bookings. Do NOT change catalog quantities,
  -- session quotas, historical amounts, deposit, lens details or the original slip.
  update public.bookings set status = 'cancelled' where id = p_booking_id;
  insert into public.admin_audit_log(admin_username, action, detail)
  values (v_username, 'ยกเลิกการจอง — รอคืนมัดจำ 100 บาท',
    format('booking %s · REF %s · %s', p_booking_id, b.ref_number, btrim(p_reason)));
  return jsonb_build_object('ok', true, 'unchanged', false);
end;
$function$;
revoke all on function public.admin_cancel_booking(uuid, uuid, text) from PUBLIC, anon, authenticated;
grant execute on function public.admin_cancel_booking(uuid, uuid, text) to service_role;

create or replace function public.admin_manage_booking_refund(
  p_booking_id uuid, p_admin_id uuid, p_action text,
  p_reference text default null, p_proof_path text default null
)
returns jsonb language plpgsql set search_path = public as $function$
declare
  b public.bookings%rowtype;
  c public.booking_cancellations%rowtype;
  v_username text;
  v_reference text;
  v_action_label text;
begin
  select username into v_username from public.admin_users where id = p_admin_id;
  if not found then return jsonb_build_object('error', 'UNAUTHORIZED'); end if;
  if p_action is null or p_action not in ('claim', 'release', 'complete') then
    return jsonb_build_object('error', 'INVALID_ACTION');
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if b.status is distinct from 'cancelled' then return jsonb_build_object('error', 'NOT_CANCELLED'); end if;
  select * into c from public.booking_cancellations where booking_id = p_booking_id for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.refund_status = 'refunded' then
    -- Retries must never overwrite the first successful refund/evidence.
    if p_action = 'complete' then return jsonb_build_object('ok', true, 'unchanged', true); end if;
    return jsonb_build_object('error', 'ALREADY_REFUNDED');
  end if;

  if p_action = 'claim' then
    if c.refund_status = 'processing' then
      if c.processing_by = p_admin_id then return jsonb_build_object('ok', true, 'unchanged', true); end if;
      return jsonb_build_object('error', 'CLAIMED_BY_OTHER');
    end if;
    update public.booking_cancellations set refund_status = 'processing',
      processing_by = p_admin_id, processing_by_username = v_username, processing_at = now()
    where booking_id = p_booking_id;
    v_action_label := 'รับงานคืนมัดจำ 100 บาท';
  else
    if c.refund_status <> 'processing' or c.processing_by is distinct from p_admin_id then
      return jsonb_build_object('error', 'CLAIM_REQUIRED');
    end if;
    if p_action = 'release' then
      update public.booking_cancellations set refund_status = 'pending',
        processing_by = null, processing_by_username = null, processing_at = null
      where booking_id = p_booking_id;
      v_action_label := 'คืนงานคืนมัดจำ — ยืนยันยังไม่ได้โอนเงิน';
    else
      v_reference := upper(btrim(p_reference));
      if v_reference is null or char_length(v_reference) not between 3 and 120 then
        return jsonb_build_object('error', 'INVALID_REFERENCE');
      end if;
      if p_proof_path is null or p_proof_path !~ ('^' || p_booking_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
        return jsonb_build_object('error', 'INVALID_PROOF');
      end if;
      perform 1 from storage.objects where bucket_id = 'refund-proofs' and name = p_proof_path;
      if not found then return jsonb_build_object('error', 'INVALID_PROOF'); end if;
      if exists(select 1 from public.booking_cancellations where refund_reference = v_reference and booking_id <> p_booking_id) then
        return jsonb_build_object('error', 'REFERENCE_USED');
      end if;
      update public.booking_cancellations set refund_status = 'refunded', refunded_at = now(),
        refunded_by = p_admin_id, refunded_by_username = v_username,
        refund_reference = v_reference, refund_proof_path = p_proof_path
      where booking_id = p_booking_id;
      v_action_label := 'บันทึกคืนมัดจำแล้ว 100 บาท';
    end if;
  end if;
  insert into public.admin_audit_log(admin_username, action, detail)
  values (v_username, v_action_label, format('booking %s · REF %s%s', p_booking_id, b.ref_number,
    case when p_action = 'complete' then ' · transaction ' || v_reference else '' end));
  return jsonb_build_object('ok', true, 'unchanged', false);
exception when unique_violation then
  -- Includes concurrent completion of different bookings with the same bank ref.
  return jsonb_build_object('error', 'REFERENCE_USED');
end;
$function$;
revoke all on function public.admin_manage_booking_refund(uuid, uuid, text, text, text) from PUBLIC, anon, authenticated;
grant execute on function public.admin_manage_booking_refund(uuid, uuid, text, text, text) to service_role;

-- One statement/snapshot for all money totals. Separate HTTP count requests can
-- double-count a refund moving from pending to refunded while the dashboard loads.
create or replace function public.admin_cancellation_money_summary()
returns jsonb language sql stable set search_path = public as $function$
  select jsonb_build_object(
    'revenue', active.revenue,
    'deposit_received', active.deposit + refunds.pending_amount + refunds.paid_amount,
    'refund_pending', refunds.pending_amount,
    'refunded_amount', refunds.paid_amount
  )
  from (
    select coalesce(sum(total_amount), 0) as revenue, coalesce(sum(deposit_amount), 0) as deposit
    from public.bookings where status = 'confirmed'
  ) active
  cross join (
    select coalesce(sum(refund_amount) filter (where refund_status in ('pending', 'processing')), 0) as pending_amount,
      coalesce(sum(refund_amount) filter (where refund_status = 'refunded'), 0) as paid_amount
    from public.booking_cancellations
  ) refunds;
$function$;
revoke all on function public.admin_cancellation_money_summary() from PUBLIC, anon, authenticated;
grant execute on function public.admin_cancellation_money_summary() to service_role;

-- Preserve the original payment/equipment history, including late SlipOK results.
create or replace function public.protect_cancelled_booking()
returns trigger language plpgsql set search_path = public as $function$
begin
  if old.status = 'cancelled' and
    row(new.status, new.user_id, new.session_id, new.phone_id, new.qty, new.lens_id, new.lens_qty,
      new.add_lens, new.lens_price, new.total_amount, new.deposit_amount, new.slip_url,
      new.slip_verified, new.slip_verify_ref, new.slip_verify_amount)
    is distinct from
    row(old.status, old.user_id, old.session_id, old.phone_id, old.qty, old.lens_id, old.lens_qty,
      old.add_lens, old.lens_price, old.total_amount, old.deposit_amount, old.slip_url,
      old.slip_verified, old.slip_verify_ref, old.slip_verify_amount) then
    raise exception 'CANCELLED_BOOKING_READ_ONLY';
  end if;
  return new;
end;
$function$;
revoke all on function public.protect_cancelled_booking() from PUBLIC, anon, authenticated;
drop trigger if exists protect_cancelled_booking on public.bookings;
create trigger protect_cancelled_booking before update on public.bookings
for each row execute function public.protect_cancelled_booking();

commit;
