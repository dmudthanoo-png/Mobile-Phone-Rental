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
test('cancellation never trusts a client amount/admin ID and never calls LINE',async()=>{
  const h=harness();const res=await h.cancellation.POST(jsonReq('/cancellation',{reason:'Verified cancellation',confirmed_deposit:true,refund_amount:99999,admin_id:'attacker'}),ctx);
  assert.equal(res.status,200);
  assert.deepEqual(h.calls[0].args,['admin_cancel_booking',{p_booking_id:bookingId,p_admin_id:adminId,p_reason:'Verified cancellation'}]);
  assert.equal(h.background.length,1); // only the optional Sheets copy
  await h.background[0](); // no webhook configured -> no external side effects
  for(const file of ['cancellation','refund'])assert(!readFileSync(new URL(`../src/app/api/admin/bookings/[id]/${file}/route.ts`,import.meta.url),'utf8').includes('lineMessaging'));
});
test('missing migration produces a clear setup error, never a success',async()=>{
  const h=harness({error:{code:'PGRST202',message:'function missing'}});
  const res=await h.cancellation.POST(jsonReq('/cancellation',{reason:'valid reason',confirmed_deposit:true}),ctx);
  assert.equal(res.status,503);assert.match(res.body.error,/add_booking_cancellation.sql/);assert.equal(h.background.length,0);
});
test('NULL RPC responses and business conflicts are not reported as success',async()=>{
  for(const [result,status] of [[null,503],[{error:'DEPOSIT_NOT_100'},409],[{error:'NOT_FOUND'},404]]){
    const h=harness({result});assert.equal((await h.cancellation.POST(jsonReq('/cancellation',{reason:'valid reason',confirmed_deposit:true}),ctx)).status,status);
  }
});
test('release requires explicit acknowledgement that no money was transferred',async()=>{
  const h=harness();assert.equal((await h.refund.PATCH(jsonReq('/refund',{action:'release'},'PATCH'),ctx)).status,400);
  assert.equal(h.calls.length,0);
  assert.equal((await h.refund.PATCH(jsonReq('/refund',{action:'release',not_transferred:true},'PATCH'),ctx)).status,200);
});
function refundForm(bytes=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])){
  const form=new FormData();form.set('proof',new File([bytes],'refund.png',{type:'image/png'}));form.set('reference','BANK-TEST');form.set('transferred','true');return form;
}
const refundReq=form=>new Request(url+'/refund',{method:'POST',body:form});
const ownClaim=()=>({data:{refund_status:'processing',processing_by:adminId},error:null});
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

test('customer history remains owner-scoped, includes cancelled bookings, and excludes private refund data',async()=>{
  const appUser=id=>id==='user'?userId:bookingId;
  const {client,calls}=mockClient(call=>call.table==='bookings'
    ?{data:[{id:bookingId,status:'cancelled',total_amount:1000}],error:null}
    :{data:[{booking_id:bookingId,refund_status:'pending',refund_amount:100,cancelled_at:'2026-10-07T00:00:00Z',refunded_at:null}],error:null});
  const shared=harness().server;
  const secret='test-only-secret';process.env.APP_SESSION_SECRET=secret;
  const h=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({line_sub:'TEST',app_user_id:appUser('user'),exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const token=`${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;
  const api=loadTs('src/app/api/bookings/my-v2/route.ts',{
    'next/server':{NextResponse:response},'@supabase/supabase-js':{createClient:()=>client},'@/lib/apiLog':noLog,'@/lib/bookingCancellationServer':shared,
  });
  const res=await api.GET({cookies:{get:()=>({value:token})}});
  assert.equal(res.status,200);assert.equal(res.body.bookings[0].cancellation.refund_amount,100);
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

test('refund UI presents distinct pending, claimed-by-another and completed states with no LINE action',()=>{
  const labels=loadTs('src/lib/bookingCancellation.ts');
  for(const status of ['pending','processing','refunded']){
    let n=0;
    const details={booking:{id:bookingId,ref_number:'TEST',renter_name:'TEST',status:'cancelled'},can_cancel:false,can_manage_refund:false,
      cancellation:{booking_id:bookingId,refund_amount:100,refund_status:status,cancelled_at:'2026-10-07T00:00:00Z',reason:'TEST',processing_by_username:'another admin'}};
    const component=loadTs('src/app/admin/BookingCancellationDialog.tsx',{
      react:{useState:init=>[n++===0?details:init,()=>{}],useEffect:()=>{},useRef:init=>({current:init})},'@/lib/bookingCancellation':labels,
    }).default;
    const html=renderToStaticMarkup(component({bookingId,onClose:()=>{},onSaved:()=>{}}));
    assert(html.includes('ไม่ส่งข้อความ LINE'));
    if(status==='pending')assert(html.includes('รับงานคืนมัดจำ 100 บาท'));
    if(status==='processing'){assert(html.includes('ห้ามโอนซ้ำ'));assert(!html.includes('type="file"'));}
    if(status==='refunded'){assert(html.includes('คืนเงินแล้ว ห้ามโอนซ้ำ'));assert(html.includes('ดูหลักฐานคืนเงิน'));}
  }
});
