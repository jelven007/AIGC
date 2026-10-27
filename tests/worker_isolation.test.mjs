import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service', VIDEO_WORKER_SECRET: 'isolated-worker' })[name] }, serve() {} };
let calls = [], supplied = false, failRelease = false;
const db = {
  from() { throw new Error('unexpected table read'); },
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'worker_due_lanes') return { data: ['image'] };
    if (name === 'claim_worker_dispatch') {
      if (supplied) return { data: null };
      supplied = true;
      return { data: { lane: 'image', lease_token: 'dispatch-token' } };
    }
    if (name === 'finish_worker_dispatch') return { data: true, error: failRelease ? new Error('outage') : null };
    if (name === 'claim_production_job') return { data: null };
    if (name === 'claim_worker_maintenance') return { data: { task: 'prune_intelligence_data', lease_token: 'maintenance-token' } };
    if (name === 'prune_intelligence_data') return { error: new Error('retention unavailable') };
    if (name === 'finish_worker_maintenance') return { data: true };
    if (name === 'worker_runtime_ready') return { data: true };
    throw new Error(`unexpected ${name}`);
  },
};
globalThis.__createClient = () => db;
globalThis.fetch = () => { throw new Error('empty queue must never call supplier'); };
const { handleProductionWorker } = await loadEdge('supabase/functions/production-worker/index.ts', 'worker-isolation');
const request = action => new Request('https://db.example/functions/v1/production-worker', {
  method: 'POST', headers: { Authorization: 'Bearer isolated-worker', 'Content-Type': 'application/json' },
  body: JSON.stringify({ action }),
});
let response = await handleProductionWorker(request('run'));
assert.equal(response.status, 200);
assert.equal((await response.json()).processed, 0);
assert.equal(calls.some(call => call.name.startsWith('prune_')), false);
assert.equal(calls.filter(call => call.name === 'claim_production_job').length, 1);
assert.equal(calls.find(call => call.name === 'finish_worker_dispatch').args.p_lease, 'dispatch-token');
console.log('PASS empty production dispatch excludes maintenance and releases original fenced quota');

calls = [];
response = await handleProductionWorker(request('maintenance'));
assert.equal(response.status, 200);
assert.equal((await response.json()).errors, 1);
assert.equal(calls.at(-1).name, 'finish_worker_maintenance');
assert.equal(calls.at(-1).args.p_success, false);
supplied = false; calls = [];
assert.equal((await handleProductionWorker(request('run'))).status, 200);
assert.equal(calls.some(call => call.name.startsWith('prune_')), false);
console.log('PASS retention failure is recorded independently and production still dispatches');

calls = [];
assert.equal((await handleProductionWorker(request('alive'))).status, 200);
assert.equal(calls.length, 0);
assert.equal((await handleProductionWorker(request('ready'))).status, 200);
assert.deepEqual(calls.map(call => call.name), ['worker_runtime_ready']);
console.log('PASS alive costs zero database calls and runtime readiness costs one');

supplied = false; failRelease = true;
assert.equal((await handleProductionWorker(request('run'))).status, 503);
console.log('PASS failed quota acknowledgement stays visible for lease recovery');
