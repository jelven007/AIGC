import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service',
  VIDEO_WORKER_SECRET: 'isolated-worker', RELEASE_SOURCE_SHA256: 'a'.repeat(64) })[name] }, serve() {} };
let failCredits = false, forbiddenCredits = false, failImage = false, claims = 0, probes = 0;
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
    if (name === 'worker_capabilities') {
      probes++;
      const missing = [failCredits || forbiddenCredits ? 'account_credits_schema_ready' : null,
        failImage ? 'image_editing_schema_ready' : null].filter(Boolean);
      return { data: { ready: !missing.length, version: 24, render_version: 4, edit_version: 2,
        required_migration: '00068', missing }, error: null };
    }
    if (name === 'claim_production_job') { claims++; return { data: null }; }
    if (name === 'account_credits_schema_ready') return { data: !forbiddenCredits, error: failCredits ? new Error('missing') : null };
    if (name === 'image_editing_schema_ready') return { data: !failImage, error: null };
    return { data: true, error: null };
  },
});
const { handleProductionWorker } = await loadEdge('supabase/functions/production-worker/index.ts', 'account-credit-probe');
const request = () => new Request('https://db.example/functions/v1/production-worker', { method: 'POST',
  headers: { Authorization: 'Bearer isolated-worker', 'Content-Type': 'application/json' }, body: '{"action":"probe"}' });
let response = await handleProductionWorker(request());
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { ready: true, version: 24, render_version: 4, edit_version: 2, required_migration: '00068',
  missing: [], source_sha256: 'a'.repeat(64) });
failCredits = true;
assert.equal((await handleProductionWorker(request())).status, 503);
forbiddenCredits = false; failImage = true;
assert.equal((await handleProductionWorker(request())).status, 503);
failCredits = false; forbiddenCredits = true;
assert.equal((await handleProductionWorker(request())).status, 503);
assert.equal(claims, 0);
assert.equal(probes, 4);
console.log('PASS probe24/00068；完整能力缺失503并报告原因，每次一个RPC、不领取任务');
