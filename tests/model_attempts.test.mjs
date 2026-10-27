import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEdge } from './edge-loader.mjs';

globalThis.Deno = { env: { get: () => 'fixture' }, resolveDns: async () => ['8.8.8.8'] };
globalThis.__createClient = () => ({});
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'attempt-registry');
const config = { slot: 'text.primary', version_id: crypto.randomUUID(),
  settings: { endpoint: 'https://model.example/chat', model: 'configured', timeout_ms: 1000 },
  headers: { Authorization: 'Bearer private' } };
const owner = crypto.randomUUID(), requestId = crypto.randomUUID();
let events, ledgerFailure;
const db = { rpc: async (name, params) => {
  events.push({ name, params });
  return ledgerFailure === name ? { error: { message: 'ledger offline' } }
    : { data: name === 'begin_model_attempt' ? params.p_attempt : true };
} };
const context = () => ({ db, userId: owner, requestId, action: 'text-generation', versions: { prompt: 3 } });
const run = fn => registry.withModelContext(context(), fn);

test('实际调用之前必须持久化尝试，正文读取后记录usage和供应商ID', async () => {
  events = []; ledgerFailure = '';
  globalThis.fetch = async () => {
    assert.equal(events[0].name, 'begin_model_attempt');
    return Response.json({ id: 'upstream-7', choices: [{ message: { content: '正文' } }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } });
  };
  await run(async () => assert.equal((await (await registry.modelFetch(config, '{}')).json()).id, 'upstream-7'));
  assert.equal(events[1].name, 'finish_model_attempt');
  assert.equal(events[1].params.p_status, 'success');
  assert.equal(events[1].params.p_usage.total_tokens, 18);
  assert.equal(events[0].params.p_user, owner);
  assert.equal(events[0].params.p_request, requestId);
  assert.equal(events[0].params.p_version, config.version_id);
});

test('台账开始失败时零供应商调用；结案失败保留started且禁止误判成功', async () => {
  events = []; ledgerFailure = 'begin_model_attempt';
  globalThis.fetch = async () => { throw new Error('must not reach supplier'); };
  await assert.rejects(() => run(() => registry.modelFetch(config, '{}')), /台账/);
  events = []; ledgerFailure = 'finish_model_attempt';
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '正文' } }] });
  await assert.rejects(() => run(async () => (await registry.modelFetch(config, '{}')).json()), /台账/);
});

test('SSE逐块转发，正常结束记录usage，缺失DONE和取消不能记录成功', async () => {
  for (const complete of [true, false]) {
    events = []; ledgerFailure = '';
    globalThis.fetch = async () => new Response(
      'data: {"id":"stream-1","choices":[{"delta":{"content":"正文"}}]}\n\n'
      + 'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n'
      + (complete ? 'data: [DONE]\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream' } });
    const text = await run(async () => (await registry.modelFetch(config, '{}')).text());
    assert.ok(text.includes('正文'));
    assert.equal(events.at(-1).params.p_status, complete ? 'success' : 'interrupted');
    assert.equal(events.at(-1).params.p_usage.total_tokens, 6);
  }
});

test('并发请求的账号和原请求ID互不混用', async () => {
  events = []; ledgerFailure = '';
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '正文' } }] });
  const another = { ...context(), userId: crypto.randomUUID(), requestId: crypto.randomUUID() };
  await Promise.all([run(async () => (await registry.modelFetch(config, '{}')).text()),
    registry.withModelContext(another, async () => (await registry.modelFetch(config, '{}')).text())]);
  assert.deepEqual(new Set(events.filter(e => e.name === 'begin_model_attempt').map(e => `${e.params.p_user}:${e.params.p_request}`)),
    new Set([`${owner}:${requestId}`, `${another.userId}:${another.requestId}`]));
});
