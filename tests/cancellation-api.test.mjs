import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTs, mockClient } from './load-typescript.mjs';

const bookingId='00000000-0000-4000-8000-000000000001';
const adminId='00000000-0000-4000-8000-000000000101';
const userId='00000000-0000-4000-8000-000000000501';
const ctx={params:Promise.resolve({id:bookingId})};
const response={json:(body, init={})=>({body,status:init.status??200,headers:init.headers})};
const noLog={logServerError:()=>{}};
const url=`https://test.invalid/api/admin/bookings/${bookingId}`;
let oldFetch;
before(()=>{ oldFetch=globalThis.fetch; globalThis.fetch=async()=>{throw new Error('Tests must not use the network');}; });
after(()=>{globalThis.fetch=oldFetch;});

function harness({authorized=true, result={ok:true}, error=null, resolve=()=>({data:null,error:null})}={}) {
  const {client,calls}=mockClient(resolve, async()=>({data:result,error}));
  const background=[]; const storage=[];
  client.storage={from:bucket=>({
    upload:async(path,bytes,options)=>{storage.push(['upload',bucket,path,bytes.length,options]);return{error:null};},
    remove:async(paths)=>{storage.push(['remove',bucket,paths]);return{error:null};},
    createSignedUrl:async(path,expiry)=>{storage.push(['sign',bucket,path,expiry]);return{data:{signedUrl:'https://test.invalid/private-proof'},error:null};},
  })};
  const server=loadTs('src/lib/bookingCancellationServer.ts',{
    'next/server':{NextResponse:response},
    '@supabase/supabase-js':{createClient:()=>client},
    '@/lib/adminAuth':{requireAdmin:async()=>authorized?{ok:true,payload:{admin_id:adminId}}:{ok:false}},
    '@/lib/apiLog':noLog,
    '@/lib/sheetsSync':{syncBookingToSheet:async()=>{throw new Error('Unexpected Sheets write');}},
  });
  const mocks={
    'next/server':{NextResponse:response,after:fn=>background.push(fn)},
    '@/lib/bookingCancellationServer':server,
    '@/lib/bookingCancellation':loadTs('src/lib/bookingCancellation.ts'),
    '@/lib/imageUpload':loadTs('src/lib/imageUpload.ts'),
  };
  return {server,calls,storage,background,client,
    cancellation:loadTs('src/app/api/admin/bookings/[id]/cancellation/route.ts',mocks),
    refund:loadTs('src/app/api/admin/bookings/[id]/refund/route.ts',mocks)};
}
// Dummy values only; the client constructor is replaced above and no .env is read.
process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-not-a-real-key';
const jsonReq=(path,body,method='POST',headers={})=>new Request(url+path,{method,headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

test('all cancellation/refund endpoints require admin authorization',async()=>{
  const h=harness({authorized:false});
  for(const route of [h.cancellation,h.refund]) for(const method of Object.keys(route).filter(k=>['GET','POST','PATCH'].includes(k))){
    const req=method==='GET'?new Request(url):jsonReq('',{},method);
    assert.equal((await route[method](req,ctx)).status,401);
  }
  assert.equal(h.calls.length,0);assert.equal(h.storage.length,0);
});
test('cross-origin requests, invalid ids and empty cancellation requests cannot mutate',async()=>{
  const h=harness();
  assert.equal((await h.cancellation.POST(jsonReq('/cancellation',{reason:'valid',confirmed_deposit:true},'POST',{origin:'https://evil.invalid'}),ctx)).status,403);
  assert.equal((await h.cancellation.POST(jsonReq('/cancellation',{}),{params:Promise.resolve({id:'bad'})})).status,400);
  for(const body of [{},null,{reason:'valid'},{reason:'x',confirmed_deposit:true}])assert.equal((await h.cancellation.POST(jsonReq('/cancellation',body),ctx)).status,400);
  assert.equal(h.calls.length,0);
});
test('cancellation passes preview as acknowledgement only, never an arbitrary refund/admin ID or LINE call',async()=>{
  const h=harness();const res=await h.cancellation.POST(jsonReq('/cancellation',{reason:'Verified cancellation',refund_mode:'refund',confirmed_deposit:true,expected_refund_amount:200,refund_amount:99999,admin_id:'attacker'}),ctx);
  assert.equal(res.status,200);
  assert.deepEqual(h.calls[0].args,['admin_cancel_booking',{p_booking_id:bookingId,p_admin_id:adminId,p_reason:'Verified cancellation',p_expected_refund_amount:200,p_refund_mode:'refund'}]);
  assert.equal(h.background.length,1); // only the optional Sheets copy
  await h.background[0](); // no webhook configured -> no external side effects
  for(const file of ['cancellation','refund'])assert(!readFileSync(new URL(`../src/app/api/admin/bookings/[id]/${file}/route.ts`,import.meta.url),'utf8').includes('lineMessaging'));
});
test('missing migration produces a clear setup error, never a success',async()=>{
  const h=harness({error:{code:'PGRST202',message:'function missing'}});
  const res=await h.cancellation.POST(jsonReq('/cancellation',{reason:'valid reason',refund_mode:'refund',confirmed_deposit:true,expected_refund_amount:100}),ctx);
  assert.equal(res.status,503);assert.match(res.body.error,/add_booking_cancellation.sql/);assert.equal(h.background.length,0);
});
test('NULL RPC responses and business conflicts are not reported as success',async()=>{
  for(const [result,status] of [[null,503],[{error:'DEPOSIT_INVALID'},409],[{error:'REFUND_AMOUNT_CHANGED'},409],[{error:'NOT_FOUND'},404]]){
    const h=harness({result});assert.equal((await h.cancellation.POST(jsonReq('/cancellation',{reason:'valid reason',refund_mode:'refund',confirmed_deposit:true,expected_refund_amount:100}),ctx)).status,status);
  }
});
test('release requires explicit acknowledgement that no money was transferred',async()=>{
  const h=harness();assert.equal((await h.refund.PATCH(jsonReq('/refund',{action:'release'},'PATCH'),ctx)).status,400);
  assert.equal(h.calls.length,0);
  assert.equal((await h.refund.PATCH(jsonReq('/refund',{action:'release',not_transferred:true},'PATCH'),ctx)).status,200);
});
function refundForm(bytes=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])){
  const form=new FormData();form.set('proof',new File([bytes],'refund.png',{type:'image/png'}));form.set('reference','BANK-TEST');form.set('transferred','true');form.set('expected_refund_amount','100');return form;
}
const refundReq=form=>new Request(url+'/refund',{method:'POST',body:form});
const ownClaim=()=>({data:{refund_status:'processing',processing_by:adminId,refund_amount:100},error:null});
test('refund evidence cannot be submitted without the claim or with spoofed image bytes',async()=>{
  const other=harness({resolve:()=>({data:{refund_status:'processing',processing_by:'other'},error:null})});
  assert.equal((await other.refund.POST(refundReq(refundForm()),ctx)).status,409);assert.equal(other.storage.length,0);
  const own=harness({resolve:ownClaim});assert.equal((await own.refund.POST(refundReq(refundForm(new TextEncoder().encode('<script>bad</script>'))),ctx)).status,400);assert.equal(own.storage.length,0);
});
test('refund proof uses a random private path, records no arbitrary amount, and queues no LINE',async()=>{
  const h=harness({resolve:ownClaim});assert.equal((await h.refund.POST(refundReq(refundForm()),ctx)).status,200);
  const upload=h.storage[0];assert.equal(upload[1],'refund-proofs');assert.match(upload[2],new RegExp('^'+bookingId+'/[0-9a-f-]+\\.png$'));assert.equal(upload[4].upsert,false);
  const rpc=h.calls.find(c=>c.kind==='rpc');assert.equal(rpc.args[1].p_action,'complete');assert.equal(rpc.args[1].p_proof_path,upload[2]);assert.equal(rpc.args[1].p_reference,'BANK-TEST');
});
test('ambiguous RPC failure preserves the uploaded proof; known rejected RPC removes unused upload',async()=>{
  const h=harness({resolve:ownClaim,error:{message:'network failure after commit'}});
  assert.equal((await h.refund.POST(refundReq(refundForm()),ctx)).status,503);assert.deepEqual(h.storage.map(x=>x[0]),['upload']);
  const rejected=harness({resolve:ownClaim,result:{error:'REFERENCE_USED'}});
  assert.equal((await rejected.refund.POST(refundReq(refundForm()),ctx)).status,409);assert.deepEqual(rejected.storage.map(x=>x[0]),['upload','remove']);
});
test('retrying already-completed refund does not upload, write, or replace evidence',async()=>{
  const h=harness({resolve:()=>({data:{refund_status:'refunded'},error:null})});
  const res=await h.refund.POST(refundReq(refundForm()),ctx);assert.equal(res.body.unchanged,true);assert.equal(h.storage.length,0);assert(!h.calls.some(c=>c.kind==='rpc'));
});
test('private refund proof links are short-lived and never returned without auth',async()=>{
  const h=harness({resolve:()=>({data:{refund_status:'refunded',refund_proof_path:`${bookingId}/proof.png`},error:null})});
  assert.equal((await h.refund.GET(new Request(url+'/refund'),ctx)).status,200);
  assert.equal(h.storage[0][3],300);
});
test('normal booking reads do not depend on migration; refund metadata failures stay unknown',async()=>{
  const h=harness({resolve:()=>({data:null,error:{message:'missing table'}})});
  assert.equal((await h.server.readCancellationSummaries(h.client,[])).size,0);assert.equal(h.calls.length,0);
  assert.equal((await h.server.readCancellationSummaries(h.client,[bookingId])).size,0);
});

for (const [status, amount] of [['pending',100],['not_entitled',0]]) test(`customer history ${status} stays owner-scoped and excludes private refund data`,async()=>{
  const appUser=id=>id==='user'?userId:bookingId;
  const {client,calls}=mockClient(call=>call.table==='bookings'
    ?{data:[{id:bookingId,status:'cancelled',total_amount:1000}],error:null}
    :{data:[{booking_id:bookingId,refund_status:status,refund_amount:amount,cancelled_at:'2026-10-07T00:00:00Z',refunded_at:null}],error:null});
  const shared=harness().server;
  const secret='test-only-secret';process.env.APP_SESSION_SECRET=secret;
  const h=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({line_sub:'TEST',app_user_id:appUser('user'),exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const token=`${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;
  const api=loadTs('src/app/api/bookings/my-v2/route.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},'@/lib/apiLog':noLog,'@/lib/bookingCancellationServer':shared,
  });
  const res=await api.GET({cookies:{get:()=>({value:token})}});
  assert.equal(res.status,200);assert.equal(res.body.bookings[0].cancellation.refund_amount,amount);
  assert.equal(res.body.bookings[0].cancellation.refund_status,status);
  assert(calls[0].operations.some(([op,col,val])=>op==='eq'&&col==='user_id'&&val===userId));
  assert(calls[0].operations.some(([op,col,val])=>op==='in'&&col==='status'&&val.includes('cancelled')));
  const columns=calls[1].operations.find(x=>x[0]==='select')[1];assert(!/proof|reason|processing_by|reference/.test(columns));
});

test('summary excludes cancelled rental value, retains deposit history and separates refund totals',async()=>{
  const {client,calls}=mockClient(call=>{
    const head=call.operations.find(x=>x[0]==='select')?.[2]?.head;
    const status=call.operations.find(x=>x[0]==='eq'&&x[1]==='status')?.[2];
    if(head)return{count:status==='cancelled'?2:1,data:null,error:null};
    throw new Error('Financial reads must use one RPC snapshot');
  }, async name => { assert.equal(name,'admin_cancellation_money_summary');return {data:{revenue:800,deposit_received:300,refund_pending:100,refunded_amount:100},error:null}; });
  const api=loadTs('src/app/api/admin/bookings/summary/route.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},
    '@/lib/adminAuth':{requireAdmin:async()=>({ok:true})},'@/lib/apiLog':noLog,'@/lib/supabaseRetry':{retryRead:async(_scope,fn)=>await fn()},
  });
  const res=await api.GET({});assert.equal(res.status,200);assert.equal(res.body.revenue,800);
  assert.equal(res.body.deposit_received,300);assert.equal(res.body.refund_pending,100);assert.equal(res.body.refunded_amount,100);
  assert.equal(calls.filter(c=>c.kind==='rpc').length,1);
});

test('summary without cancellations preserves old amounts and needs no new RPC',async()=>{
  const {client,calls}=mockClient(call=>{
    const head=call.operations.find(x=>x[0]==='select')?.[2]?.head;
    const status=call.operations.find(x=>x[0]==='eq'&&x[1]==='status')?.[2];
    if(head)return{count:status==='cancelled'?0:1,data:null,error:null};
    assert.equal(status,'confirmed');return{data:[{total_amount:800,deposit_amount:100}],error:null};
  });
  const api=loadTs('src/app/api/admin/bookings/summary/route.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},
    '@/lib/adminAuth':{requireAdmin:async()=>({ok:true})},'@/lib/apiLog':noLog,'@/lib/supabaseRetry':{retryRead:async(_scope,fn)=>await fn()},
  });
  const res=await api.GET({});assert.equal(res.status,200);assert.equal(res.body.revenue,800);
  assert.equal(res.body.deposit_received,100);assert.equal(res.body.refund_pending,0);assert.equal(res.body.refunded_amount,0);
  assert(!calls.some(c=>c.kind==='rpc'));
});

test('refund UI uses the stored amount in every state with no LINE action',()=>{
  const labels=loadTs('src/lib/bookingCancellation.ts');
  for(const amount of [100,200,1250.5]) for(const status of ['pending','processing','refunded']) for(const own of [false,true]){
    let n=0;
    const details={booking:{id:bookingId,ref_number:'TEST',renter_name:'TEST',status:'cancelled'},can_cancel:false,can_manage_refund:own,
      refund_amount:99999, // The recorded cancellation amount must take precedence.
      cancellation:{booking_id:bookingId,refund_amount:amount,refund_status:status,cancelled_at:'2026-10-07T00:00:00Z',reason:'TEST',processing_by_username:'another admin'}};
    const component=loadTs('src/app/admin/BookingCancellationDialog.tsx',{
      react:{useState:init=>[n++===0?details:init,()=>{}],useEffect:()=>{},useRef:init=>({current:init})},'@/lib/bookingCancellation':labels,
    }).default;
    const html=renderToStaticMarkup(component({bookingId,onClose:()=>{},onSaved:()=>{}}));
    const formatted=labels.formatRefundAmount(amount);
    assert(html.includes('ไม่ส่งข้อความ LINE'));
    assert(html.includes(`คืนมัดจำ ${formatted} บาท`));assert(!html.includes('99,999'));
    if(amount!==100)assert(!html.includes('100 บาท'));
    if(status==='pending')assert(html.includes(`รับงานคืนมัดจำ ${formatted} บาท`));
    if(status==='processing'){
      assert(html.includes('โอนซ้ำ'));
      assert.equal(html.includes('type="file"'),own);
      if(own)assert(html.includes(`บันทึกคืนมัดจำแล้ว ${formatted} บาท`));
    }
    if(status==='refunded'){assert(html.includes('คืนเงินแล้ว ห้ามโอนซ้ำ'));assert(html.includes('ดูหลักฐานคืนเงิน'));}
  }
});

test('cancellation preview returns confirmed deposit, blocks disagreements, and preserves existing refund snapshot',async()=>{
  for(const [deposit,verified,slip,expected] of [[200,true,200,200],[300,false,null,300],[null,true,200.5,200.5],[200,true,100,null],[200,false,100,null],[null,false,200,null],[0,false,null,null]]){
    const h=harness({resolve:call=>({data:call.table==='bookings'?{
      id:bookingId,status:'confirmed',deposit_amount:deposit,slip_verified:verified,slip_verify_amount:slip,
    }:null,error:null})});
    const res=await h.cancellation.GET(new Request(url),ctx);
    assert.equal(res.status,200);assert.equal(res.body.refund_amount,expected);assert.equal(res.body.can_cancel,expected!==null);
    assert.equal(res.body.can_cancel_without_refund,true);assert.equal(res.body.no_refund_blocked_reason,null);
  }
  const h=harness({resolve:call=>({data:call.table==='bookings'?{
    id:bookingId,status:'cancelled',deposit_amount:200,slip_verified:true,slip_verify_amount:200,
  }:{refund_amount:100,refund_status:'pending'},error:null})});
  const res=await h.cancellation.GET(new Request(url),ctx);
  assert.equal(res.body.refund_amount,100);assert.equal(res.body.can_cancel,false);
  assert.equal(res.body.can_cancel_without_refund,false);
});

test('invalid or missing displayed refund amount is rejected before cancellation RPC',async()=>{
  for(const amount of [undefined,null,0,-100,200.001,'200',10000000000]){
    const h=harness();
    assert.equal((await h.cancellation.POST(jsonReq('/cancellation',{reason:'valid reason',refund_mode:'refund',confirmed_deposit:true,expected_refund_amount:amount}),ctx)).status,400);
    assert.equal(h.calls.length,0);
  }
});

test('cached fixed-100 clients cannot claim or record a THB 200 refund',async()=>{
  for(const expected of [undefined,100,200]){
    const h=harness({resolve:()=>({data:{refund_amount:200,refund_status:'processing',processing_by:adminId},error:null})});
    const claim=await h.refund.PATCH(jsonReq('/refund',{action:'claim',expected_refund_amount:expected},'PATCH'),ctx);
    assert.equal(claim.status,expected===200?200:expected===undefined?400:409);
    const form=refundForm();
    if(expected===undefined)form.delete('expected_refund_amount');else form.set('expected_refund_amount',String(expected));
    const result=await h.refund.POST(refundReq(form),ctx);
    assert.equal(result.status,expected===200?200:expected===undefined?400:409);
    assert.equal(h.storage.filter(c=>c[0]==='upload').length,expected===200?1:0);
  }
});

test('customer labels and pre-cancellation button use the actual amount including satang',()=>{
  const labels=loadTs('src/lib/bookingCancellation.ts');
  for(const amount of [100,200,1250.5]){
    const formatted=labels.formatRefundAmount(amount);
    assert.equal(labels.cancellationLabel({refund_status:'pending',refund_amount:amount}),`ยกเลิกแล้ว — รอคืนมัดจำ ${formatted} บาท`);
    assert.equal(labels.cancellationLabel({refund_status:'refunded',refund_amount:amount}),`ยกเลิกแล้ว — คืนมัดจำ ${formatted} บาทแล้ว`);
    let n=0;
    const component=loadTs('src/app/admin/BookingCancellationDialog.tsx',{
      react:{useState:init=>{const i=n++;return [i===0?{booking:{renter_name:'TEST',ref_number:'TEST'},cancellation:null,refund_amount:amount,can_cancel:true,can_cancel_without_refund:true}:i===9?'refund':init,()=>{}];},useEffect:()=>{},useRef:init=>({current:init})},
      '@/lib/bookingCancellation':labels,
    }).default;
    const html=renderToStaticMarkup(component({bookingId,onClose:()=>{},onSaved:()=>{}}));
    assert(html.includes(`ยืนยันยกเลิก — รอคืนมัดจำ ${formatted} บาท`));
    assert(html.includes(`ร้านรับมัดจำ ${formatted} บาท`));
  }
  for(const amount of [null,0,-1,NaN])assert.match(labels.cancellationLabel({refund_amount:amount,refund_status:'refunded'}),/กำลังตรวจสอบ/);
});

test('cancellation requires an explicit valid case and separate no-refund confirmation',async()=>{
  for (const body of [
    {reason:'Valid reason',confirmed_deposit:true,expected_refund_amount:100}, // stale client
    {reason:'Valid reason',refund_mode:'other',confirmed_no_refund:true},
    {reason:'Valid reason',refund_mode:'no_refund'},
    {reason:'Valid reason',refund_mode:'no_refund',confirmed_deposit:true},
    {reason:'Valid reason',refund_mode:'no_refund',confirmed_no_refund:'true'},
    {reason:'x',refund_mode:'no_refund',confirmed_no_refund:true},
    {reason:'x'.repeat(501),refund_mode:'no_refund',confirmed_no_refund:true},
    {reason:'Valid reason',refund_mode:'refund',confirmed_no_refund:true,expected_refund_amount:100},
  ]) {
    const h=harness();
    assert.equal((await h.cancellation.POST(jsonReq('/cancellation',body),ctx)).status,400);
    assert.equal(h.calls.length,0);assert.equal(h.background.length,0);
  }
});

test('no-refund cancellation has no transfer amount, evidence or LINE and ignores arbitrary admin/amount',async()=>{
  const h=harness();
  const res=await h.cancellation.POST(jsonReq('/cancellation',{
    reason:'  Customer cancelled  ',refund_mode:'no_refund',confirmed_no_refund:true,
    admin_id:'attacker',expected_refund_amount:99999,refund_amount:99999,
  }),ctx);
  assert.equal(res.status,200);
  assert.deepEqual(h.calls[0].args,['admin_cancel_booking',{
    p_booking_id:bookingId,p_admin_id:adminId,p_reason:'Customer cancelled',p_expected_refund_amount:null,p_refund_mode:'no_refund',
  }]);
  assert.equal(h.storage.length,0);assert.equal(h.background.length,1);
  await h.background[0]();
});

test('case-switch conflict is visible and never schedules follow-up writes',async()=>{
  for(const mode of ['refund','no_refund']) {
    const h=harness({result:{error:'CANCELLATION_MODE_LOCKED'}});
    const res=await h.cancellation.POST(jsonReq('/cancellation',{
      reason:'Attempt to change case',refund_mode:mode,confirmed_deposit:true,expected_refund_amount:100,confirmed_no_refund:true,
    }),ctx);
    assert.equal(res.status,409);assert.match(res.body.error,/สลับ/);
    assert.equal(h.background.length,0);assert.equal(h.storage.length,0);
  }
});

test('both cancellation cases block non-confirmed and fulfilled previews',async()=>{
  for (const fields of [{status:'pending'},{status:'rejected'},{status:'confirmed',delivered_at:'2026-10-17'},
    {status:'confirmed',returned_at:'2026-10-17'},{status:'confirmed',files_sent_at:'2026-10-17'}]) {
    const h=harness({resolve:call=>({data:call.table==='bookings'?{id:bookingId,deposit_amount:100,...fields}:null,error:null})});
    const res=await h.cancellation.GET(new Request(url),ctx);
    assert.equal(res.body.can_cancel,false);assert.equal(res.body.can_cancel_without_refund,false);
    assert(res.body.no_refund_blocked_reason);
  }
});

test('no-refund record cannot claim, release, upload evidence or create proof links',async()=>{
  const h=harness({result:{error:'REFUND_NOT_ENTITLED'},resolve:()=>({data:{refund_status:'not_entitled',refund_amount:0},error:null})});
  assert.equal((await h.refund.PATCH(jsonReq('/refund',{action:'claim',expected_refund_amount:100},'PATCH'),ctx)).status,409);
  assert(!h.calls.some(c=>c.kind==='rpc'));
  assert.equal((await h.refund.POST(refundReq(refundForm()),ctx)).status,409);
  assert(!h.calls.some(c=>c.kind==='rpc'));
  assert.equal((await h.refund.GET(new Request(url+'/refund'),ctx)).status,404);
  assert.equal((await h.refund.PATCH(jsonReq('/refund',{action:'release',not_transferred:true},'PATCH'),ctx)).status,409);
  assert.equal(h.storage.length,0);assert.equal(h.background.length,0);
});

function cancellationUi(details, overrides={}) {
  const states={0:details,...overrides};let n=0;
  const component=loadTs('src/app/admin/BookingCancellationDialog.tsx',{
    react:{useState:init=>{const i=n++;if(!Object.hasOwn(states,i))states[i]=init;return [states[i],v=>{states[i]=v;}];},useEffect:()=>{},useRef:init=>({current:init})},
    '@/lib/bookingCancellation':loadTs('src/lib/bookingCancellation.ts'),
  }).default;
  return {states,render:()=>{n=0;return component({bookingId,onClose:()=>{},onSaved:()=>{}});}};
}
function nodes(tree) {
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(!tree || typeof tree!=='object')return [];
  return [tree,...nodes(tree.props?.children)];
}
const cancellableDetails=()=>({booking:{id:bookingId,renter_name:'TEST',ref_number:'TEST',status:'confirmed'},cancellation:null,refund_amount:200,can_cancel:true,can_cancel_without_refund:true});
const confirmButton=tree=>nodes(tree).find(n=>n.type==='button' && typeof n.props.children==='string' && n.props.children.startsWith('ยืนยันยกเลิก'));

test('dialog has no preselected case and resets confirmation whenever case changes before submission',()=>{
  const ui=cancellationUi(cancellableDetails(),{3:'A valid reason',4:true});
  let tree=ui.render();
  const radios=nodes(tree).filter(n=>n.type==='input'&&n.props.type==='radio');
  assert.equal(radios.length,2);assert(radios.every(n=>n.props.checked===false));
  assert.equal(confirmButton(tree).props.disabled,true);
  radios.find(n=>n.props.value==='no_refund').props.onChange();
  assert.equal(ui.states[9],'no_refund');assert.equal(ui.states[4],false);
  tree=ui.render();assert.equal(confirmButton(tree).props.disabled,true);
  nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
  tree=ui.render();assert.equal(confirmButton(tree).props.disabled,false);
  assert.equal(confirmButton(tree).props.children,'ยืนยันยกเลิก — ไม่คืนมัดจำ');
  nodes(tree).find(n=>n.type==='input'&&n.props.value==='refund').props.onChange();
  assert.equal(ui.states[9],'refund');assert.equal(ui.states[4],false);
  assert.equal(confirmButton(ui.render()).props.disabled,true);
});

test('no-refund UI can cancel unknown deposits but still requires reason and acknowledgement',()=>{
  for (const [reason,ack,enabled] of [['',true,false],['A reason',false,false],['A reason',true,true]]) {
    const ui=cancellationUi({...cancellableDetails(),refund_amount:null,can_cancel:false,blocked_reason:'Unknown deposit'},
      {3:reason,4:ack,9:'no_refund'});
    const tree=ui.render();assert.equal(confirmButton(tree).props.disabled,!enabled);
    assert(!nodes(tree).some(n=>n.type==='input'&&n.props.type==='file'));
  }
  const blocked=cancellationUi({...cancellableDetails(),refund_amount:null,can_cancel:false},{3:'A reason',4:true,9:'refund'});
  assert.equal(confirmButton(blocked.render()).props.disabled,true);
});

test('confirmed no-refund history has no case selector or refund controls and uses an unambiguous label',()=>{
  const labels=loadTs('src/lib/bookingCancellation.ts');
  assert.equal(labels.cancellationLabel({refund_status:'not_entitled',refund_amount:0}),'ยกเลิกแล้ว — ไม่คืนมัดจำ');
  assert.match(labels.cancellationLabel({refund_status:'not_entitled',refund_amount:100}),/กำลังตรวจสอบ/);
  const ui=cancellationUi({...cancellableDetails(),can_cancel:false,can_cancel_without_refund:false,
    cancellation:{refund_status:'not_entitled',refund_amount:0,reason:'TEST REASON',cancelled_by_username:'ADMIN TEST',cancelled_at:'2026-10-17T00:00:00Z'}
  });
  const tree=ui.render(),html=renderToStaticMarkup(tree);
  assert(html.includes('ยกเลิกแล้ว — ไม่คืนมัดจำ'));assert(html.includes('TEST REASON'));assert(html.includes('ADMIN TEST'));
  assert(html.includes('ไม่สามารถสลับเป็นอีกกรณีได้'));assert(html.includes('ไม่ส่งข้อความ LINE'));
  assert(!nodes(tree).some(n=>n.type==='input'));assert.equal(confirmButton(tree),undefined);
  for(const text of ['รับงานคืนมัดจำ','บันทึกคืนมัดจำแล้ว','ดูหลักฐานคืนเงิน'])assert(!html.includes(text));
});

test('actual admin listing excludes cancelled bookings from fulfillment but keeps cancellation history',async()=>{
  const rows=[{id:bookingId,status:'cancelled'}, {id:'active-booking',status:'confirmed'}];
  const {client,calls}=mockClient(call=>{
    if(call.table==='booking_cancellations')return {data:[{booking_id:bookingId,refund_status:'not_entitled',refund_amount:0}],error:null};
    assert.equal(call.table,'bookings');
    const status=call.operations.find(x=>x[0]==='eq'&&x[1]==='status')?.[2];
    return {data:rows.filter(row=>!status||row.status===status),error:null};
  });
  const api=loadTs('src/app/api/admin/bookings/route.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},
    '@/lib/adminAuth':{requireAdmin:async()=>({ok:true})},'@/lib/apiLog':noLog,
    '@/lib/supabaseRetry':{retryRead:async(_scope,fn)=>await fn()},'@/lib/bookingCancellationServer':harness().server,
  });
  const active=await api.GET(new Request('https://test.invalid/api/admin/bookings?status=confirmed'));
  assert.deepEqual(active.body.bookings.map(b=>b.id),['active-booking']);
  assert(!calls.some(c=>c.table==='booking_cancellations'));
  const history=await api.GET(new Request('https://test.invalid/api/admin/bookings?status=cancelled'));
  assert.equal(history.body.bookings.length,1);
  assert.equal(history.body.bookings[0].cancellation.refund_status,'not_entitled');
});

test('stale fulfillment requests cannot update a cancelled booking or its notes',async()=>{
  const {client,calls}=mockClient(call=>{
    assert.equal(call.table,'bookings');
    assert(call.operations.some(x=>x[0]==='eq'&&x[1]==='status'&&x[2]==='confirmed'));
    return {data:[],count:0,error:null}; // Already cancelled: no eligible rows.
  });
  const api=loadTs('src/app/api/admin/bookings/fulfillment/route.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},
    '@/lib/adminAuth':{requireAdmin:async()=>({ok:true,payload:{username:'TEST'}})},'@/lib/apiLog':noLog,
    '@/lib/adminAudit':{logAdminAction:async()=>{throw new Error('No fulfillment action was performed');}},
  });
  for (const body of [{booking_id:bookingId,note:'Stale note'},
    ...['delivered','returned','files_sent'].map(step=>({booking_ids:[bookingId],step,done:true}))]) {
    assert.equal((await api.POST(jsonReq('/fulfillment',body))).status,404);
  }
  assert.equal(calls.length,4);
});
