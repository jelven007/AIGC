import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service',
  VIDEO_WORKER_SECRET: 'isolated-worker' })[name] }, serve() {} };
let failCredits = false, forbiddenCredits = false, claims = 0;
globalThis.__createClient = () => ({
  from(table) {
    return {
      values: [],
      select() { return this; }, limit() { return this; }, eq() { return this; },
      in(_column, values) { this.values = values; return this; },
      async maybeSingle() { return { data: { cost: 10 }, error: null }; },
      then(resolve) { resolve({ data: table === 'credit_costs' ? this.values.map(action => ({ action, cost: 10 })) : [], error: null }); },
    };
  },
  async rpc(name) {
    if (name === 'claim_production_job') { claims++; return { data: null }; }
    if (name === 'account_credits_schema_ready') return { data: !forbiddenCredits, error: failCredits ? new Error('missing') : null };
    return { data: true, error: null };
  },
});
const { handleProductionWorker } = await loadEdge('supabase/functions/production-worker/index.ts', 'account-credit-probe');
const request = () => new Request('https://db.example/functions/v1/production-worker', { method: 'POST',
  headers: { Authorization: 'Bearer isolated-worker', 'Content-Type': 'application/json' }, body: '{"action":"probe"}' });
let response = await handleProductionWorker(request());
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { ready: true, version: 21, render_version: 4, edit_version: 2, required_migration: '00061' });
failCredits = true;
assert.equal((await handleProductionWorker(request())).status, 503);
failCredits = false; forbiddenCredits = true;
assert.equal((await handleProductionWorker(request())).status, 503);
assert.equal(claims, 0);
console.log('PASS probe21/00061；缺权威积分RPC或权限口径未就绪时503，预检不领取任务');
