import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { loadFrontend } from './frontend-loader.mjs';

const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent ??= class {};
globalThis.__frontendDB = { auth: { getSession: async () => ({ data: {
  session: { user: { id: 'a' }, access_token: 'token-a' },
} }) } };
let requests = 0;
globalThis.fetch = async () => { requests++; return Response.json({ jobs: [{ id: 'one', status: 'running' }] }); };
const queries = await loadFrontend('apps/web/src/lib/taskQueries.ts', 'task-queries');
const receipts = await loadFrontend('apps/web/src/lib/taskReceipt.ts', 'task-receipts');
test('同账号同时挂载的列表读取共用一次真实API请求', async () => {
  requests = 0;
  const client = new QueryClient();
  const options = queries.taskListOptions('production', 'a');
  const [left, right] = await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
  assert.equal(requests, 1); assert.deepEqual(left, right);
  assert.notDeepEqual(options.queryKey, queries.taskListOptions('production', 'b').queryKey);
  client.clear();
});
test('任务终态和隐藏页面停止轮询，未知状态继续核对，错误有界重试', () => {
  assert.equal(queries.taskPollDelay([{ status: 'completed' }], null, true, 'production'), false);
  assert.equal(queries.taskPollDelay([{ status: 'unknown' }], null, false, 'production'), false);
  assert.equal(queries.taskPollDelay([{ status: 'unknown' }], null, true, 'production'), 30000);
  assert.equal(queries.taskPollDelay([{ status: 'pending' }], null, true, 'production'), 10000);
  assert.equal(queries.taskPollDelay(undefined, new Error('offline'), true, 'production'), 30000);
  assert.equal(queries.taskPollDelay([{ status: 'processing', submission_state: 'unknown' }], null, true, 'video'), 30000);
  assert.equal(queries.taskPollDelay([{ status: 'processing', submission_state: 'unknown' },
    { status: 'processing', submission_state: 'submitted' }], null, true, 'video'), 10000);
});
test('批次等待核对继续读取，暂停和预览确认静止，情报监控按下次采集时间刷新', () => {
  assert.equal(queries.taskPollDelay([{ status: 'cancelling' }], null, true, 'batch'), 10000);
  assert.equal(queries.taskPollDelay([{ status: 'paused' }], null, true, 'batch'), false);
  assert.equal(queries.taskPollDelay([{ status: 'awaiting_publish' }], null, true, 'batch'), false);
  assert.equal(queries.taskPollDelay([{ status: 'paused', items: [{ submission_state: 'unknown' }] }], null, true, 'batch'), 30000);
  const catalog = { jobs: [], targets: [{ monitoring: true, next_run_at: new Date(Date.now() + 600000).toISOString() }] };
  assert.equal(queries.taskPollDelay(catalog, null, true, 'production'), 300000);
  assert.equal(queries.taskPollDelay(catalog, null, false, 'production'), false);
  assert.equal(queries.taskPollDelay({ ...catalog, jobs: [{ status: 'running' }] }, null, true, 'production'), 10000);
});
test('详情刷新与创建结果同时更新账号列表缓存', () => {
  const client = new QueryClient();
  const list = queries.taskListOptions('production', 'a').queryKey;
  client.setQueryData(list, [{ id: 'one', status: 'running', request_key: 'original' }]);
  const completed = { id: 'one', status: 'completed', request_key: 'original' };
  queries.rememberTask(client, 'production', 'a', completed);
  assert.equal(client.getQueryData(list)[0].status, 'completed');
  assert.deepEqual(client.getQueryData(queries.taskDetailKey('production', 'a', { request_key: 'original' })), completed);
  client.clear();
});
test('领域子集不会被全局最近30条截断；详情刷新只更新匹配子集', async () => {
  const client = new QueryClient();
  const scoped = queries.productionKindsOptions(['product_translate'], 'a');
  await client.fetchQuery(scoped);
  assert.notDeepEqual(scoped.queryKey, queries.taskListOptions('production', 'a').queryKey);
  client.setQueryData(scoped.queryKey, []);
  queries.rememberTask(client, 'production', 'a', { id: 'translate', kind: 'product_translate', status: 'completed' });
  assert.equal(client.getQueryData(scoped.queryKey)[0].id, 'translate');
  queries.rememberTask(client, 'production', 'a', { id: 'image', kind: 'image', status: 'completed' });
  assert.equal(client.getQueryData(scoped.queryKey).length, 1);
  client.clear();
});
test('回执写失败、静默丢弃和损坏均可见，保留原UUID', () => {
  storage.clear();
  const original = { request_key: 'original', input: {} };
  receipts.writeTaskReceipt('a', original);
  assert.deepEqual(receipts.readTaskReceipt('a', value => typeof value.request_key === 'string').value, original);
  const set = localStorage.setItem;
  localStorage.setItem = () => {};
  assert.throws(() => receipts.writeTaskReceipt('a', { ...original, request_key: 'new' }), /回执.*保存/);
  assert.equal(JSON.parse(storage.get('a')).request_key, 'original');
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => receipts.writeTaskReceipt('a', original), /回执.*保存/);
  localStorage.setItem = set;
  storage.set('a', '{"unexpected":true}');
  assert.match(receipts.readTaskReceipt('a', value => typeof value.request_key === 'string').error, /回执.*读取/);
});
test('错时挂载仍只有一个计时器，隐藏10分钟零读取且回到前台立即查询', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  globalThis.window = page; globalThis.document = document;
  const client = new QueryClient();
  let reads = 0;
  const options = { queryKey: ['tasks', 'a', 'production', 'list'], queryFn: async () => {
    reads++; return [{ id: 'one', status: 'running' }];
  } };
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  await client.fetchQuery(options);
  const left = queries.watchTaskQuery(client, options, 'production');
  context.mock.timers.tick(4000);
  const right = queries.watchTaskQuery(client, options, 'production');
  context.mock.timers.tick(6000); await settle();
  assert.equal(reads, 2);
  context.mock.timers.tick(4000); await settle();
  assert.equal(reads, 2, '第二个面板不应另开轮询');
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(600000); await settle(); assert.equal(reads, 2);
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); await settle();
  assert.equal(reads, 3);
  client.setQueryData(options.queryKey, [{ id: 'one', status: 'completed' }]);
  context.mock.timers.tick(60000); await settle(); assert.equal(reads, 3);
  left(); right(); client.clear();
  context.mock.timers.reset();
});
