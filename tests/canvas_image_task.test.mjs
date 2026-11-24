import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';
let current = 'owner';
globalThis.__frontendDB = { auth: { getSession: async () => ({
  data: { session: { access_token: `${current}-jwt`, user: { id: current } } }, error: null,
}) } };
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const substitutes = { 'apps/web/src/api/productionJobs.ts': `
export class ProductionJobError extends Error { constructor(message,status) { super(message); this.status=status; } }
export async function productionRequest(body,userId) { return globalThis.__canvasJobRequest(body,userId); }
export async function createProductionJob(kind,key,input,projectId,userId) {
return (await globalThis.__canvasJobRequest({action:'create',kind,request_key:key,input,project_id:projectId},userId)).job; }` };

test('lost create response keeps original request; same UUID recovers without another charge', async () => {
  const { CanvasImageTask } = await loadFrontend('apps/web/src/lib/canvasImageTask.ts', 'canvas-task', substitutes);
  storage.clear(); current = 'owner'; const calls = [];
  globalThis.__canvasJobRequest = async body => {
    calls.push(body);
    if (body.action === 'create') throw Error('lost response');
    return { job: { id: 'paid-job', request_key: body.request_key, status: 'running', progress: 30 } };
  };
  const task = new CanvasImageTask('owner', 'canvas');
  await assert.rejects(task.start('image', { prompt: '测试' }), /lost response/);
  const key = task.receipt.request_key;
  const recovered = await task.restore();
  assert.equal(recovered.request_key, key);
  assert.equal(calls.filter(c => c.action === 'create').length, 1);
  await assert.rejects(task.start('other-node', { prompt: '其他' }), /未结束|待确认/);
  assert.equal(calls.length, 2);
});

test('deleted node receipt remains recoverable; another account cannot submit it', async () => {
  const { CanvasImageTask } = await loadFrontend('apps/web/src/lib/canvasImageTask.ts', 'canvas-task', substitutes);
  current = 'owner'; let calls = 0;
  const original = new CanvasImageTask('owner', 'canvas');
  globalThis.__canvasJobRequest = async () => { calls++; return { job: { id: 'job', request_key: original.receipt.request_key, status: 'completed', result: { url: 'done' } } }; };
  assert.equal(original.receipt.nodeId, 'image');
  current = 'other';
  await assert.rejects(original.restore(), /账号或会话/);
  assert.equal(calls, 0);
  current = 'owner';
  assert.equal((await original.restore()).status, 'completed');
  assert.equal(original.receipt.nodeId, 'image');
  original.finish();
  assert.equal(original.receipt, null);
});
test('a mismatched initial job cannot consume the original recovery receipt', async () => {
  const { CanvasImageTask } = await loadFrontend('apps/web/src/lib/canvasImageTask.ts', 'canvas-task', substitutes);
  storage.clear(); current = 'owner';
  globalThis.__canvasJobRequest = async () => ({ job: { id: 'wrong-job', request_key: 'wrong-request', status: 'completed' } });
  const task = new CanvasImageTask('owner', 'canvas');
  await assert.rejects(task.start('image', { prompt: '原请求' }), /回执不匹配/);
  assert.ok(task.receipt.input);
  assert.notEqual(task.receipt.request_key, 'wrong-request');
  assert.equal(task.receipt.jobId, undefined);
});
