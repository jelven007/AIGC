import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const requestKey = '33333333-3333-4333-8333-333333333333';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: '1'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
let user, existing, version, transactionError, queryError, calls, filters, scope, consumed;
const snapshot = { id: requestKey, items: [{ product_name: '商品', status: 'pending' }], reserved_credits: 10 };
const db = {
  auth: { getUser: async () => ({ data: { user } }), admin: { getUserById: async () => ({ data: { user } }) } },
  from(table) {
    return {
      select() { return this; }, eq(key, value) { filters.push([table, key, value]); return this; },
      in() { return this; }, order() { return this; }, limit() { return this; },
      single: async () => ({ data: table === 'credit_costs' ? { cost: 10 } : version }),
      maybeSingle: async () => ({ data: table === 'batch_jobs' ? existing : { enabled: true, current_version_id: requestKey },
        error: queryError ? { message: 'database outage' } : null }),
      then(resolve) { resolve({ data: table === 'products' ? [{ id: productId, name: '商品', selling_points: ['保温'], price: 5 }] : [{ id: requestKey }] }); },
    };
  },
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'consume_api_key') { scope = args.p_scope; return { data: consumed }; }
    return { data: snapshot, error: transactionError };
  },
};
globalThis.__createClient = () => db;
const { encryptKey } = await loadEdge('supabase/functions/_shared/model-registry.ts', 'batch-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'batch-catalog');
const { validateBatchRequest, prepareBatchItems } = await loadEdge('supabase/functions/_shared/batch-video.ts', 'batch-input');
const { handleBatchVideoJobs } = await loadEdge('supabase/functions/batch-video-jobs/index.ts', 'batch-handler');
const valid = { action: 'create', request_key: requestKey, name: '商品视频', provider: 'Wan3', product_ids: [productId],
  settings: { duration: 5, ratio: '9:16', resolution: '720P', style: '产品特写', language: 'zh' },
  overrides: { [productId]: { prompt: '显示保温杯外观' } }, expected_unit_cost: 10, budget: 10 };
const request = (body, token = 'user') => new Request('https://db.example/functions/v1/batch-video-jobs', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function reset() {
  user = { id: uid }; existing = null; transactionError = null; queryError = false; calls = []; filters = [];
  consumed = { user_id: uid, key_id: 'key' };
}
reset();
version = { id: requestKey, slot: 'video.Wan3', settings: { ...defaultSettings('video.Wan3'),
  endpoint: 'https://provider.example/tasks', query_endpoint: 'https://provider.example/tasks' },
  key_ciphertext: await encryptKey('video.Wan3', 'private-model-key') };
for (const changes of [{ product_ids: [] }, { product_ids: [productId, productId] }, { budget: 0 },
  { overrides: { foreign: { prompt: 'fake' } } }, { settings: { ...valid.settings, duration: 60 } }]) {
  assert.throws(() => validateBatchRequest({ ...valid, ...changes }));
}
const items = await prepareBatchItems(db, uid, validateBatchRequest(valid));
assert.match(items[0].input.prompt, /已登记卖点：保温/);
assert.match(items[0].input.prompt, /显示保温杯外观/);
assert.equal(items[0].input.title, '商品 · 产品特写');
console.log('PASS 批次参数、重复商品/预算/独立要求校验与商品事实快照');
reset();
const created = await handleBatchVideoJobs(request({ ...valid, user_id: 'forged', cost: 0 }));
assert.equal(created.status, 202);
assert.equal(calls[0].name, 'create_batch_video_jobs');
assert.equal(calls[0].args.p_user_id, uid);
assert.equal(calls[0].args.p_expected_unit_cost, 10);
assert.equal(calls[0].args.p_config_version, requestKey);
assert.equal(calls[0].args.p_items.length, 1);
assert.ok(filters.some(([table, key, value]) => table === 'products' && key === 'user_id' && value === uid));
console.log('PASS 创建使用认证账户与已验证模型版本，不信任用户传入扣费金额');
reset(); existing = { id: requestKey };
await handleBatchVideoJobs(request(valid));
assert.equal(calls[0].args.p_items, null);
assert.equal(calls[0].args.p_config_version, null);
assert.deepEqual(calls[0].args.p_request, validateBatchRequest(valid));
assert.equal(filters.some(([table]) => table === 'products' || table === 'model_configs'), false);
for (const [text, status] of [['积分不足', 402], ['同一请求标识不能用于不同批次', 409],
  ['积分价格已更新', 409], ['数据库故障', 503]]) {
  reset(); existing = { id: requestKey }; transactionError = { message: text };
  assert.equal((await handleBatchVideoJobs(request(valid))).status, status);
}
console.log('PASS 创建响应丢失可复用原请求，商品/配置变化不阻断恢复，拒绝时返回真实状态');
reset(); queryError = true;
assert.equal((await handleBatchVideoJobs(request(valid))).status, 503);
assert.equal(calls.length, 0);
reset();
assert.equal((await handleBatchVideoJobs(request({ action: 'query', batch_id: requestKey }))).status, 404);
assert.equal(calls.length, 0);
assert.ok(filters.some(([table, key, value]) => table === 'batch_jobs' && key === 'user_id' && value === uid));
reset(); user = null;
assert.equal((await handleBatchVideoJobs(request(valid))).status, 401);
console.log('PASS 读取故障不新建任务、跨用户查询和未登录拒绝');
reset();
const token = `ak_live_${'a'.repeat(64)}`;
assert.equal((await handleBatchVideoJobs(request({ action: 'quote' }, token))).status, 200);
assert.equal(scope, 'video:read');
await handleBatchVideoJobs(request({ action: 'cancel', batch_id: requestKey }, token));
assert.equal(scope, 'video:create');
assert.equal(calls.at(-1).args.p_user_id, uid);
reset(); transactionError = { message: 'refund database outage' };
assert.equal((await handleBatchVideoJobs(request({ action: 'cancel', batch_id: requestKey }))).status, 503);
assert.equal((await handleBatchVideoJobs(request({ action: 'forge_completed', batch_id: requestKey }))).status, 400);
console.log('PASS API Key 独立权限与取消故障不冒报成功，不接受伪造终态');
