import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261031121133_booking_discount_codes.sql',import.meta.url),'utf8');
const hardening=readFileSync(new URL('../supabase/migrations/20261031124225_harden_discount_checkout.sql',import.meta.url),'utf8');
const quota=readFileSync(new URL('../supabase/migrations/20261031160000_discount_code_quota.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),user=id(2),phone=id(3),lens=id(4),session=id(5),concert=id(6);
let db;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const result=async(sql,args=[]) => (await one(sql,args)).r;
const create=async(code='SAVE50',amount=50)=>result(`select admin_save_discount_code($1,'create',null,$2,'Test offer',$3,now()-interval '1 day',now()+interval '1 day',true) r`,[admin,code,amount]);
const quote=async(code='SAVE50',who=user,qty=1,lq=1)=>result('select booking_discount_quote($1,$2,$3,$4,$5,$6,$7) r',[who,code,session,phone,qty,lq?lens:null,lq]);
const hold=async(code='SAVE50',who=user,amount=50,qty=1,lq=1)=>result('select create_discount_booking_hold($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',[who,code,session,phone,qty,lq?lens:null,lq,'Test Customer','0000000000',amount]);
const finalize=async(h,who=user)=>result(`select finalize_discount_booking($1,$2,$3,$4,$5,1,$6,1,'Test Customer','0000000000','test-slip',$7) r`,[who,h.booking_id,h.code,session,phone,lens,h.total_amount]);
const getBooking=async(h)=>one('select * from bookings where id=$1',[h.booking_id]);
before(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    -- Hosted Supabase enables RLS when it creates its managed Storage tables.
    alter table storage.objects enable row level security;
    create table admin_users(id uuid primary key,username text);
    create table admin_audit_log(id uuid default gen_random_uuid(),admin_username text,action text,detail text);
    create table phones(id uuid primary key,qty integer,price numeric,deposit numeric,active boolean,model_name text);
    create table lenses(id uuid primary key,qty integer,price numeric,active boolean,name text);
    create table concerts(id uuid primary key,archived boolean,is_visible boolean,publish_at timestamptz);
    create table concert_sessions(id uuid primary key,concert_id uuid,start_at timestamptz);
    create table phone_lenses(phone_id uuid,lens_id uuid);
    create table session_phone_inventory(session_id uuid,phone_id uuid,qty integer,price_override numeric,primary key(session_id,phone_id));
    create table session_lens_inventory(session_id uuid,lens_id uuid,qty integer,primary key(session_id,lens_id));
    create table bookings(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),user_id uuid,
      ref_number text unique,renter_name text,renter_phone text,status text,session_id uuid,phone_id uuid,qty integer,
      lens_id uuid,lens_qty integer,add_lens boolean default false,lens_price integer default 0,total_amount integer,deposit_amount integer,
      slip_url text,pending_expires_at timestamptz,slip_verified boolean,slip_verify_amount numeric,slip_verify_ref text,
      slip_verify_message text,slip_verified_at timestamptz,slip_uploaded_at timestamptz,slip_update_count integer default 0,
      last_slip_update_at timestamptz,delivered_at timestamptz,returned_at timestamptz,files_sent_at timestamptz);
    grant usage on schema public,storage to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    grant select,insert,update,delete on bookings to anon,authenticated;
    grant select on storage.objects to service_role;
  `);
  for(const file of ['add_booking_hold.sql','add_admin_set_booking_lens_rpc.sql','add_booking_cancellation.sql','add_update_slip_rpc.sql'])
    await db.exec(readFileSync(new URL('../scripts/'+file,import.meta.url),'utf8'));
  await db.exec(migration);
  await db.exec(hardening);
  await db.exec(quota);
});
beforeEach(async()=>{
  await db.exec('truncate discount_uses,bookings,discount_codes,booking_cancellations,admin_users,admin_audit_log,phones,lenses,concerts,concert_sessions,phone_lenses,session_phone_inventory,session_lens_inventory cascade');
  await db.query("insert into admin_users values($1,'admin')",[admin]);
  await db.query("insert into phones values($1,100,500,100,true,'Phone')",[phone]);
  await db.query("insert into lenses values($1,100,100,true,'Lens')",[lens]);
  await db.query('insert into concerts values($1,false,true,null)',[concert]);
  await db.query("insert into concert_sessions values($1,$2,now()+interval '7 days')",[session,concert]);
  await db.query('insert into phone_lenses values($1,$2)',[phone,lens]);
  await db.query('insert into session_phone_inventory values($1,$2,100,null)',[session,phone]);
  await db.query('insert into session_lens_inventory values($1,$2,100)',[session,lens]);
  assert.equal((await create()).ok,true);
});
after(async()=>{await db?.close();});

test('discount migration is rerunnable and leaves old bookings untouched',async()=>{
  const normal=await result(`select create_booking_hold($1,$2,$3,1,null,0,'Old','000',500,100,420) r`,[user,session,phone]);
  const old=await getBooking(normal);await db.exec(migration);await db.exec(hardening);await db.exec(quota);assert.deepEqual(await getBooking(normal),old);
});
test('fixed overall discount applies once per booking, not once per phone; deposit stays unchanged',async()=>{
  const q=await quote(' save50 ',user,2,2);
  assert.equal(q.subtotal_amount,1200);assert.equal(q.discount_amount,50);assert.equal(q.total_amount,1150);assert.equal(q.deposit_amount,200);
  const h=await hold('SAVE50',user,50,2,2);assert.equal(h.total_amount,1150);assert.equal((await getBooking(h)).lens_price,200);
});
test('uses current session price override and rejects discounts below the original deposit',async()=>{
  await db.exec('update session_phone_inventory set price_override=700');assert.equal((await quote()).total_amount,750);
  await create('TOOMUCH',701);assert.equal((await quote('TOOMUCH')).error,'DISCOUNT_BELOW_DEPOSIT');
  await create('EXACT',700);assert.equal((await quote('EXACT')).total_amount,100);
});
test('invalid, future, expired, paused and deleted coupons cannot be applied',async()=>{
  assert.equal((await quote('MISSING')).error,'DISCOUNT_UNAVAILABLE');
  await db.exec("update discount_codes set starts_at=now()+interval '1 hour'");assert.equal((await quote()).error,'DISCOUNT_NOT_STARTED');
  await db.exec("update discount_codes set starts_at=now()-interval '2 days',expires_at=now()-interval '1 second'");assert.equal((await quote()).error,'DISCOUNT_EXPIRED');
  await db.exec("update discount_codes set expires_at=now()+interval '1 day',active=false");assert.equal((await quote()).error,'DISCOUNT_UNAVAILABLE');
  await db.exec('update discount_codes set active=true,deleted_at=now()');assert.equal((await quote()).error,'DISCOUNT_UNAVAILABLE');
});
test('quote does not consume entitlement; retrying a hold keeps ID, snapshot and original deadline',async()=>{
  await quote();assert.equal(Number((await one('select count(*) n from discount_uses')).n),0);
  const h=await hold();await db.exec('update phones set price=900,deposit=300;update discount_codes set amount=80,active=false');
  const retry=await hold();assert.equal(retry.booking_id,h.booking_id);assert.equal(retry.expires_at,h.expires_at);assert.equal(retry.total_amount,h.total_amount);
  const f=await finalize(h);assert.equal(f.total_amount,550);assert.equal(f.deposit_amount,100);
});
test('expired or released holds free the entitlement without a cleanup job',async()=>{
  const h=await hold();
  await db.exec("update bookings set pending_expires_at=now()-interval '1 second';update discount_uses set reserved_until=now()-interval '1 second'");
  assert.equal((await finalize(h)).error,'DISCOUNT_HOLD_EXPIRED');
  const next=await hold();assert(next.ok);assert.notEqual(next.booking_id,h.booking_id);
  await db.query('select release_booking_hold($1)',[user]);assert.equal((await hold()).ok,true);
});
test('repeated same-account submissions reuse one booking and consume once; other accounts can use the code',async()=>{
  const [a,b]=await Promise.all([hold(),hold()]);assert.equal(a.booking_id,b.booking_id);
  const [f,g]=await Promise.all([finalize(a),finalize(b)]);assert(f.ok&&g.ok);assert(f.reused!==g.reused);
  assert.equal(Number((await one('select count(*) n from discount_uses where consumed_at is not null')).n),1);
  assert.equal((await hold()).error,'DISCOUNT_ALREADY_USED');assert.equal((await hold('SAVE50',id(22))).ok,true);
  await create('OTHER50');assert.equal((await hold('OTHER50')).ok,true);
});
test('finalization rejects ownership, quantity and price tampering without consuming a coupon',async()=>{
  const h=await hold();assert.equal((await finalize(h,id(99))).error,'DISCOUNT_HOLD_EXPIRED');
  assert.equal((await finalize({...h,total_amount:1})).error,'DISCOUNT_HOLD_MISMATCH');
  assert.equal((await finalize({...h,code:'OTHER'})).error,'DISCOUNT_HOLD_MISMATCH');
  assert.equal((await one('select consumed_at from discount_uses')).consumed_at,null);
});
test('legacy finalize cannot overwrite an accepted discount or deposit with recalculated prices',async()=>{
  const h=await hold();
  await db.query("select finalize_booking_with_slip($1,$2,$3,1,$4,1,'Test','000',999,'legacy-slip',500)",[user,session,phone,lens]);
  const b=await getBooking(h);assert.equal(b.total_amount,550);assert.equal(b.deposit_amount,100);assert.equal(b.discount_amount,50);
  assert((await one('select consumed_at from discount_uses')).consumed_at);
});
test('coupon snapshot cannot be removed, altered or stacked after being attached',async()=>{
  await hold();
  for(const sql of ['update bookings set discount_amount=10','update bookings set discount_code=null','update bookings set discount_code_id=null',
    'update bookings set deposit_amount=1','update bookings set total_amount=1'])await assert.rejects(db.exec(sql),/DISCOUNT_/);
});
test('lens edits retain the discount, calculate the delta and still enforce the deposit floor',async()=>{
  const h=await hold();await finalize(h);await db.exec("update bookings set status='confirmed'");
  const edited=await result('select admin_set_booking_lens($1,null,0) r',[h.booking_id]);
  assert.equal(edited.ok,true);assert.equal((await getBooking(h)).total_amount,450);assert.equal((await getBooking(h)).discount_amount,50);
});
test('removing a lens cannot lower the discounted total below the paid deposit',async()=>{
  await create('BIG450',450);const h=await hold('BIG450',user,450);await finalize(h);await db.exec("update bookings set status='confirmed'");
  const edit=await result('select admin_set_booking_lens($1,null,0) r',[h.booking_id]);
  assert.equal(edit.error,'TOTAL_BELOW_DEPOSIT');assert.equal((await getBooking(h)).total_amount,150);
});
for(const mode of ['refund','no_refund'])test(`cancellation ${mode} preserves entitlement and original deposit, and releases stock`,async()=>{
  const h=await hold();await finalize(h);await db.exec("update bookings set status='confirmed',slip_verified=true,slip_verify_amount=100");
  const c=await result('select admin_cancel_booking($1,$2,$3,$4,$5) r',[h.booking_id,admin,'Customer cancelled',mode==='refund'?100:null,mode]);
  assert.equal(c.ok,true);assert.equal((await hold()).error,'DISCOUNT_ALREADY_USED');
  assert.equal((await getBooking(h)).deposit_amount,100);
});
test('rejected booking can resubmit its slip without another redemption; deleting booking does not reset usage',async()=>{
  const h=await hold();await finalize(h);await db.exec("update bookings set status='rejected'");
  assert.equal((await hold()).error,'DISCOUNT_ALREADY_USED');
  assert.equal((await result("select update_booking_slip($1,$2,'replacement-slip',0) r",[h.booking_id,user])).ok,true);
  assert.equal(Number((await one('select count(*) n from discount_uses where consumed_at is not null')).n),1);
  await db.query('delete from bookings where id=$1',[h.booking_id]);assert.equal((await hold()).error,'DISCOUNT_ALREADY_USED');
});
test('admin soft delete is audited, cannot be reused by name, and keeps usage history',async()=>{
  const h=await hold();await finalize(h);const code=(await one('select id from discount_codes')).id;
  assert.equal((await result("select admin_save_discount_code($1,'delete',$2,null,null,null,null,null,null) r",[admin,code])).ok,true);
  assert.equal((await create()).error,'DISCOUNT_CODE_EXISTS');
  assert.equal((await result('select admin_discount_code_list(0,false) r')).codes.length,0);
  const listing=await result('select admin_discount_code_list(0,true) r');assert.equal(listing.codes[0].used_count,1);assert.equal(listing.codes[0].discount_total,50);
  const usage=await result('select admin_discount_usage($1,0) r',[code]);assert.equal(usage.uses[0].booking_id,h.booking_id);
  assert.equal(Number((await one("select count(*) n from admin_audit_log where action='discount_delete'")).n),1);
});
test('public roles have no coupon table or RPC access; server role can quote and reserve',async()=>{
  assert.equal((await one("select has_table_privilege('anon','discount_codes','SELECT') allowed")).allowed,false);
  assert.equal((await one("select has_function_privilege('authenticated','booking_discount_quote(uuid,text,uuid,uuid,integer,uuid,integer)','EXECUTE') allowed")).allowed,false);
  await db.exec('set role service_role');
  try {assert.equal((await hold()).ok,true);} finally {await db.exec('reset role');}
});

test('a hold can finalize after the campaign expires or is deleted, but cannot be renewed after its own deadline',async()=>{
  const h=await hold();
  await db.exec("update discount_codes set expires_at=now()-interval '1 second',deleted_at=now()");
  assert.equal((await hold()).booking_id,h.booking_id);
  assert.equal((await finalize(h)).ok,true);
  assert.equal((await hold('SAVE50',id(33))).error,'DISCOUNT_UNAVAILABLE');
});

test('stale lens price writes, slip removal and direct changes to a pending cart cannot damage a coupon snapshot',async()=>{
  const h=await hold();
  await assert.rejects(db.exec('update bookings set lens_price=200'),/DISCOUNT_SNAPSHOT_READ_ONLY/);
  await assert.rejects(db.exec('update bookings set lens_qty=2,lens_price=200,total_amount=650'),/DISCOUNT_SNAPSHOT_READ_ONLY/);
  await finalize(h);
  await assert.rejects(db.exec('update bookings set slip_url=null'),/DISCOUNT_SNAPSHOT_READ_ONLY/);
  await db.exec("update bookings set status='confirmed'");
  await assert.rejects(db.exec('update bookings set lens_price=200'),/DISCOUNT_SNAPSHOT_READ_ONLY/);
  const changed=await result('select admin_set_booking_lens($1,null,0) r',[h.booking_id]);
  assert.equal(changed.ok,true);assert.equal((await getBooking(h)).total_amount,450);
});

test('changing a campaign does not change existing amounts or allow the same account to redeem it twice',async()=>{
  const h=await hold();await finalize(h);const code=(await one('select id from discount_codes')).id;
  assert.equal((await result("select admin_save_discount_code($1,'update',$2,'SAVE50','New offer',80,now()-interval '1 day',now()+interval '1 day',true) r",[admin,code])).ok,true);
  assert.equal((await getBooking(h)).discount_amount,50);assert.equal((await quote()).error,'DISCOUNT_ALREADY_USED');
  assert.equal((await quote('SAVE50',id(33))).discount_amount,80);
  assert.equal((await result("select admin_save_discount_code($1,'update',$2,'RENAMED','New offer',80,now()-interval '1 day',now()+interval '1 day',true) r",[admin,code])).error,'DISCOUNT_CODE_READ_ONLY');
});

test('failed stock reservation does not consume a code; cancellation releases both phone and lens stock',async()=>{
  await db.exec('update session_phone_inventory set qty=1;update session_lens_inventory set qty=1');
  const h=await hold();await finalize(h);await db.exec("update bookings set status='confirmed'");
  assert.equal((await hold('SAVE50',id(33))).error,'SOLD_OUT_PHONE');
  assert.equal(Number((await one('select count(*) n from discount_uses')).n),1);
  assert.equal((await result("select admin_cancel_booking($1,$2,'Customer cancelled',null,'no_refund') r",[h.booking_id,admin])).ok,true);
  assert.equal((await hold('SAVE50',id(33))).ok,true);
});

test('invalid admin and invalid amounts cannot create a code or audit row',async()=>{
  assert.equal((await result("select admin_save_discount_code($1,'create',null,'NEW50','Test',50,now(),now()+interval '1 day',true) r",[id(99)])).error,'UNAUTHORIZED');
  assert.equal((await create('ZERO',0)).error,'INVALID_DISCOUNT');
  assert.equal(Number((await one('select count(*) n from discount_codes')).n),1);
  assert.equal(Number((await one('select count(*) n from admin_audit_log')).n),1);
});

test('coupon finalization retains the existing pending-booking cap, while a completed retry is idempotent',async()=>{
  const h=await hold();
  await db.query("insert into bookings(user_id,status,slip_url,ref_number) select $1,'pending','old-slip','OTHER'||n from generate_series(1,3) n",[user]);
  assert.equal((await finalize(h)).error,'TOO_MANY_PENDING');
  assert.equal((await one('select consumed_at from discount_uses')).consumed_at,null);
  await db.exec("update bookings set status='confirmed' where ref_number='OTHER1'");
  assert.equal((await finalize(h)).ok,true);
  assert.equal((await finalize(h)).reused,true);
  assert.equal((await getBooking(h)).slip_url,'test-slip');
});

test('pausing a code changes only its active state and keeps a prior-state audit',async()=>{
  const c=await one('select * from discount_codes');
  const paused=await result("select admin_save_discount_code($1,'set_active',$2,null,null,null,null,null,false) r",[admin,c.id]);
  assert.equal(paused.ok,true);
  const after=await one('select * from discount_codes');
  assert.equal(after.active,false);assert.equal(after.amount,c.amount);assert.equal(after.code,c.code);
  assert.equal(after.expires_at.getTime(),c.expires_at.getTime());
  const audit=JSON.parse((await one("select detail from admin_audit_log where action='discount_set_active'")).detail);
  assert.equal(audit.before.active,true);assert.equal(audit.active,false);
});

test('coupon finalization holds both inventory locks until commit, including through the legacy RPC',async()=>{
  for(const legacy of [false,true]){
    const who=legacy?id(75):user;
    const h=await hold('SAVE50',who);
    await db.exec('begin');
    try {
      if(legacy)await db.query("select finalize_booking_with_slip($1,$2,$3,1,$4,1,'Test','000',600,'legacy-slip',100)",[who,session,phone,lens]);
      else assert.equal((await finalize(h)).ok,true);
      for(const table of ['session_phone_inventory','session_lens_inventory']){
        const locked=await one("select exists(select 1 from pg_locks where relation=$1::regclass and mode='RowShareLock' and granted) yes",[table]);
        assert.equal(locked.yes,true,`${table} must be locked until the slip is committed`);
      }
    } finally {await db.exec('rollback');}
  }
});

test('changed inventory cannot make a held coupon finalize over capacity',async()=>{
  const h=await hold();await db.exec('update session_lens_inventory set qty=0');
  await assert.rejects(finalize(h),/SOLD_OUT_LENS/);
  assert.equal((await getBooking(h)).slip_url,null);
  assert.equal((await one('select consumed_at from discount_uses')).consumed_at,null);
});

test('browser roles cannot bypass the booking API with arbitrary rows or payment updates',async()=>{
  for(const role of ['anon','authenticated']){
    assert.equal((await one("select has_table_privilege($1,'public.bookings','INSERT') yes",[role])).yes,false);
    assert.equal((await one("select has_table_privilege($1,'public.bookings','UPDATE') yes",[role])).yes,false);
    await db.exec(`set role ${role}`);
    try {await assert.rejects(db.query("insert into bookings(user_id,status,total_amount,slip_verified) values($1,'confirmed',1,true)",[user]),/permission denied/);}
    finally {await db.exec('reset role');}
  }
  await db.exec('set role service_role');
  try {
    const h=await hold();assert.equal(h.ok,true);
    assert.equal((await finalize(h)).ok,true,'the server role can still complete the booking through the new trigger');
  }finally{await db.exec('reset role');}
});

test('hardening fails and rolls back if managed Storage RLS is unexpectedly disabled',async()=>{
  await db.exec('alter table storage.objects disable row level security;grant insert on public.bookings to authenticated');
  try{
    await assert.rejects(db.exec(hardening),/Storage RLS is not enabled on storage.objects/);
    await db.exec('rollback');
    assert.equal((await one("select has_table_privilege('authenticated','public.bookings','INSERT') allowed")).allowed,true,'a failed migration must not leave partial privilege changes');
    assert.equal((await one("select relrowsecurity from pg_class where oid='storage.objects'::regclass")).relrowsecurity,false,'the migration must not alter the managed table');
  } finally {
    await db.exec('rollback;alter table storage.objects enable row level security;revoke insert on public.bookings from authenticated');
  }
});

test('slip storage remains server-only even with an old broad upload policy, without blocking other buckets',async()=>{
  await db.exec("grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;grant insert on storage.objects to service_role;create policy old_upload_policy on storage.objects for all to authenticated using(true) with check(true)");
  try{
    await db.exec('set role authenticated');
    await assert.rejects(db.exec("insert into storage.objects values('slips','spoofed.png')"),/row-level security/);
    await db.exec("insert into storage.objects values('other-bucket','allowed.png')");
    await db.exec('reset role;set role service_role');
    await db.exec("insert into storage.objects values('slips','server-upload.png')");
  } finally {await db.exec('reset role;drop policy old_upload_policy on storage.objects;delete from storage.objects');}
});

test('normal holds still finalize and expired normal slips can recover only when capacity remains',async()=>{
  const normal=await result("select create_booking_hold($1,$2,$3,1,$4,1,'Normal','000',600,100,420) r",[user,session,phone,lens]);
  await db.query("select finalize_booking_with_slip($1,$2,$3,1,$4,1,'Normal','000',600,'normal-slip',100)",[user,session,phone,lens]);
  assert.equal((await getBooking(normal)).total_amount,600);
  const expired=await result("select create_booking_hold($1,$2,$3,1,$4,1,'Normal','000',600,100,420) r",[id(55),session,phone,lens]);
  await db.query("update bookings set pending_expires_at=now()-interval '1 second' where id=$1",[expired.booking_id]);
  assert.equal((await result("select update_booking_slip($1,$2,'recovered-slip',0) r",[expired.booking_id,id(55)])).ok,true);
  assert.equal((await getBooking(expired)).pending_expires_at,null);
});

const setQuota=async(n)=>{const c=await one('select id from discount_codes');
  return result("select admin_save_discount_code($1,'update',$2,'SAVE50','Test offer',50,now()-interval '1 day',now()+interval '1 day',true,$3) r",[admin,c.id,n]);};

test("a total quota counts consumed uses and other accounts' live holds, never the caller's own hold",async()=>{
  assert.equal((await setQuota(2)).ok,true);
  const a=await hold();assert.equal(a.ok,true);
  assert.equal((await hold()).booking_id,a.booking_id,'retrying my own hold is not blocked by my own slot');
  assert.equal((await quote()).ok,true,'my own reservation does not count against me');
  assert.equal((await finalize(a)).ok,true);
  assert.equal((await hold('SAVE50',id(40))).ok,true);
  assert.equal((await quote('SAVE50',id(41))).error,'DISCOUNT_QUOTA_FULL');
  assert.equal((await hold('SAVE50',id(41))).error,'DISCOUNT_QUOTA_FULL');
  assert.equal(Number((await one('select count(*) n from bookings where user_id=$1',[id(41)])).n),0,'a full quota creates no stock hold');
});

test('an expired or released hold returns its quota slot; a consumed use keeps it even after cancellation',async()=>{
  await setQuota(1);
  await hold();
  assert.equal((await hold('SAVE50',id(40))).error,'DISCOUNT_QUOTA_FULL');
  await db.query('select release_booking_hold($1)',[user]);
  assert.equal((await hold('SAVE50',id(40))).ok,true,'a released hold frees the slot');
  await db.exec("update bookings set pending_expires_at=now()-interval '1 second';update discount_uses set reserved_until=now()-interval '1 second'");
  const c=await hold();assert.equal(c.ok,true,'an expired hold frees the slot without a cleanup job');
  assert.equal((await finalize(c)).ok,true);
  await db.query("update bookings set status='confirmed' where id=$1",[c.booking_id]);
  assert.equal((await result("select admin_cancel_booking($1,$2,'Customer cancelled',null,'no_refund') r",[c.booking_id,admin])).ok,true);
  assert.equal((await hold('SAVE50',id(40))).error,'DISCOUNT_QUOTA_FULL');
});

test('lowering the quota stops new uses but keeps an accepted hold payable',async()=>{
  await setQuota(5);const a=await hold();await hold('SAVE50',id(40));
  await setQuota(1);
  assert.equal((await hold('SAVE50',id(41))).error,'DISCOUNT_QUOTA_FULL');
  assert.equal((await finalize(a)).ok,true);
});

test('admin can set, clear and validate the quota; listing shows holds; older 9-argument saves keep it',async()=>{
  const c=await one('select id from discount_codes');
  for(const bad of [0,-1,1000001])assert.equal((await setQuota(bad)).error,'INVALID_DISCOUNT');
  assert.equal((await setQuota(5)).ok,true);assert.equal((await one('select max_uses from discount_codes')).max_uses,5);
  assert.equal((await result("select admin_save_discount_code($1,'update',$2,'SAVE50','Old admin page',60,now()-interval '1 day',now()+interval '1 day',true) r",[admin,c.id])).ok,true);
  assert.equal((await one('select max_uses from discount_codes')).max_uses,5,'a stale admin page cannot silently remove the quota');
  assert.equal((await result("select admin_save_discount_code($1,'set_active',$2,null,null,null,null,null,false,null) r",[admin,c.id])).ok,true);
  assert.equal((await one('select max_uses from discount_codes')).max_uses,5,'pausing keeps the quota');
  assert(Number((await one(`select count(*) n from admin_audit_log where detail like '%"max_uses": 5%'`)).n)>0);
  assert.equal((await setQuota(null)).ok,true);assert.equal((await one('select max_uses from discount_codes')).max_uses,null);
  await setQuota(3);await hold();
  const row=(await result('select admin_discount_code_list(0,false) r')).codes[0];
  assert.equal(row.max_uses,3);assert.equal(row.reserved_count,1);assert.equal(row.used_count,0);
  assert.equal((await one("select has_function_privilege('authenticated','discount_code_taken(uuid,uuid)','EXECUTE') allowed")).allowed,false);
});

test('changing the cart while holding the last slot keeps the same slot instead of locking the customer out',async()=>{
  await setQuota(1);
  assert.equal((await hold()).ok,true);
  const changed=await hold('SAVE50',user,50,2,1);assert.equal(changed.ok,true,'a new cart replaces my own hold, not another slot');
  assert.equal(Number((await one('select count(*) n from bookings where user_id=$1',[user])).n),1);
  assert.equal((await hold('SAVE50',id(40))).error,'DISCOUNT_QUOTA_FULL');
  await db.query('select create_booking_hold($1,$2,$3,1,null,0,$4,$5,500,100,420)',[user,session,phone,'Test','000']);
  assert.equal((await hold('SAVE50',id(40))).ok,true,'switching to a normal-price hold frees the coupon slot');
});

test('a rejected or deleted booking keeps its quota slot, and resubmitting its slip does not take a second one',async()=>{
  await setQuota(2);
  const a=await hold();await finalize(a);await db.query("update bookings set status='rejected' where id=$1",[a.booking_id]);
  assert.equal((await result("select update_booking_slip($1,$2,'replacement-slip',0) r",[a.booking_id,user])).ok,true);
  assert.equal((await result('select discount_code_taken(id,null) r from discount_codes')),1);
  const b=await hold('SAVE50',id(40));await finalize(b,id(40));
  await db.query('delete from bookings where id=$1',[b.booking_id]);
  assert.equal((await result('select discount_code_taken(id,null) r from discount_codes')),2);
  assert.equal((await hold('SAVE50',id(41))).error,'DISCOUNT_QUOTA_FULL');
});

test('codes created through the old 9-argument RPC stay unlimited',async()=>{
  assert.equal((await create('OLDPAGE')).ok,true);
  assert.equal((await one("select max_uses from discount_codes where code='OLDPAGE'")).max_uses,null);
});
