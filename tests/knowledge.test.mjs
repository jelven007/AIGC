import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, resolveDns: async () => ['8.8.8.8'], serve() {} };
let selected = {}, cipher, textCipher, modelEnabled = false, claimed = null, resultError = false, user = { id: '11111111-1111-4111-8111-111111111111' };
const version = '22222222-2222-4222-8222-222222222222', key = '33333333-3333-4333-8333-333333333333';
let calls = [], fetches = [], responseBody = { data: [{ index: 1, embedding: [0, 1, 0] }, { index: 0, embedding: [1, 0, 0] }] };
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    selected = {};
    return {
      select() { return this; }, eq(k, v) { selected[k] = v; return this; },
      maybeSingle: async () => table === 'knowledge_entries' ? { data: { content_hash: 'a'.repeat(64) } }
        : table === 'model_configs' ? { data: { current_version_id: version, enabled: modelEnabled } } : { data: null },
      single: async () => ({ data: { id: version, slot: selected.slot, settings: { ...defaults(selected.slot), endpoint: 'https://embed.example/v1/embeddings', model: 'test-model' }, key_ciphertext: selected.slot === 'text.primary' ? textCipher : cipher } }),
    };
  },
  rpc: async (name, params) => {
    calls.push({ name, params });
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'begin_model_attempt') return { data: params.p_attempt };
    if (name === 'finish_model_attempt') return { data: true };
    if (name === 'claim_production_job') return { data: claimed ? structuredClone(claimed) : null };
    if (name === 'search_knowledge_vectors') return { data: [] };
    if (name === 'read_knowledge_context') return selected.rejectContext ? { error: {} }
      : { data: { job_id: key, version_id: version, sources: [{ entry_id: key, title: '真实资料', content: '温和洁面参考', content_hash: 'a'.repeat(64), similarity: 1 }] } };
    if (name === 'update_production_job') {
      if (params.p_event === 'checkpoint') { claimed.evidence = params.p_data; claimed.phase = 'accepted'; }
      if (params.p_event === 'completed' && resultError) return { error: {} };
      if (params.p_event === 'unknown') claimed.status = 'unknown';
      return { data: claimed };
    }
    return { data: {} };
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'knowledge-registry');
const { defaultSettings: defaults } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'knowledge-defaults');
const knowledge = await loadEdge('supabase/functions/_shared/knowledge.ts', 'knowledge-module');
const { handleKnowledge } = await loadEdge('supabase/functions/knowledge-base/index.ts', 'knowledge-api');
const { handleTextGeneration } = await loadEdge('supabase/functions/_shared/text-handler.ts', 'knowledge-text');
cipher = await registry.encryptKey('embedding.primary', 'private-embedding-key');
textCipher = await registry.encryptKey('text.primary', 'private-text-key');
globalThis.fetch = async (url, init) => {
  fetches.push({ url, init });
  return Response.json(responseBody);
};
assert.throws(() => knowledge.knowledgeInput('knowledge_search', { query: '', confirmed_credit_cost: 1 }));
assert.throws(() => knowledge.knowledgeInput('knowledge_index', { entry_id: key, content_hash: 'a'.repeat(64) }));
const unicode = '😀'.repeat(5000), chunks = knowledge.knowledgeChunks(unicode);
assert.equal(chunks.length, 6);
assert.ok(chunks.every(chunk => Array.from(chunk).length <= 1000 && !/[\uD800-\uDBFF]$/.test(chunk)));
assert.throws(() => knowledge.knowledgeChunks('x'.repeat(20001)));
console.log('PASS 输入边界、价格确认、Unicode分块与重叠');
const vectors = await knowledge.embeddings(db, ['真实文档一', '真实文档二'], version);
assert.deepEqual(vectors, [[1, 0, 0], [0, 1, 0]]);
assert.equal(fetches[0].init.headers.Authorization, 'Bearer private-embedding-key');
assert.deepEqual(JSON.parse(fetches[0].init.body).input, ['真实文档一', '真实文档二']);
assert.equal(fetches[0].init.redirect, 'error');
for (const bad of [
  { data: [{ index: 0, embedding: [1, 0] }] },
  { data: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [1, 0] }] },
  { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1, 0] }] },
  { data: [{ index: 0, embedding: [0, 0] }, { index: 1, embedding: [1, 0] }] },
]) {
  responseBody = bad; await assert.rejects(() => knowledge.embeddings(db, ['一', '二'], version));
}
console.log('PASS 真实加密配置和协议序号重排，拒绝数量、维度、重复序号与零向量');
claimed = { id: key, user_id: user.id, lease_token: key, model_config_version_id: version, kind: 'knowledge_index',
  payload: { text: '真实知识正文', request: { entry_id: key, content_hash: 'a'.repeat(64) } }, phase: 'claimed', evidence: null };
responseBody = { data: [{ index: 0, embedding: [1, 0, 0] }] }; resultError = true;
fetches = []; calls = [];
await knowledge.processKnowledgeJob(db, 'knowledge_index');
assert.equal(fetches.length, 1); assert.ok(calls.some(call => call.params.p_event === 'retry'));
resultError = false; calls = [];
await knowledge.processKnowledgeJob(db, 'knowledge_index');
assert.equal(fetches.length, 1); assert.ok(calls.some(call => call.params.p_event === 'completed'));
assert.equal(calls.find(call => call.params.p_event === 'completed').params.p_data.version_id, version);
console.log('PASS 已保存Embedding结果后数据库结案失败，恢复不重复请求供应商');
claimed.evidence = null; claimed.phase = 'claimed';
globalThis.fetch = async () => { throw new Error('socket disconnected'); };
calls = [];
await knowledge.processKnowledgeJob(db, 'knowledge_index');
assert.equal(claimed.status, 'unknown');
assert.ok(!calls.some(call => call.params.p_event === 'retry'));
console.log('PASS 请求结果未知转待核对，禁止自动重复计费调用');
const request = body => new Request('https://db.example/functions/v1/knowledge-base', { method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body) });
user = null;
assert.equal((await handleKnowledge(request({ action: 'catalog' }))).status, 401);
user = { id: '11111111-1111-4111-8111-111111111111' };
assert.equal((await handleKnowledge(request({ action: 'create', kind: 'knowledge_search', request_key: key, input: { query: '温和洁面', limit: 5, confirmed_credit_cost: 1 } }))).status, 424);
assert.equal((await handleKnowledge(request({ action: 'create', kind: 'knowledge_search', input: { query: '', confirmed_credit_cost: 1 } }))).status, 400);
console.log('PASS 认证、参数和未启用Embedding明确失败');
modelEnabled = true; fetches = []; calls = [];
globalThis.fetch = async (url, init) => { fetches.push({ url, init }); return new Response('data: [DONE]\n\n'); };
const stream = await handleTextGeneration(request({ knowledge_job_id: key, messages: [{ role: 'user', content: '写洁面脚本' }] }));
assert.equal(stream.status, 200);
assert.equal(stream.headers.get('x-knowledge-sources'), '1');
const messages = JSON.parse(fetches[0].init.body).messages;
assert.ok(messages[0].content.includes('不能作为新商品'));
assert.ok(messages[1].content.includes('真实资料'));
assert.equal(messages.at(-1).content, '写洁面脚本');
await stream.body.cancel();
const attempt = calls.find(call => call.name === 'begin_model_attempt').params;
assert.equal(attempt.p_user, user.id);
assert.equal(attempt.p_context.knowledge_job_id, key);
assert.equal(calls.find(call => call.name === 'finish_model_attempt').params.p_status, 'interrupted');
console.log('PASS 真正流式脚本入口按认证身份加载带版本知识，取消保留原尝试及中断状态');
