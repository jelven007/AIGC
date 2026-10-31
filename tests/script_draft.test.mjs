import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';
const { EMPTY_SCRIPT_DRAFT: empty, readScriptDraft } = await loadFrontend('apps/web/src/lib/scriptDraft.ts', 'script-draft');
test('default, whitespace and legacy default-only values are not meaningful drafts', () => {
  for (const value of [null, {}, empty, { ...empty, category: '' },
    { ...empty, productName: ' ', audience: '\n', sellingPoints: [' '] }, { ...empty, generated: true }]) {
    assert.equal(readScriptDraft(value), null);
  }
});
test('partial content and deliberately changed generation settings remain recoverable', () => {
  for (const patch of [{ productName: '脚本创意' }, { audience: '音乐爱好者' }, { sellingPoints: ['轻巧便携'] },
    { promptText: '自然光下拍摄' }, { category: '数码电器' }, { platform: 'tiktok' }, { videoLength: 30 },
    { knowledgeJobId: '引用标识' }, { priceRange: '¥50-200 中端' }]) {
    const value = { ...empty, ...patch };
    assert.deepEqual(readScriptDraft(value), value);
    assert.deepEqual(readScriptDraft(patch), value);
  }
});
test('malformed scalar, list and scene cache cannot be applied to the editor', () => {
  for (const patch of [{ productName: {} }, { sellingPoints: 'bad' }, { sellingPoints: [null] }, { scenes: {} },
    { scenes: [null] }, { scenes: [{ order: 1, duration: 5 }] }, { videoLength: Infinity }, { generated: 'yes' }]) {
    assert.equal(readScriptDraft({ ...empty, productName: '存在内容', ...patch }), null);
  }
});
test('incomplete scene edits are preserved without changing the cached object', () => {
  const original = { ...empty, scenes: [{ order: 1, duration: 5, scene: '', visual: '创作中的画面', dialogue: '', prompt: '' }] };
  const before = structuredClone(original);
  assert.deepEqual(readScriptDraft(original), original);
  assert.deepEqual(original, before);
});
