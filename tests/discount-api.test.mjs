import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { loadTs, loadSource, mockClient } from './load-typescript.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const user=id(1),admin=id(2),booking=id(3),session=id(4),phone=id(5),lens=id(6);
const response={json:(body,init={})=>({body,status:init.status??200,headers:init.headers})};
const discounts=loadTs('src/lib/discounts.ts');
const auth=loadTs('src/lib/adminAuth.ts');
const noLog={logServerError:()=>{}};
process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-not-a-real-key';
process.env.APP_SESSION_SECRET='test-only-secret';
let oldFetch;
before(()=>{oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('No network in tests');};});
after(()=>{globalThis.fetch=oldFetch;});
const token=()=>auth.signJWT({line_sub:'U'+'a'.repeat(32),exp:Math.floor(Date.now()/1000)+600},process.env.APP_SESSION_SECRET);
function request(body,method='POST',headers={},cookie=token(),path='/api/bookings/discount'){
  const req=new Request('https://test.invalid'+path,{method,headers:{...(body instanceof FormData?{}:{'content-type':'application/json'}),...headers},
    ...(method==='GET'||method==='DELETE'?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
  req.cookies={get:()=>cookie?{value:cookie}:undefined};return req;
}
const cart={session_id:session,phone_id:phone,qty:1,lens_id:lens,lens_qty:1,renter_name:'Test',renter_phone:'0000000000'};
const quote={ok:true,code:'SAVE50',discount_amount:50,subtotal_amount:600,total_amount:550,deposit_amount:100,expires_at:new Date(Date.now()+300000).toISOString()};
const held={...quote,booking_id:booking,ref_number:'BKTEST'};
const finalized={...held,discount_code:'SAVE50',lens_price:100,slip_url:'https://test.invalid/first-slip'};
function harness({authorized=true,rpcData=quote,rpcError=null,snapshot=finalized,pending=0}={}){
  const {client,calls}=mockClient(call=>{
    const table=call.table;
    if(table==='privacy_notice_acknowledgements')return{data:{user_id:user},error:null};
    if(table==='concert_sessions')return{data:{id:session,start_at:new Date(Date.now()+86400000).toISOString(),concerts:{archived:false,is_visible:true,title:'Test'}},error:null};
    if(table==='phones')return{data:{price:500,deposit:100,model_name:'Phone'},error:null};
    if(table==='session_phone_inventory')return{data:{price_override:null},error:null};
    if(table==='phone_lenses')return{data:{lens_id:lens,lenses:{price:100,name:'Lens',active:true}},error:null};
    if(table==='bookings')return{data:snapshot,error:null,count:pending};
    return{data:null,error:null};
  },async()=>({data:rpcData,error:rpcError}));
  const storage=[],background=[],sheets=[],verifications=[];
  client.storage={from:()=>({
    upload:async(path,_bytes,options)=>{storage.push(['upload',path,options]);return{error:null};},
    getPublicUrl:path=>({data:{publicUrl:`https://test.invalid/slips/${path}`}}),
    remove:async paths=>{storage.push(['remove',paths]);return{error:null};},
  })};
  const lineSession={findOrCreateLineUser:async()=>({userId:user})};
  const server=loadTs('src/lib/discountServer.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},
    '@/lib/adminAuth':{...auth,requireAdmin:async()=>authorized?{ok:true,payload:{admin_id:admin}}:{ok:false}},
    '@/lib/lineSession':lineSession,'@/lib/apiLog':noLog,'@/lib/discounts':discounts,
  });
  const mocks={
    'next/server':{NextResponse:response,after:fn=>background.push(fn)},
    '@supabase/supabase-js':{createClient:()=>client},'@/lib/discountServer':server,'@/lib/discounts':discounts,
    '@/lib/lineSession':lineSession,'@/lib/privacyNotice':{PRIVACY_NOTICE_VERSION:'test'},'@/lib/apiLog':noLog,
    '@/lib/imageUpload':loadTs('src/lib/imageUpload.ts'),
    '@/lib/sheetsSync':{syncBookingToSheet:async body=>sheets.push(body)},
    '@/lib/slipOk':{verifySlipForBooking:async id=>{verifications.push(id);return{ok:true};}},
  };
  return{calls,storage,background,sheets,verifications,
    quote:loadTs('src/app/api/bookings/discount/route.ts',mocks),
    admin:loadTs('src/app/api/admin/discount-codes/route.ts',mocks),
    reserve:loadTs('src/app/api/bookings/reserve/route.ts',mocks),
    upload:loadTs('src/app/api/bookings/upload-slip/route.ts',mocks)};
}
const rpcCalls=h=>h.calls.filter(c=>c.kind==='rpc');
function slipForm(coupon=true){
  const form=new FormData();for(const[k,v]of Object.entries(cart))form.set(k,String(v));
  form.set('total_amount',coupon?'550':'600');
  if(coupon){form.set('discount_code','SAVE50');form.set('booking_id',booking);}
  form.set('slip',new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],'slip.png',{type:'image/png'}));
  return form;
}

test('discount routes reject missing/expired customer sessions, unauthorized admins and cross-origin writes',async()=>{
  const h=harness({authorized:false});
  for(const method of ['GET','POST'])assert.equal((await h.admin[method](request({},method))).status,401);
  for(const cookie of ['', 'bad-token', auth.signJWT({line_sub:'user',exp:1},process.env.APP_SESSION_SECRET)])
    assert.equal((await h.quote.POST(request({...cart,code:'SAVE50'},'POST',{},cookie))).status,401);
  assert.equal((await h.quote.POST(request({...cart,code:'SAVE50'},'POST',{origin:'https://evil.invalid'}))).status,403);
  const authorized=harness();
  assert.equal((await authorized.admin.POST(request({},'POST',{'sec-fetch-site':'cross-site'}))).status,403);
  assert.equal(rpcCalls(h).length+rpcCalls(authorized).length,0);
});

test('quote and reservation use the authenticated account and database pricing, never client identities/amounts',async()=>{
  const h=harness({rpcData:held});
  const q=await h.quote.POST(request({...cart,code:' save50 ',user_id:id(99),total_amount:1,discount_amount:999}));
  assert.equal(q.status,200);assert.equal(q.headers['Cache-Control'],'no-store');
  assert.deepEqual(rpcCalls(h)[0].args,['booking_discount_quote',{p_user_id:user,p_code:'SAVE50',p_session_id:session,p_phone_id:phone,p_qty:1,p_lens_id:lens,p_lens_qty:1}]);
  const r=await h.reserve.POST(request({...cart,discount_code:'SAVE50',expected_discount_amount:50,user_id:id(99),total_amount:1}));
  assert.equal(r.status,200);assert.equal(r.body.total_amount,550);assert.equal(r.body.deposit_amount,100);
  const args=rpcCalls(h)[1].args;assert.equal(args[0],'create_discount_booking_hold');assert.equal(args[1].p_user_id,user);
  assert.equal(args[1].p_expected_discount,50);assert.equal(args[1].p_total_amount,undefined);
});

test('invalid quantity and malformed requests fail before discount RPCs',async()=>{
  const h=harness();
  for(const body of [null,{}, {...cart,code:'x'}, {...cart,code:'SAVE50',qty:1.5},{...cart,code:'SAVE50',lens_qty:2},{...cart,code:'SAVE50',phone_id:'invalid'}])
    assert.equal((await h.quote.POST(request(body))).status,400);
  assert.equal((await h.reserve.POST(request({...cart,discount_code:'SAVE50'}))).status,400);
  assert.equal(rpcCalls(h).length,0);
});

test('normal reservations still use the original RPC and ignore user-supplied total',async()=>{
  const h=harness({rpcData:held});
  const r=await h.reserve.POST(request({...cart,total_amount:1,discount_amount:999}));
  assert.equal(r.status,200);assert.equal(r.body.total_amount,600);assert.equal(r.body.deposit_amount,100);
  const args=rpcCalls(h)[0].args;assert.equal(args[0],'create_booking_hold');assert.equal(args[1].p_total_amount,600);
});

test('admin validates amounts and timezone, uses trusted actor and clears irrelevant delete fields',async()=>{
  const h=harness({rpcData:{ok:true}});
  const b={action:'create',code:' save50 ',name:'Test offer',amount:50,starts_at:'2026-10-31T10:00:00+07:00',expires_at:'2026-11-01T10:00:00+07:00',active:true,admin_id:id(99)};
  for(const extra of [{amount:0},{amount:1.5},{expires_at:b.starts_at},{starts_at:'2026-10-31T10:00:00'},{name:' '},{code:'bad code'}])
    assert.equal((await h.admin.POST(request({...b,...extra}))).status,400);
  assert.equal(rpcCalls(h).length,0);
  assert.equal((await h.admin.POST(request(b))).status,200);
  assert.equal(rpcCalls(h)[0].args[1].p_admin_id,admin);assert.equal(rpcCalls(h)[0].args[1].p_code,'SAVE50');
  assert.equal(rpcCalls(h)[0].args[1].p_starts_at,'2026-10-31T03:00:00.000Z');
  assert.equal((await h.admin.POST(request({action:'delete',id:booking,amount:'bad',expires_at:'bad'}))).status,200);
  assert.equal(rpcCalls(h)[1].args[1].p_amount,null);assert.equal(rpcCalls(h)[1].args[1].p_expires_at,null);
  assert.equal((await h.admin.POST(request({action:'set_active',id:booking,active:false,amount:999}))).status,200);
  assert.equal(rpcCalls(h)[2].args[1].p_amount,null);assert.equal(rpcCalls(h)[2].args[1].p_active,false);
});

test('missing migration and business conflicts never appear as successful discounts',async()=>{
  for(const [rpcData,rpcError,status]of [[null,null,503],[null,{code:'PGRST202',message:'missing'},503],[{error:'DISCOUNT_ALREADY_USED'},null,409],[{error:'DISCOUNT_BELOW_DEPOSIT'},null,409]]){
    const h=harness({rpcData,rpcError});assert.equal((await h.quote.POST(request({...cart,code:'SAVE50'}))).status,status);
  }
});

test('coupon upload sends exact hold and authenticated owner; Sheets and response use accepted net price',async()=>{
  const h=harness({rpcData:finalized});const r=await h.upload.POST(request(slipForm()));
  assert.equal(r.status,200);assert.equal(r.body.total_amount,550);assert.equal(r.body.deposit_amount,100);assert.equal(r.body.lens_price,100);
  const args=rpcCalls(h)[0].args;assert.equal(args[0],'finalize_discount_booking');assert.equal(args[1].p_user_id,user);
  assert.equal(args[1].p_expected_total,550);assert.equal(args[1].p_booking_id,booking);
  assert.equal(h.storage[0][2].upsert,false);assert.match(h.storage[0][1],/[0-9a-f-]{36}\.png$/);
  assert(!h.calls.some(c=>c.operations?.some(op=>op[0]==='update'&&'lens_price'in op[1])));
  assert.equal(h.background.length,1);await h.background[0]();
  assert.equal(h.sheets[0].total_amount,550);assert.deepEqual(h.verifications,[booking]);
});

test('repeated coupon upload preserves first slip and avoids duplicate background work',async()=>{
  const h=harness({rpcData:{...finalized,reused:true},pending:2});const r=await h.upload.POST(request(slipForm()));
  assert.equal(r.status,200);assert.equal(r.body.slip_url,finalized.slip_url);assert.equal(h.background.length,0);
  assert.equal(h.storage.filter(x=>x[0]==='remove').length,1);
  assert(h.calls.some(c=>c.operations?.some(op=>op[0]==='neq'&&op[1]==='id'&&op[2]===booking)));
});

test('uncertain upload commit keeps proof, while definite rejection removes unused proof',async()=>{
  for(const [rpcData,rpcError,removes]of [[null,{code:'504',message:'timeout'},0],[{error:'DISCOUNT_HOLD_EXPIRED'},null,1],[null,{code:'P0001',message:'rollback'},1]]){
    const h=harness({rpcData,rpcError});const r=await h.upload.POST(request(slipForm()));
    assert(r.status>=400);assert.equal(h.storage.filter(x=>x[0]==='remove').length,removes);assert.equal(h.background.length,0);
  }
});

test('legacy upload of a coupon hold reads the saved discount instead of syncing the gross amount',async()=>{
  const h=harness({rpcData:{booking_id:booking,ref_number:'BKTEST'}});const r=await h.upload.POST(request(slipForm(false)));
  assert.equal(r.status,200);assert.equal(r.body.total_amount,550);assert.equal(rpcCalls(h)[0].args[0],'finalize_booking_with_slip');
  await h.background[0]();assert.equal(h.sheets[0].total_amount,550);
  assert(!h.calls.some(c=>c.operations?.some(op=>op[0]==='update'&&'lens_price'in op[1])));
});

test('normal upload retains its original total, deposit and lens snapshot',async()=>{
  const h=harness({rpcData:{booking_id:booking},snapshot:{total_amount:600,deposit_amount:100,discount_amount:0}});
  const r=await h.upload.POST(request(slipForm(false)));assert.equal(r.status,200);assert.equal(r.body.total_amount,600);
  assert(h.calls.some(c=>c.operations?.some(op=>op[0]==='update'&&op[1].lens_price===100)));
  await h.background[0]();assert.equal(h.sheets[0].total_amount,600);
});

test('Thai schedule inputs round-trip independently of device timezone and reject nonexistent dates',()=>{
  assert.equal(discounts.thaiDateTimeISO('2026-10-31T10:00'),'2026-10-31T03:00:00.000Z');
  assert.equal(discounts.thaiDateTimeInput('2026-10-31T03:00:00Z'),'2026-10-31T10:00');
  assert.equal(discounts.thaiDateTimeISO('2026-02-30T10:00'),'');
  assert.equal(discounts.validDiscountQuote({...quote,total_amount:1}),false);
  assert.equal(discounts.validDiscountQuote({...quote,deposit_amount:600}),false);
});

test('discount input labels are accessible and show a fixed overall discount with unchanged deposit',()=>{
  const styles=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:String(key)});
  const Input=loadTs('src/app/DiscountCodeInput.tsx',{'@/lib/discounts':discounts,'./DiscountCodeInput.module.css':styles}).default;
  const html=renderToStaticMarkup(createElement(Input,{value:'SAVE50',quote,disabled:false,cart,onChange:()=>{},onApply:()=>{}}));
  assert.match(html,/booking-discount-code/);assert.match(html,/aria-live="polite"/);assert.match(html,/SAVE50 ลด 50 บาท/);
});

test('existing approval message displays original total, discount, net and unchanged paid deposit',()=>{
  const source=readFileSync(new URL('../src/lib/lineMessaging.ts',import.meta.url),'utf8');
  const {buildBookingApprovedFlexMessage:build}=loadSource(source+'\nexport { buildBookingApprovedFlexMessage };');
  const text=JSON.stringify(build({totalAmount:550,discountAmount:50,discountCode:'SAVE50',depositPaid:100,qty:1}));
  for(const expected of ['ยอดก่อนลด','฿600','ส่วนลด SAVE50','−฿50','ยอดสุทธิ','฿550','฿100','฿450'])assert(text.includes(expected));
  assert(!JSON.stringify(build({totalAmount:600,depositPaid:100,qty:1})).includes('ยอดก่อนลด'));
});

test('expiry cannot reset payment details while uploading or after moving from an expired details timer to payment',()=>{
  const {shouldExpireBooking}=loadTs('src/lib/bookingFlow.ts');
  const timer={step:4,timerStep:4,remainingSeconds:0,requestPending:false};
  assert.equal(shouldExpireBooking({...timer,requestPending:true}),false,'an in-flight upload retains payment details');
  assert.equal(shouldExpireBooking({...timer,timerStep:3}),false,'a stale details timer must not delete the newly accepted hold');
  assert.equal(shouldExpireBooking({...timer,step:5}),false,'success is never reset by the previous payment timer');
  assert.equal(shouldExpireBooking({...timer,remainingSeconds:null}),false);
  assert.equal(shouldExpireBooking({...timer,remainingSeconds:1}),false);
  assert.equal(shouldExpireBooking(timer),true,'an idle expired payment page still releases its hold');
  assert.equal(shouldExpireBooking({...timer,step:3,timerStep:3}),true);
});

test('database expiry and stock conflicts return actionable errors and remove only the rejected upload',async()=>{
  for(const message of ['DISCOUNT_HOLD_EXPIRED','SOLD_OUT_PHONE','SOLD_OUT_LENS']){
    const h=harness({rpcData:null,rpcError:{code:'P0001',message}});
    const r=await h.upload.POST(request(slipForm()));
    assert.equal(r.status,409);assert.equal(r.body.code,message);assert.match(r.body.error,/ห้ามโอนซ้ำ/);
    assert.equal(h.storage.filter(s=>s[0]==='remove').length,1);assert.equal(h.background.length,0);
  }
});

test('a normal booking keeps its uploaded slip when the finalize result is unknown, but removes it when the database rejects it',async()=>{
  const unknown=harness({rpcData:null,rpcError:{message:'TypeError: fetch failed'}});
  assert.equal((await unknown.upload.POST(request(slipForm(false)))).status,500);
  assert.equal(unknown.storage.filter(s=>s[0]==='remove').length,0,'a timeout may have committed the booking with this slip');
  const soldOut=harness({rpcData:null,rpcError:{code:'P0001',message:'SOLD_OUT_PHONE'}});
  const r=await soldOut.upload.POST(request(slipForm(false)));
  assert.equal(r.status,409);assert.equal(r.body.error,'sold_out');
  assert.equal(soldOut.storage.filter(s=>s[0]==='remove').length,1);
});
