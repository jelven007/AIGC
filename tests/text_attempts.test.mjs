import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEdge } from './edge-loader.mjs';
const environment = { MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
  SUPABASE_URL: 'https://fixture.example', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
globalThis.Deno = { env: { get: name => environment[name] },
  resolveDns: async () => ['8.8.8.8'] };
let events = [];
const db = {
  rpc: async (name, params) => { events.push({ name, params });
    return { data: name === 'begin_model_attempt' ? params.p_attempt : true }; },
};
globalThis.__createClient = () => db;
const api = await loadEdge('tests/text_attempt_fixture.ts', 'text-attempts');
// AES AAD依赖槽，分别准备真实密文。
const keys = Object.fromEntries(await Promise.all(['text.primary', 'text.fallback'].map(async slot =>
  [slot, await api.encryptKey(slot, 'fixture-key')])));
db.from = () => {
  let slot;
  return { select() { return this; }, eq(key, value) { if (key === 'slot') slot = value; return this; },
    maybeSingle: async () => ({ data: { enabled: true, current_version_id: crypto.randomUUID() } }),
    single: async () => ({ data: { id: crypto.randomUUID(), slot,
      settings: { ...api.defaultSettings(slot), endpoint: `https://${slot.replace('.', '-')}.example/chat`, model: slot },
      key_ciphertext: keys[slot] } }) };
};
const run = callback => api.withModelContext({ db, userId: crypto.randomUUID(), requestId: crypto.randomUUID(),
  action: 'free-text', versions: { prompt: 3 } }, callback);
test('主模型拒绝备模型成功形成两条真实尝试，原request聚合且免费用量保留', async () => {
  events = [];
  globalThis.fetch = async url => String(url).includes('primary') ? new Response('', { status: 429 })
    : Response.json({ id: 'backup-1', choices: [{ message: { content: '正文' } }], usage: { total_tokens: 8 } });
  await run(async () => (await api.requestTextModel([{ role: 'user', content: '商品' }])).json());
  const attempts = events.filter(item => item.name === 'begin_model_attempt');
  assert.equal(attempts.length, 2);
  assert.equal(new Set(attempts.map(item => item.params.p_request)).size, 1);
  assert.deepEqual(events.filter(item => item.name === 'finish_model_attempt').map(item => item.params.p_status), ['error', 'success']);
  assert.equal(events.at(-1).params.p_usage.total_tokens, 8);
});
test('主备请求共用总超时预算，预算耗尽后不会再调用备用模型', async () => {
  events = []; let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    await new Promise((resolve, reject) => {
      if (init.signal.aborted) return reject(init.signal.reason);
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      setTimeout(resolve, 100);
    });
    return new Response('', { status: 429 });
  };
  await assert.rejects(() => run(() => api.requestTextModel([{ role: 'user', content: '商品' }], { totalTimeoutMs: 15 })));
  assert.equal(calls, 1);
  assert.equal(events.at(-1).params.p_status, 'unknown');
});
