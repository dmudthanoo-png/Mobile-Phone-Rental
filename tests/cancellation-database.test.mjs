import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL/PLpgSQL in memory. Never reads .env or connects to Supabase.
let db;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bookingId = id(1), adminA = id(101), adminB = id(102), phone = id(201), lens = id(301), session = id(401), user = id(501);
const migration = readFileSync(new URL('../scripts/add_booking_cancellation.sql', import.meta.url), 'utf8');
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const cancel = async (booking = bookingId, admin = adminA, reason = 'Customer request approved by shop') =>
  (await one('select public.admin_cancel_booking($1,$2,$3) as result', [booking, admin, reason])).result;
const refund = async (action, { booking = bookingId, admin = adminA, reference = null, path = null } = {}) =>
  (await one('select public.admin_manage_booking_refund($1,$2,$3,$4,$5) as result', [booking, admin, action, reference, path])).result;
const booking = () => one('select * from bookings where id=$1', [bookingId]);
const cancellation = () => one('select * from booking_cancellations where booking_id=$1', [bookingId]);
async function proof(booking = bookingId, suffix = 701) {
  const path = `${booking}/${id(suffix)}.png`;
  await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['refund-proofs', path]);
  return path;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text, name text, primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    create policy existing_broad_policy on storage.objects for all to anon, authenticated using (true) with check (true);
    create table admin_users(id uuid primary key, username text not null);
    create table admin_audit_log(id uuid default gen_random_uuid(), admin_username text, action text, detail text);
    create table phones(id uuid primary key, qty integer, deposit numeric, price numeric, model_name text);
    create table lenses(id uuid primary key, qty integer, price numeric, name text, active boolean);
    create table concert_sessions(id uuid primary key, start_at timestamptz);
    create table phone_lenses(phone_id uuid, lens_id uuid);
    create table session_phone_inventory(session_id uuid, phone_id uuid, qty integer, primary key(session_id,phone_id));
    create table session_lens_inventory(session_id uuid, lens_id uuid, qty integer, primary key(session_id,lens_id));
    create table bookings(
      id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), user_id uuid,
      ref_number text unique, renter_name text, renter_phone text, status text, session_id uuid, phone_id uuid,
      qty integer default 1, lens_id uuid, lens_qty integer default 0, add_lens boolean default false,
      lens_price integer default 0, total_amount integer, deposit_amount integer, slip_url text,
      slip_verified boolean, slip_verify_amount numeric, slip_verify_ref text, slip_verify_message text,
      slip_verified_at timestamptz, slip_uploaded_at timestamptz, pending_expires_at timestamptz,
      slip_update_count integer default 0, last_slip_update_at timestamptz,
      delivered_at timestamptz, returned_at timestamptz, files_sent_at timestamptz
    );
    grant usage on schema public, storage to service_role;
    grant select, insert, update, delete on all tables in schema public to service_role;
    grant select on storage.objects to service_role;
  `);
  await db.exec(migration);
  await db.exec(readFileSync(new URL('../scripts/add_admin_set_booking_lens_rpc.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../scripts/add_booking_hold.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../scripts/add_update_slip_rpc.sql', import.meta.url), 'utf8'));
});

beforeEach(async () => {
  await db.exec('truncate booking_cancellations, bookings, admin_audit_log, admin_users, phones, lenses, concert_sessions, phone_lenses, session_phone_inventory, session_lens_inventory, storage.objects');
  await db.query('insert into admin_users values ($1,$2),($3,$4)', [adminA, 'admin-a', adminB, 'admin-b']);
  await db.query('insert into phones values ($1,1,100,800,$2)', [phone, 'Test phone']);
  await db.query('insert into lenses values ($1,1,200,$2,true)', [lens, 'Test lens']);
  await db.query("insert into concert_sessions values ($1,now()+interval '7 days')", [session]);
  await db.query('insert into phone_lenses values ($1,$2)', [phone,lens]);
  await db.query('insert into session_phone_inventory values ($1,$2,1)', [session,phone]);
  await db.query('insert into session_lens_inventory values ($1,$2,1)', [session,lens]);
  await db.query(`insert into bookings(id,user_id,ref_number,renter_name,renter_phone,status,session_id,phone_id,qty,lens_id,lens_qty,add_lens,lens_price,total_amount,deposit_amount,slip_url,slip_verified,slip_verify_amount,slip_verify_ref)
    values ($1,$2,'TEST-REF','Test Customer','0000000000','confirmed',$3,$4,1,$5,1,true,200,1000,100,'original-private-slip',true,100,'original-payment-ref')`, [bookingId,user,session,phone,lens]);
});
after(async () => { await db?.close(); });

test('migration can be applied twice without changing existing bookings', async () => {
  const old = await booking(); await db.exec(migration); assert.deepEqual(await booking(), old);
  assert.equal((await one("select public from storage.buckets where id='refund-proofs'")).public, false);
});
test('cancellation changes only status, keeps original money/slip/lens, and writes one atomic audit', async () => {
  const original = await booking(); assert.equal((await cancel()).ok, true);
  assert.deepEqual(await booking(), { ...original, status:'cancelled' });
  const c = await cancellation(); assert.equal(c.refund_amount,100); assert.equal(c.refund_status,'pending');
  assert.equal(Number((await one('select count(*) n from admin_audit_log')).n),1);
  assert.equal((await cancel()).unchanged,true);
  assert.equal(Number((await one('select count(*) n from admin_audit_log')).n),1);
});
test('catalog and session stock unchanged, while a new hold can reserve the released phone AND lens', async () => {
  await cancel();
  for(const table of ['phones','lenses','session_phone_inventory','session_lens_inventory']) assert.equal((await one(`select qty from ${table}`)).qty,1);
  const hold = (await one('select create_booking_hold($1,$2,$3,1,$4,1,$5,$6,1000,100,420) as result', [id(502),session,phone,lens,'New customer','0000000000'])).result;
  assert.equal(hold.ok,true);
  const full = (await one('select create_booking_hold($1,$2,$3,1,$4,1,$5,$6,1000,100,420) as result', [id(503),session,phone,lens,'Another','0000000000'])).result;
  assert.equal(full.error,'SOLD_OUT_PHONE');
});
test('only confirmed bookings may be cancelled', async () => {
  for(const status of ['pending','rejected','waiting_review',null]) {
    await db.query('update bookings set status=$1 where id=$2',[status,bookingId]);
    assert.equal((await cancel()).error,'NOT_CONFIRMED');
  }
});
test('fulfillment blocks cancellation for delivered, returned and files-sent bookings', async () => {
  for(const column of ['delivered_at','returned_at','files_sent_at']) {
    await db.exec(`update bookings set ${column}=now()`);
    assert.equal((await cancel()).error,'ALREADY_FULFILLED');
    await db.exec(`update bookings set ${column}=null`);
  }
});
test('unknown/incorrect deposits are never guessed from the current phone deposit', async () => {
  await db.exec('update bookings set deposit_amount=200'); assert.equal((await cancel()).error,'DEPOSIT_NOT_100');
  await db.exec('update bookings set deposit_amount=null, slip_verified=false'); assert.equal((await cancel()).error,'DEPOSIT_UNKNOWN');
  await db.exec('update bookings set deposit_amount=100, slip_verified=true, slip_verify_amount=200'); assert.equal((await cancel()).error,'DEPOSIT_MISMATCH');
  assert.equal(Number((await one('select count(*) n from booking_cancellations')).n),0);
});
test('old NULL deposit can use an actually verified THB 100 slip, without changing historical fields', async () => {
  await db.exec('update bookings set deposit_amount=null'); assert.equal((await cancel()).ok,true);
  assert.equal((await booking()).deposit_amount,null);
});
test('invalid actor, booking and reason rejected without writes', async () => {
  assert.equal((await cancel(bookingId,id(999))).error,'UNAUTHORIZED');
  assert.equal((await cancel(id(999))).error,'NOT_FOUND');
  for(const reason of ['', '  ', 'x'.repeat(501),null]) assert.equal((await cancel(bookingId,adminA,reason)).error,'INVALID_REASON');
  assert.equal(Number((await one('select count(*) n from booking_cancellations')).n),0);
});
test('audit failure rolls back the cancellation, not just the log', async () => {
  await db.exec("create function reject_test_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end $$; create trigger reject_test_audit before insert on admin_audit_log for each row execute function reject_test_audit()");
  try { await assert.rejects(cancel(),/test audit failure/); assert.equal((await booking()).status,'confirmed'); assert.equal(await cancellation(),undefined); }
  finally { await db.exec('drop trigger reject_test_audit on admin_audit_log; drop function reject_test_audit()'); }
});
test('refund work can only be owned by one admin and cannot be completed by another', async () => {
  await cancel(); assert.equal((await refund('claim')).ok,true); assert.equal((await refund('claim')).unchanged,true);
  assert.equal((await refund('claim',{admin:adminB})).error,'CLAIMED_BY_OTHER');
  assert.equal((await refund('release',{admin:adminB})).error,'CLAIM_REQUIRED');
  assert.equal((await refund('complete',{admin:adminB})).error,'CLAIM_REQUIRED');
  assert.equal((await refund('release')).ok,true); assert.equal((await cancellation()).refund_status,'pending');
  assert.equal((await refund('claim',{admin:adminB})).ok,true);
});
test('recording a refund requires claim, bank reference and private uploaded evidence', async () => {
  await cancel(); assert.equal((await refund('complete')).error,'CLAIM_REQUIRED'); await refund('claim');
  assert.equal((await refund('complete')).error,'INVALID_REFERENCE');
  assert.equal((await refund('complete',{reference:'BANK-TEST'})).error,'INVALID_PROOF');
  assert.equal((await refund('complete',{reference:'BANK-TEST',path:`${bookingId}/${id(701)}.png`})).error,'INVALID_PROOF');
  assert.equal((await cancellation()).refund_status,'processing');
});
test('completion is idempotent, preserves first evidence and never allows another claim', async () => {
  await cancel(); await refund('claim'); const path=await proof();
  assert.equal((await refund('complete',{reference:'bank-123',path})).ok,true);
  const c=await cancellation(); assert.equal(c.refund_status,'refunded'); assert.equal(c.refund_reference,'BANK-123');
  assert.equal((await refund('complete',{reference:'DIFFERENT',path:'different'})).unchanged,true);
  assert.deepEqual(await cancellation(),c); assert.equal((await refund('claim')).error,'ALREADY_REFUNDED');
  assert.equal((await refund('release')).error,'ALREADY_REFUNDED');
  assert.equal((await booking()).total_amount,1000);
});
test('bank transfer reference cannot refund two bookings', async () => {
  await db.exec(`insert into bookings select ${"'"+id(2)+"'"},created_at,user_id,'SECOND',renter_name,renter_phone,status,session_id,phone_id,qty,lens_id,lens_qty,add_lens,lens_price,total_amount,deposit_amount,slip_url,slip_verified,slip_verify_amount,'OTHER-PAYMENT',slip_verify_message,slip_verified_at,slip_uploaded_at,pending_expires_at,slip_update_count,last_slip_update_at,delivered_at,returned_at,files_sent_at,details_changed_at from bookings`);
  await cancel(); await refund('claim'); await refund('complete',{reference:'SAME-REF',path:await proof()});
  await cancel(id(2)); await refund('claim',{booking:id(2)});
  assert.equal((await refund('complete',{booking:id(2),reference:' same-ref ',path:await proof(id(2),702)})).error,'REFERENCE_USED');
  assert.equal((await one('select refund_status from booking_cancellations where booking_id=$1',[id(2)])).refund_status,'processing');
});
test('cancelled booking cannot be resurrected, edited, deleted or have its slip/payment replaced', async () => {
  await cancel();
  for(const sql of ["status='confirmed'",'total_amount=0','deposit_amount=0',"slip_verify_ref='reused'",'slip_verified=false','lens_qty=0']) {
    await assert.rejects(db.exec(`update bookings set ${sql}`),/CANCELLED_BOOKING_READ_ONLY/);
  }
  await assert.rejects(db.exec('delete from bookings'),/foreign key/);
  assert.equal((await one('select admin_set_booking_lens($1,$2,1) result',[bookingId,lens])).result.error,'NOT_CONFIRMED');
  assert.equal((await one('select update_booking_slip($1,$2,$3,0) result',[bookingId,user,'new-slip'])).result.error,'CANNOT_UPDATE');
});
test('normal lens editing still works before cancellation', async () => {
  const result=(await one('select admin_set_booking_lens($1,null,0) result',[bookingId])).result;
  assert.equal(result.ok,true); assert.equal((await booking()).total_amount,800); assert.equal((await booking()).status,'confirmed');
});
test('RPC and refund table are inaccessible to browser roles; service role can execute', async () => {
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(cancel(),/permission denied/);
      await assert.rejects(refund('claim'),/permission denied/);
      await assert.rejects(db.exec('select admin_cancellation_money_summary()'),/permission denied/);
      await assert.rejects(db.exec('select * from booking_cancellations'),/permission denied/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.equal((await cancel()).ok,true); } finally { await db.exec('reset role'); }
});

test('money summary keeps original deposit once through pending, processing and completed refunds', async () => {
  const summary = async () => (await one('select admin_cancellation_money_summary() as result')).result;
  assert.deepEqual(await summary(), { revenue: 1000, deposit_received: 100, refund_pending: 0, refunded_amount: 0 });
  await cancel();
  assert.deepEqual(await summary(), { revenue: 0, deposit_received: 100, refund_pending: 100, refunded_amount: 0 });
  await refund('claim');
  assert.deepEqual(await summary(), { revenue: 0, deposit_received: 100, refund_pending: 100, refunded_amount: 0 });
  await refund('complete', { reference: 'BANK-TEST', path: await proof() });
  assert.deepEqual(await summary(), { revenue: 0, deposit_received: 100, refund_pending: 0, refunded_amount: 100 });
});

test('refund storage is protected even with broad existing policies, without changing other buckets', async () => {
  await proof();
  await db.exec("insert into storage.objects values ('slips','existing-slip.png')");
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows, [{ bucket_id: 'slips' }]);
      await assert.rejects(db.exec("insert into storage.objects values ('refund-proofs','unauthorized.png')"), /row-level security/);
      assert.equal((await db.query("delete from storage.objects where bucket_id='refund-proofs' returning name")).rows.length, 0);
      assert.equal((await db.query("update storage.objects set name='changed.png' where bucket_id='refund-proofs' returning name")).rows.length, 0);
      await assert.rejects(db.exec("update storage.objects set bucket_id='refund-proofs' where bucket_id='slips'"), /row-level security/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.equal((await db.query("select name from storage.objects where bucket_id='refund-proofs'")).rows.length, 1); }
  finally { await db.exec('reset role'); }
});
