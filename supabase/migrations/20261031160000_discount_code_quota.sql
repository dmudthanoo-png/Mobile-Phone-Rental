-- Run after 20261031124225_harden_discount_checkout.sql, BEFORE deploying the quota UI/API.
-- Adds an optional total quota per code. NULL = unlimited (every existing code stays unlimited).
-- No booking, price or usage row is rewritten. Rerunnable.
begin;

alter table public.discount_codes add column if not exists max_uses integer;
do $$
begin
  if not exists (select 1 from pg_constraint
    where conname='discount_codes_max_uses_check' and conrelid='public.discount_codes'::regclass) then
    alter table public.discount_codes add constraint discount_codes_max_uses_check
      check (max_uses is null or max_uses between 1 and 1000000);
  end if;
end $$;

-- A slot is taken by a consumed use (permanent, like the per-account rule: cancellation or
-- deleting the booking does not return it) or by another account's unexpired hold.
-- Counting holds prevents many customers who hold at once from all paying for the last slot.
create or replace function public.discount_code_taken(p_code_id uuid, p_except_user uuid default null)
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::integer from public.discount_uses
  where code_id=p_code_id and user_id is distinct from p_except_user
    and (consumed_at is not null or (booking_id is not null and reserved_until > clock_timestamp()));
$$;

create or replace function public.booking_discount_quote(
  p_user_id uuid, p_code text, p_session_id uuid, p_phone_id uuid,
  p_qty integer, p_lens_id uuid, p_lens_qty integer
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  c public.discount_codes%rowtype;
  v_price numeric; v_deposit numeric; v_lens numeric := 0;
  v_total integer; v_due integer;
begin
  if p_user_id is null or p_qty is null or p_qty not between 1 and 10
    or p_lens_qty is null or p_lens_qty not between 0 and p_qty then
    return jsonb_build_object('error','INVALID_QUANTITY');
  end if;
  if not exists (select 1 from public.concert_sessions s join public.concerts e on e.id=s.concert_id
    where s.id=p_session_id and s.start_at > clock_timestamp() and not coalesce(e.archived,false)
      and e.is_visible is distinct from false and (e.publish_at is null or e.publish_at <= clock_timestamp())) then
    return jsonb_build_object('error','SESSION_UNAVAILABLE');
  end if;
  select * into c from public.discount_codes where code=upper(btrim(p_code)) for share;
  if not found or c.deleted_at is not null or not c.active then return jsonb_build_object('error','DISCOUNT_UNAVAILABLE'); end if;
  if clock_timestamp() < c.starts_at then return jsonb_build_object('error','DISCOUNT_NOT_STARTED'); end if;
  if clock_timestamp() >= c.expires_at then return jsonb_build_object('error','DISCOUNT_EXPIRED'); end if;
  if exists(select 1 from public.discount_uses where code_id=c.id and user_id=p_user_id and consumed_at is not null) then
    return jsonb_build_object('error','DISCOUNT_ALREADY_USED');
  end if;
  -- The caller's own reservation is excluded: re-holding must not count against itself.
  if c.max_uses is not null and public.discount_code_taken(c.id,p_user_id) >= c.max_uses then
    return jsonb_build_object('error','DISCOUNT_QUOTA_FULL');
  end if;
  select coalesce(i.price_override,p.price),p.deposit into v_price,v_deposit
    from public.phones p join public.session_phone_inventory i on i.phone_id=p.id and i.session_id=p_session_id
    where p.id=p_phone_id and p.active=true;
  if not found or v_price is null or v_deposit is null or v_price < 0 or v_deposit < 0 then
    return jsonb_build_object('error','PHONE_UNAVAILABLE');
  end if;
  if p_lens_qty > 0 then
    select l.price into v_lens from public.phone_lenses pl join public.lenses l on l.id=pl.lens_id
      where pl.phone_id=p_phone_id and pl.lens_id=p_lens_id and l.active=true;
    if not found or v_lens is null or v_lens < 0 then return jsonb_build_object('error','LENS_UNAVAILABLE'); end if;
  elsif p_lens_id is not null then
    return jsonb_build_object('error','INVALID_QUANTITY');
  end if;
  v_total := round(v_price*p_qty + v_lens*p_lens_qty)::integer;
  v_due := least(round(v_deposit*p_qty)::integer,v_total);
  if v_total-c.amount < v_due then return jsonb_build_object('error','DISCOUNT_BELOW_DEPOSIT'); end if;
  return jsonb_build_object('ok',true,'code_id',c.id,'code',c.code,'discount_amount',c.amount,
    'subtotal_amount',v_total,'total_amount',v_total-c.amount,'deposit_amount',v_due,
    'lens_price',round(v_lens*p_lens_qty)::integer,'expires_at',c.expires_at);
end $$;

create or replace function public.create_discount_booking_hold(
  p_user_id uuid, p_code text, p_session_id uuid, p_phone_id uuid, p_qty integer,
  p_lens_id uuid, p_lens_qty integer, p_renter_name text, p_renter_phone text,
  p_expected_discount integer
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare q jsonb; h jsonb; b public.bookings%rowtype;
begin
  if p_user_id is null then return jsonb_build_object('error','UNAUTHORIZED'); end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  -- Retrying the same hold neither extends its deadline nor reads today's price.
  select * into b from public.bookings where user_id=p_user_id and status='pending' and slip_url is null
    and pending_expires_at > clock_timestamp() and discount_code=upper(btrim(p_code))
    and session_id=p_session_id and phone_id=p_phone_id and qty=p_qty
    and lens_id is not distinct from p_lens_id and lens_qty=p_lens_qty for update;
  if found then
    if b.discount_amount is distinct from p_expected_discount then return jsonb_build_object('error','DISCOUNT_CHANGED'); end if;
    return jsonb_build_object('ok',true,'booking_id',b.id,'ref_number',b.ref_number,'expires_at',b.pending_expires_at,
      'code',b.discount_code,'discount_amount',b.discount_amount,'subtotal_amount',b.total_amount+b.discount_amount,
      'total_amount',b.total_amount,'deposit_amount',b.deposit_amount);
  end if;
  -- Serialize new holds of a limited code so two accounts cannot both take the last quota slot.
  -- Unlimited codes skip the row lock and keep their current concurrency.
  perform 1 from public.discount_codes where code=upper(btrim(p_code)) and max_uses is not null for update;
  q := public.booking_discount_quote(p_user_id,p_code,p_session_id,p_phone_id,p_qty,p_lens_id,p_lens_qty);
  if q ? 'error' then return q; end if;
  if (q->>'discount_amount')::integer is distinct from p_expected_discount then return jsonb_build_object('error','DISCOUNT_CHANGED'); end if;
  h := public.create_booking_hold(p_user_id,p_session_id,p_phone_id,p_qty,p_lens_id,p_lens_qty,
    p_renter_name,p_renter_phone,(q->>'total_amount')::numeric,(q->>'deposit_amount')::numeric,420);
  if h ? 'error' then return h; end if;
  insert into public.discount_uses(code_id,user_id,booking_id,ref_number,amount,reserved_until)
    values ((q->>'code_id')::uuid,p_user_id,(h->>'booking_id')::uuid,h->>'ref_number',
      (q->>'discount_amount')::integer,(h->>'expires_at')::timestamptz)
    on conflict (code_id,user_id) do update set booking_id=excluded.booking_id,ref_number=excluded.ref_number,
      amount=excluded.amount,reserved_until=excluded.reserved_until
      where discount_uses.consumed_at is null and (discount_uses.booking_id is null or discount_uses.reserved_until <= clock_timestamp());
  if not found then raise exception 'DISCOUNT_ALREADY_USED'; end if;
  update public.bookings set discount_code_id=(q->>'code_id')::uuid,discount_code=q->>'code',
    discount_amount=(q->>'discount_amount')::integer,lens_price=(q->>'lens_price')::integer,add_lens=(p_lens_qty > 0)
    where id=(h->>'booking_id')::uuid;
  return q || h; -- h's expires_at is the HOLD deadline, not the campaign deadline.
end $$;

-- New overload with p_max_uses (no default, so calls without it still resolve to the old
-- 9-argument function during rollout). The old function never touches max_uses.
-- Lowering the quota below the current count only stops NEW uses; accepted holds keep their slot.
create or replace function public.admin_save_discount_code(
  p_admin_id uuid,p_action text,p_id uuid,p_code text,p_name text,p_amount integer,
  p_starts_at timestamptz,p_expires_at timestamptz,p_active boolean,p_max_uses integer
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_admin text; c public.discount_codes%rowtype; v_before jsonb;
begin
  select username into v_admin from public.admin_users where id=p_admin_id;
  if not found then return jsonb_build_object('error','UNAUTHORIZED'); end if;
  if p_action not in ('create','update','set_active','delete') or p_action is null then return jsonb_build_object('error','INVALID_ACTION'); end if;
  if p_action<>'create' then
    select * into c from public.discount_codes where id=p_id for update;
    if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
    v_before := to_jsonb(c);
    if c.deleted_at is not null then
      if p_action='delete' then return jsonb_build_object('ok',true,'unchanged',true); end if;
      return jsonb_build_object('error','DISCOUNT_DELETED');
    end if;
  end if;
  if p_action='delete' then
    update public.discount_codes set active=false,deleted_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
  elsif p_action='set_active' then
    if p_active is null then return jsonb_build_object('error','INVALID_DISCOUNT'); end if;
    update public.discount_codes set active=p_active,updated_at=clock_timestamp() where id=p_id returning * into c;
  else
    if p_code is null or upper(btrim(p_code)) !~ '^[A-Z0-9_-]{3,32}$' or p_name is null
      or char_length(btrim(p_name)) not between 1 and 100 or p_amount is null or p_amount not between 1 and 1000000
      or p_starts_at is null or p_expires_at is null or p_expires_at<=p_starts_at or p_active is null
      or (p_max_uses is not null and p_max_uses not between 1 and 1000000) then
      return jsonb_build_object('error','INVALID_DISCOUNT');
    end if;
    -- Code identity is permanent: renaming/recreating must never reset per-user usage.
    if p_action='update' and c.code<>upper(btrim(p_code)) then return jsonb_build_object('error','DISCOUNT_CODE_READ_ONLY'); end if;
    if p_action='create' then
      insert into public.discount_codes(code,name,amount,starts_at,expires_at,active,max_uses)
        values(upper(btrim(p_code)),btrim(p_name),p_amount,p_starts_at,p_expires_at,p_active,p_max_uses) returning * into c;
    else
      update public.discount_codes set name=btrim(p_name),amount=p_amount,starts_at=p_starts_at,
        expires_at=p_expires_at,active=p_active,max_uses=p_max_uses,updated_at=clock_timestamp() where id=p_id returning * into c;
    end if;
  end if;
  insert into public.admin_audit_log(admin_username,action,detail)
    values(v_admin,'discount_'||p_action,jsonb_build_object('code',c.code,'id',c.id,'amount',c.amount,
      'starts_at',c.starts_at,'expires_at',c.expires_at,'max_uses',c.max_uses,
      'active',case when p_action='delete' then false else c.active end,'before',v_before)::text);
  return jsonb_build_object('ok',true,'id',c.id);
exception when unique_violation then return jsonb_build_object('error','DISCOUNT_CODE_EXISTS');
end $$;

create or replace function public.admin_discount_code_list(p_offset integer default 0,p_deleted boolean default false)
returns jsonb language sql security invoker set search_path = public as $$
  select jsonb_build_object('total',(select count(*) from discount_codes where (deleted_at is not null)=p_deleted),
    'codes',coalesce((select jsonb_agg(to_jsonb(c)) from (
      select d.*, (select count(*) from discount_uses u where u.code_id=d.id and u.consumed_at is not null) as used_count,
        (select count(*) from discount_uses u where u.code_id=d.id and u.consumed_at is null
          and u.booking_id is not null and u.reserved_until > clock_timestamp()) as reserved_count,
        (select coalesce(sum(u.amount),0) from discount_uses u where u.code_id=d.id and u.consumed_at is not null) as discount_total,
        (select coalesce(sum(b.discount_amount),0) from bookings b where b.discount_code_id=d.id and b.status='confirmed') as confirmed_discount_total
      from discount_codes d where (d.deleted_at is not null)=p_deleted order by d.created_at desc,d.id limit 50 offset greatest(0,p_offset)
    ) c),'[]'::jsonb));
$$;

revoke execute on function public.discount_code_taken(uuid,uuid),
  public.booking_discount_quote(uuid,text,uuid,uuid,integer,uuid,integer),
  public.create_discount_booking_hold(uuid,text,uuid,uuid,integer,uuid,integer,text,text,integer),
  public.admin_save_discount_code(uuid,text,uuid,text,text,integer,timestamptz,timestamptz,boolean,integer),
  public.admin_discount_code_list(integer,boolean) from public,anon,authenticated;
grant execute on function public.discount_code_taken(uuid,uuid),
  public.booking_discount_quote(uuid,text,uuid,uuid,integer,uuid,integer),
  public.create_discount_booking_hold(uuid,text,uuid,uuid,integer,uuid,integer,text,text,integer),
  public.admin_save_discount_code(uuid,text,uuid,text,text,integer,timestamptz,timestamptz,boolean,integer),
  public.admin_discount_code_list(integer,boolean) to service_role;

notify pgrst,'reload schema';
commit;
