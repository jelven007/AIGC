import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';
let current = 'owner';
globalThis.__frontendDB = { auth: { getSession: async () => ({
  data: { session: { access_token: `${current}-jwt`, user: { id: current } } }, error: null,
}) } };
const document = { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
const project = () => ({ id: 'project', user_id: 'owner', title: '画布', document, revision: 1 });

test('canvas save carries expected revision and rejects conflicts and switched-account late responses', async () => {
  const { saveCanvasProject } = await loadFrontend('apps/web/src/api/canvasProjects.ts', 'canvas-projects');
  current = 'owner'; let outgoing;
  globalThis.fetch = async (url, init) => {
    outgoing = { url, init };
    return new Response(JSON.stringify({ ...project(), revision: 2 }));
  };
  assert.equal((await saveCanvasProject('owner', 'project', 1, '画布', document)).revision, 2);
  assert.equal(JSON.parse(outgoing.init.body).p_revision, 1);
  assert.equal(outgoing.init.headers.Authorization, 'Bearer owner-jwt');
  globalThis.fetch = async () => new Response('{"message":"画布版本冲突"}', { status: 409 });
  await assert.rejects(saveCanvasProject('owner', 'project', 1, '画布', document), /冲突/);
  globalThis.fetch = async () => { current = 'other'; return new Response(JSON.stringify(project())); };
  await assert.rejects(saveCanvasProject('owner', 'project', 1, '画布', document), /账号或会话/);
});

test('unknown create response recovers original UUID and never creates a replacement', async () => {
  const { createCanvasProject } = await loadFrontend('apps/web/src/api/canvasProjects.ts', 'canvas-projects');
  current = 'owner'; const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') throw new TypeError('response lost');
    return new Response(JSON.stringify([project()]));
  };
  const result = await createCanvasProject('owner', 'project', '画布', document);
  assert.equal(result.id, 'project');
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
  assert.ok(calls[1].url.includes('id=eq.project'));
});
test('lost save receipt accepts JSONB key ordering but never another document', async () => {
  const { saveCanvasProject } = await loadFrontend('apps/web/src/api/canvasProjects.ts', 'canvas-projects');
  current = 'owner';
  const next = { ...document, nodes: [{ id: 'text', type: 'text', position: { x: 0, y: 0 }, data: { name: '文字', text: '已保存内容' } }] };
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  globalThis.fetch = async (_url, init) => init.method === 'POST' ? new Response('{"message":"lost"}', { status: 503 })
    : new Response(JSON.stringify([{ ...project(), revision: 2, document: reorder(next) }]));
  assert.equal((await saveCanvasProject('owner', 'project', 1, '画布', next)).revision, 2);
  await assert.rejects(saveCanvasProject('owner', 'project', 1, '画布', document), /lost/);
});

test('save queue advances revision only after receipt; a failed write does not block recovery', async () => {
  const { CanvasSaveQueue } = await loadFrontend('apps/web/src/lib/canvasPersistence.ts', 'canvas-persistence');
  const expected = []; let fail = true;
  const queue = new CanvasSaveQueue(project(), async (revision, title, next) => {
    expected.push(revision);
    if (fail) { fail = false; throw Error('offline'); }
    return { ...project(), document: next, title, revision: revision + 1 };
  });
  await assert.rejects(queue.save('失败', document), /offline/);
  await queue.save('恢复', document);
  await queue.save('后续', document);
  assert.deepEqual(expected, [1, 1, 2]);
});

test('draft recovery preserves corrupt storage and detects a changed cloud baseline', async () => {
  const { readCanvasDraft, writeCanvasDraft, canvasDraftKey } = await loadFrontend('apps/web/src/lib/canvasPersistence.ts', 'canvas-persistence');
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  writeCanvasDraft('owner', 'project', { title: '本地内容', document, baseRevision: 1 });
  assert.equal(readCanvasDraft('owner', 'project').baseRevision, 1);
  assert.equal(readCanvasDraft('other', 'project'), null);
  storage.set(canvasDraftKey('owner', 'project'), '{bad');
  assert.throws(() => readCanvasDraft('owner', 'project'), /恢复副本/);
  assert.equal(storage.get(canvasDraftKey('owner', 'project')), '{bad');
});
