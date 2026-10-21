import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
let granted = new Set(), consumed = [], reads = [], rpcs = [], ownerReads = [], user = { id: uid };
const db = {
  auth: { getUser: async () => ({ data: { user } }), admin: { getUserById: async () => ({ data: { user } }) } },
  from(table) {
    const filters = {};
    const builder = {
      select() { reads.push(table); return this; }, eq(key, value) { filters[key] = value; return this; },
      order() { return this; }, limit() { return this; }, in() { return this; },
      maybeSingle: async () => { ownerReads.push({ table, filters }); return { data: null }; },
      then(resolve) {
        ownerReads.push({ table, filters });
        resolve({ data: table === 'credit_costs' ? [
          { action: 'generate_knowledge_index', cost: 2 }, { action: 'generate_knowledge_search', cost: 1 },
        ] : [] });
      },
    };
    return builder;
  },
  rpc: async (name, args) => {
    rpcs.push({ name, args });
    if (name === 'consume_api_key') {
      consumed.push(args.p_scope);
      return { data: granted.has(args.p_scope) ? { user_id: uid, key_id: 'key' } : { error: 'scope_denied', status: 403 } };
    }
    if (name === 'upsert_rate_limit') return { data: true };
    if (['read_knowledge_catalog', 'read_intelligence_catalog'].includes(name)) return { data: [] };
    if (name === 'create_knowledge_job') return { error: { message: '同一请求标识不能用于不同任务' } };
    if (name === 'cancel_platform_publish') return { error: { message: '已提交不可取消' } };
    throw new Error(name);
  },
};
globalThis.__createClient = () => db;
const permissions = await loadEdge('supabase/functions/_shared/api-scopes.ts', 'mcp-scopes');
const { handleKnowledge } = await loadEdge('supabase/functions/knowledge-base/index.ts', 'mcp-scope-knowledge');
const { handleIntelligence } = await loadEdge('supabase/functions/market-intelligence/index.ts', 'mcp-scope-intelligence');
const { handleProductManagement } = await loadEdge('supabase/functions/product-management/index.ts', 'mcp-scope-products');
const { handlePlatformPublish } = await loadEdge('supabase/functions/platform-publish/index.ts', 'mcp-scope-publish');
const { handlePlatformAccounts } = await loadEdge('supabase/functions/platform-accounts/index.ts', 'mcp-scope-accounts');
const { handleApiKeys } = await loadEdge('supabase/functions/api-keys/index.ts', 'mcp-scope-keys');
const { handleProductionJobs } = await loadEdge('supabase/functions/production-jobs/index.ts', 'mcp-scope-production');
const key = `ak_live_${'b'.repeat(64)}`;
const request = body => new Request('https://db.example/functions/v1/business', {
  method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
});
const actions = [
  [handleKnowledge, ['catalog', 'jobs', 'context'], 'knowledge:read'],
  [handleKnowledge, ['create'], 'knowledge:write'],
  [handleIntelligence, ['catalog'], 'intelligence:read'],
  [handleIntelligence, ['save_target', 'collect', 'schedule', 'delete', 'import_product'], 'intelligence:write'],
  [handleProductManagement, ['list', 'imports', 'translations'], 'products:read'],
  [handleProductManagement, ['extract', 'translate', 'save', 'delete'], 'products:write'],
  [handlePlatformPublish, ['create', 'create_group', 'cancel'], 'publish:create'],
  [handlePlatformPublish, ['query', 'query_group', 'list'], 'publish:read'],
  [handlePlatformPublish, ['metrics'], 'metrics:read'],
  [handlePlatformPublish, ['sync'], 'metrics:sync'],
  [handlePlatformAccounts, ['list', 'creator'], 'publish:read'],
];
assert.equal(new Set(permissions.API_SCOPES).size, 18);
for (const [handle, cases, scope] of actions) {
  for (const action of cases) {
    consumed = []; reads = []; rpcs = [];
    const response = await handle(request({ action }));
    assert.equal(response.status, 403, `${action} must reject missing scope`);
    assert.deepEqual(consumed, [scope]);
    assert.deepEqual(reads, []);
    assert.deepEqual(rpcs.map(call => call.name), ['consume_api_key']);
  }
}
console.log(`PASS ${actions.reduce((count, [, cases]) => count + cases.length, 0)}种操作缺少权限在读写、模型调用及计费前拒绝`);
granted = new Set(permissions.API_SCOPES);
for (const action of ['authorize', 'disconnect', 'apps', 'save_app', 'unknown']) {
  consumed = []; reads = [];
  assert.equal((await handlePlatformAccounts(request({ action }))).status, 401);
  assert.deepEqual(consumed, []); assert.deepEqual(reads, []);
}
assert.equal((await handleApiKeys(request({ action: 'create' }))).status, 401);
console.log('PASS 拥有全部业务权限的Key仍不能授权/撤销账号、修改应用密钥或签发Key');
ownerReads = []; rpcs = [];
assert.equal((await handleKnowledge(request({ action: 'catalog' }))).status, 200);
assert.equal(rpcs.find(call => call.name === 'read_knowledge_catalog').args.p_user, uid);
assert.equal((await handlePlatformAccounts(request({ action: 'list' }))).status, 200);
assert.equal(ownerReads.find(read => read.table === 'platform_connections').filters.user_id, uid);
assert.equal((await handleProductionJobs(request({ action: 'query', request_key: uid }))).status, 404);
assert.equal(ownerReads.find(read => read.table === 'production_jobs').filters.user_id, uid);
assert.equal((await handlePlatformPublish(request({ action: 'query', request_key: uid }))).status, 200);
assert.equal(ownerReads.find(read => read.table === 'publish_tasks').filters.user_id, uid);
console.log('PASS 知识RPC、平台账号、任务与发布查询强制当前Key所属用户');
reads = [];
const priorRead = db.from;
db.from = table => {
  const builder = priorRead(table);
  if (table === 'production_jobs') builder.maybeSingle = async () => ({ data: { id: uid } });
  return builder;
};
assert.equal((await handleKnowledge(request({ action: 'create', kind: 'knowledge_search', request_key: uid,
  input: { query: '真实资料', confirmed_credit_cost: 1 } }))).status, 409);
assert.equal((await handlePlatformPublish(request({ action: 'cancel', task_id: uid }))).status, 409);
assert.equal((await handleKnowledge(request({ action: 'create', kind: 'knowledge_search', input: { query: '真实资料' } }))).status, 400);
assert.equal((await handleIntelligence(request({ action: 'collect', target_id: uid, request_key: uid }))).status, 400);
assert.equal((await handleIntelligence(request({ action: 'schedule', target_id: uid, request_key: uid,
  runs: 31, budget: 1, confirmed_credit_cost: 1 }))).status, 400);
console.log('PASS 已授权调用仍验证幂等冲突、取消状态、知识/采集价格和监控次数');
