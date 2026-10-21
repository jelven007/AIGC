import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { loadEdge } from './edge-loader.mjs';

globalThis.crypto ??= webcrypto;
let handler;
let state;
let user = '11111111-1111-4111-8111-111111111111';
const chargeId = '22222222-2222-4222-8222-222222222222';
const admin = {
  auth: { getUser: async () => ({ data: { user: { id: user } } }) },
  from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, gte() { return this; },
      insert() { return this; }, upsert() { return this; },
      async maybeSingle() {
        if (table === 'credit_costs') return { data: { cost: 5 } };
        if (table === 'user_plans') return { data: { credits_total: 20, credits_used: 0, daily_credit_budget: 0 } };
        if (table === 'llm_cache') return { data: state.cached ? {
          response: { selling_points: ['cached'] }, expires_at: new Date(Date.now() + 60000).toISOString(),
        } : null };
        return { data: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
    };
    return query;
  },
  async rpc(name, parameters) {
    state.calls.push({ name, parameters });
    if (name === 'upsert_rate_limit') return { data: state.allowed };
    if (name === 'deduct_credits') return { data: { ok: true, charge_id: chargeId, credits_left: 15 } };
    if (name === 'refund_credit_charge') return { data: { ok: true, refunded: 5, balance: 20 } };
    return { data: 0 };
  },
};
globalThis.__createClient = () => admin;
globalThis.Deno = { env: { get: () => 'test' }, serve: callback => { handler = callback; } };
await loadEdge('supabase/functions/ai-assistant/index.ts', 'ai-billing');

async function request(action, overrides = {}) {
  const { body = {}, ...options } = overrides;
  state = { calls: [], allowed: true, cached: false, ...options };
  return handler(new Request('https://test.invalid/ai-assistant', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  }));
}
function calls(name) { return state.calls.filter(call => call.name === name); }

let response = await request('generate_selling_points', { cached: true });
assert.equal(response.status, 200);
assert.equal(calls('deduct_credits').length, 0);
assert.deepEqual((await response.json()).data.selling_points, ['cached']);
console.log('PASS 缓存命中不扣积分');

response = await request('generate_selling_points', { allowed: false });
assert.equal(response.status, 429);
assert.equal(calls('deduct_credits').length, 0);
console.log('PASS 限流拒绝不扣积分');

response = await request('extract_url_selling_points');
assert.equal(response.status, 500); // 缺少 URL：在实际 action 失败后补偿原扣费。
assert.equal(calls('deduct_credits').length, 1);
assert.equal(calls('refund_credit_charge').length, 1);
assert.equal(calls('refund_credit_charge')[0].parameters.p_charge_id, chargeId);
assert.equal(calls('refund_credit_charge')[0].parameters.p_user_id, user);
console.log('PASS AI 请求失败按原流水补偿');

response = await request('refund_generation_credits');
assert.equal(response.status, 409);
assert.equal(calls('refund_credits').length + calls('refund_credit_charge').length, 0);
console.log('PASS 客户端无法凭金额自助退款');

response = await request('generate_video');
assert.equal(response.status, 503);
assert.equal(calls('deduct_credits').length, 0);
console.log('PASS 停用的旧视频处理器不会扣费');

response = await request('generate_selling_points', { cached: true, body: { product: { name: 'A' } } });
const keyA = calls('record_model_call')[0].parameters.p_cache_key;
response = await request('generate_selling_points', { cached: true, body: { product: { name: 'B' } } });
const keyB = calls('record_model_call')[0].parameters.p_cache_key;
assert.notEqual(keyA, keyB);
user = '33333333-3333-4333-8333-333333333333';
response = await request('generate_selling_points', { cached: true, body: { product: { name: 'A' } } });
assert.notEqual(calls('record_model_call')[0].parameters.p_cache_key, keyA);
console.log('PASS 缓存按用户隔离且保留嵌套请求参数');
console.log('6 tests passed');
