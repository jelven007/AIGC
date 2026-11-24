import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';

const api = () => loadFrontend('apps/web/src/lib/canvasDocument.ts', 'canvas-document');
const doc = () => ({ schemaVersion: 1, nodes: [
  { id: 'text', type: 'text', position: { x: 0, y: 0 }, data: { name: '创意', text: '木质桌面的商品特写' } },
  { id: 'image', type: 'image', position: { x: 400, y: 0 }, data: { name: '图片', prompt: '本地描述' } },
  { id: 'reference', type: 'image', position: { x: 0, y: 300 }, data: { name: '参考图', url: 'https://db.example/storage/v1/object/authenticated/materials/owner/a.png' } },
], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

test('image inputs use connected text and reference; invalid or empty inputs do not fall back silently', async () => {
  const { connectionError, imageNodeInput } = await api();
  const document = doc();
  assert.equal(connectionError(document, { source: 'text', target: 'image' }), '');
  document.edges.push({ id: 'a', source: 'text', target: 'image' }, { id: 'b', source: 'reference', target: 'image' });
  assert.equal(imageNodeInput(document, 'image').prompt, '木质桌面的商品特写');
  assert.equal(imageNodeInput(document, 'image').reference_image, document.nodes[2].data.url);
  assert.match(connectionError(document, { source: 'text', target: 'image' }), /重复|已有/);
  assert.match(connectionError(document, { source: 'image', target: 'reference' }), /循环/);
  document.nodes[0].data.text = '';
  assert.throws(() => imageNodeInput(document, 'image'), /文字|描述/);
});

test('copy drops all task receipts; delete removes edges and ungroup preserves absolute positions', async () => {
  const { duplicateNodes, deleteNodes, groupNodes, ungroupNodes } = await api();
  const document = doc();
  document.nodes[1].data.task = { request_key: 'paid', jobId: 'job', status: 'pending' };
  document.edges.push({ id: 'a', source: 'text', target: 'image' });
  const copied = duplicateNodes(document, ['image']);
  assert.equal(copied.nodes.at(-1).data.task, undefined);
  assert.equal(deleteNodes(document, ['text']).edges.length, 0);
  const grouped = groupNodes(document, ['text', 'image']);
  const group = grouped.nodes.find(n => n.type === 'group');
  assert.ok(group);
  const ungrouped = ungroupNodes(grouped, group.id);
  assert.deepEqual(ungrouped.nodes.find(n => n.id === 'image').position, document.nodes[1].position);
});

test('import rejects oversized, unsafe, duplicate and broken topology; valid imports replace IDs and discard tasks', async () => {
  const { importCanvasDocument } = await api();
  const document = doc();
  document.nodes[1].data.task = { request_key: 'paid' };
  const imported = importCanvasDocument(document);
  assert.notEqual(imported.nodes[0].id, 'text');
  assert.equal(imported.nodes[1].data.task, undefined);
  assert.throws(() => importCanvasDocument({ ...document, schemaVersion: 99 }), /版本/);
  assert.throws(() => importCanvasDocument({ ...document, nodes: [...document.nodes, document.nodes[0]] }), /重复/);
  assert.throws(() => importCanvasDocument({ ...document, nodes: [{ ...document.nodes[0], position: { x: Infinity, y: 0 } }] }), /坐标/);
  assert.throws(() => importCanvasDocument({ ...document, edges: [{ id: 'bad', source: 'missing', target: 'image' }] }), /连线/);
  assert.throws(() => importCanvasDocument({ ...document, nodes: [{ ...document.nodes[2], data: { name: '坏地址', url: 'javascript:alert(1)' } }] }), /媒体/);
});

test('drag gesture creates one undo step and viewport movement does not change content history', async () => {
  const { createCanvasHistory, changeCanvasHistory } = await loadFrontend('apps/web/src/lib/canvasHistory.ts', 'canvas-history');
  let state = createCanvasHistory(doc());
  state = changeCanvasHistory(state, { type: 'begin' });
  for (let i = 1; i <= 40; i++) state = changeCanvasHistory(state, { type: 'edit', document: {
    ...state.present, nodes: state.present.nodes.map(n => n.id === 'image' ? { ...n, position: { x: 400 + i, y: 0 } } : n),
  } });
  state = changeCanvasHistory(state, { type: 'commit' });
  assert.equal(state.past.length, 1);
  state = changeCanvasHistory(state, { type: 'viewport', viewport: { x: 80, y: 60, zoom: 2 } });
  assert.equal(state.past.length, 1);
  state = changeCanvasHistory(state, { type: 'undo' });
  assert.equal(state.present.nodes[1].position.x, 400);
  assert.equal(state.present.viewport.zoom, 2);
});
