import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, mockClient } from './load-typescript.mjs';

const bookingId = '00000000-0000-4000-8000-000000000001';
let previousFetch;
let requests;
before(() => {
  // Dummy values: every external dependency is replaced, no production calls.
  process.env.SLIPOK_API_URL = 'https://test.invalid/slipok';
  process.env.SLIPOK_API_KEY = 'test-only';
  process.env.SLIPOK_RECEIVER_MATCH = 'testshop';
  previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://test.invalid/slipok');
    assert.equal(init.body.get('amount'), '100');
    requests++;
    return Response.json({ success: true, data: { amount: 100, transRef: 'ORIGINAL-REF', receiver: { name: 'testshop' } } });
  };
});
after(() => { globalThis.fetch = previousFetch; });

function harness(status, updateResult = { error: null, count: 1 }) {
  requests = 0;
  let downloads = 0;
  const { client, calls } = mockClient(call => {
    if (call.table === 'app_settings') return { data: { slipok_enabled: true }, error: null };
    if (call.operations.some(op => op[0] === 'update')) return updateResult;
    if (call.operations.some(op => op[0] === 'eq' && op[1] === 'slip_verify_ref')) return { data: null, error: null };
    return { data: { id: bookingId, status, slip_url: 'original-slip', qty: 1, deposit_amount: 100, phones: { deposit: 999 } }, error: null };
  });
  const { verifySlipForBooking } = loadTs('src/lib/slipOk.ts', {
    '@supabase/supabase-js': { createClient: () => client },
    '@/lib/slipStorage': { downloadSlipBuffer: async () => { downloads++; return { buffer: new Uint8Array([1, 2, 3]), contentType: 'image/png' }; } },
  });
  return { verify: () => verifySlipForBooking(bookingId), calls, downloads: () => downloads };
}
const writes = h => h.calls.filter(c => c.operations.some(op => op[0] === 'update'));

test('cancelled bookings never download or recheck the old payment slip', async () => {
  const h = harness('cancelled');
  const result = await h.verify();
  assert.equal(result.ok, false); assert.match(result.error, /ยกเลิก/);
  assert.equal(h.downloads(), 0); assert.equal(requests, 0); assert.equal(writes(h).length, 0);
});

test('normal SlipOK verification still succeeds for active and legacy NULL-status bookings', async () => {
  for (const status of ['pending', 'confirmed', null]) {
    const h = harness(status); const result = await h.verify();
    assert.equal(result.ok, true); assert.equal(result.verified, true); assert.equal(requests, 1);
    const write = writes(h)[0];
    assert(write.operations.some(op => op[0] === 'or' && op[1] === 'status.is.null,status.neq.cancelled'));
    assert.equal(write.operations.find(op => op[0] === 'update')[1].slip_verify_ref, 'ORIGINAL-REF');
  }
});

test('cancellation during SlipOK verification discards the late result', async () => {
  const h = harness('confirmed', { error: null, count: 0 });
  const result = await h.verify();
  assert.equal(result.ok, true); assert.equal(result.verified, false); assert.match(result.message, /สถานะการจองเปลี่ยน/);
  assert.equal(writes(h).length, 1);
});

test('duplicate-payment fallback also guards against overwriting a cancelled booking', async () => {
  const h = harness('confirmed', { error: { code: '23505' }, count: 0 });
  const result = await h.verify();
  assert.equal(result.ok, true); assert.equal(result.verified, false); assert.equal(writes(h).length, 2);
  for (const write of writes(h)) assert(write.operations.some(op => op[0] === 'or' && op[1] === 'status.is.null,status.neq.cancelled'));
});
