import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEdge } from './edge-loader.mjs';

const uid = crypto.randomUUID();
let allowed = true, rateError = false, signedIn = true, writes = 0;
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user: signedIn ? { id: uid } : null } }) },
  rpc: async name => {
    if (name === 'upsert_rate_limit') return rateError ? { error: { message: 'rate store offline' } } : { data: allowed };
    writes++;
    return { data: { user_id: uid, daily_credit_budget: 25 } };
  },
});
const { handleOperations } = await loadEdge('supabase/functions/operations/index.ts', 'operations-admission');
const request = () => new Request('https://db.example/functions/v1/operations', {
  method: 'POST', headers: { authorization: 'Bearer session' }, body: JSON.stringify({
    action: 'mutate', operation: 'budget', request_key: crypto.randomUUID(),
    payload: { user_id: uid, expected: 0, amount: 25 },
  }),
});
for (const [name, expectedStatus, setup] of [
  ['限流未受理', 429, () => { signedIn = true; allowed = false; rateError = false; }],
  ['限流服务故障且尚未受理', 503, () => { signedIn = true; allowed = true; rateError = true; }],
  ['会话失效且尚未受理', 401, () => { signedIn = false; rateError = false; }],
]) test(`${name}应明确rejected而非锁定未知申请`, async () => {
  setup(); writes = 0;
  const response = await handleOperations(request());
  assert.equal(response.status, expectedStatus);
  assert.equal((await response.json()).outcome, 'rejected');
  assert.equal(writes, 0);
});
