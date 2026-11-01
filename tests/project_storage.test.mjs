import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';

const { projectStorageKey } = await loadFrontend('apps/web/src/lib/projectStorage.ts', 'project-storage');
const previous = 'shoproai:batch-request:account-a';
const current = 'aigc:batch-request:account-a';
const original = '{"request_key":"original-uuid","input":{"duration":5}}';
function storage(entries, failWrite = false) {
  const values = new Map(entries);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (failWrite) throw new Error('quota exceeded');
      values.set(key, value);
    },
    removeItem: key => values.delete(key),
  };
  return values;
}

test('改名后恢复原UUID与全部参数，不创建另一份批次', () => {
  const values = storage([[previous, original]]);
  assert.equal(projectStorageKey('batch-request', 'account-a'), current);
  assert.equal(values.get(current), original);
  assert.equal(values.has(previous), false);
});
test('已存在新回执时保留新状态，旧回执不覆盖', () => {
  const latest = '{"request_key":"newer-uuid"}';
  const values = storage([[previous, original], [current, latest]]);
  assert.equal(projectStorageKey('batch-request', 'account-a'), current);
  assert.equal(values.get(current), latest);
  assert.equal(values.has(previous), false);
  values.delete(current);
  assert.equal(projectStorageKey('batch-request', 'account-a'), current);
  assert.equal(values.has(current), false);
});
test('存储额度不足时继续找回旧回执，不能丢失幂等键', () => {
  const values = storage([[previous, original]], true);
  assert.equal(projectStorageKey('batch-request', 'account-a'), previous);
  assert.equal(values.get(previous), original);
  assert.equal(values.has(current), false);
});
test('切换账号不迁移或读取另一用户的回执', () => {
  const values = storage([[previous, original]]);
  assert.equal(projectStorageKey('batch-request', 'account-b'), 'aigc:batch-request:account-b');
  assert.equal(values.get(previous), original);
  assert.equal(values.has('aigc:batch-request:account-b'), false);
});

for (const [kind, scope, legacy] of [
  ['checkout', undefined, 'shopro:checkout:account-a'],
  ['video-task', undefined, 'shopro:video-task:account-a'],
  ['production', 'image:workbench', 'shopro:production:account-a:image:workbench'],
  ['intelligence:competitor', undefined, 'shopro:intelligence:competitor:account-a'],
  ['analysis', 'script', 'shopro:analysis:account-a:script'],
  ['operator-request', undefined, 'shopro-operator-request-account-a'],
  ['product-mutation', undefined, 'shopro-product-mutation-account-a'],
  ['product-extraction', undefined, 'shopro-product-extraction-account-a'],
]) {
  test(`迁移${kind}的历史回执时保留请求和账号范围`, () => {
    const values = storage([[legacy, original]]);
    const expected = `aigc:${kind}:account-a${scope ? `:${scope}` : ''}`;
    assert.equal(projectStorageKey(kind, 'account-a', scope), expected);
    assert.equal(values.get(expected), original);
    assert.equal(values.has(legacy), false);
    assert.equal(projectStorageKey(kind, 'account-b', scope), expected.replace('account-a', 'account-b'));
  });
}
test('旧短前缀回执写入失败后仍恢复原支付请求', () => {
  const legacy = 'shopro:checkout:account-a';
  const values = storage([[legacy, original]], true);
  assert.equal(projectStorageKey('checkout', 'account-a'), legacy);
  assert.equal(values.get(legacy), original);
});

for (const invalid of ['{invalid-json', 'null', '{}', '{"unrelated":true}']) {
  test(`新回执损坏时仍能迁移有效旧请求：${invalid}`, () => {
    const values = storage([[previous, original], [current, invalid]]);
    const key = projectStorageKey('batch-request', 'account-a');
    assert.equal(values.get(key), original);
  });
}
test('迁移写入静默丢失时保留旧键及原UUID', () => {
  const values = storage([[previous, original]]);
  localStorage.setItem = () => {};
  const key = projectStorageKey('batch-request', 'account-a');
  assert.equal(key, previous);
  assert.equal(values.get(previous), original);
});
test('迁移后读回不一致时不清理旧请求', () => {
  const values = storage([[previous, original]]);
  localStorage.setItem = (key, value) => values.set(key, value.slice(0, -1));
  assert.equal(projectStorageKey('batch-request', 'account-a'), previous);
  assert.equal(values.get(previous), original);
});
test('新旧回执都损坏时保留原始证据供调用方显示错误', () => {
  const values = storage([[previous, '{broken-old'], [current, '{broken-new']]);
  assert.equal(projectStorageKey('batch-request', 'account-a'), current);
  assert.equal(values.get(previous), '{broken-old');
  assert.equal(values.get(current), '{broken-new');
});
test('业务校验器拒绝结构不完整的新批次，保留原UUID和payload', () => {
  const valid = value => value?.key && value.input?.name && Array.isArray(value.input.product_ids);
  const receipt = '{"key":"original-batch-uuid","input":{"name":"batch","product_ids":["product-a"]}}';
  const values = storage([[previous, receipt], [current, '{"key":"incomplete"}']]);
  const key = projectStorageKey('batch-request', 'account-a', undefined, valid);
  assert.equal(values.get(key), receipt);
});
test('旧sessionStorage批次也能独立迁移，不读取另一账号或localStorage', () => {
  const locals = storage([]);
  const sessions = new Map([[previous, original]]);
  const session = {
    getItem: key => sessions.get(key) ?? null,
    setItem: (key, value) => sessions.set(key, value),
    removeItem: key => sessions.delete(key),
  };
  assert.equal(projectStorageKey('batch-request', 'account-b', undefined, undefined, session),
    'aigc:batch-request:account-b');
  const key = projectStorageKey('batch-request', 'account-a', undefined, undefined, session);
  assert.equal(sessions.get(key), original);
  assert.equal(locals.size, 0);
});
test('实验授权源子回执独立迁移且保持原UUID', () => {
  const source = '59aca7a8-5bbc-4213-b181-bf3e81324c5d';
  const values = storage([['shoproai:experiment-request:account-a:source', source]]);
  const key = projectStorageKey('experiment-request', 'account-a', 'source');
  assert.equal(values.get(key), source);
  assert.equal(values.has('shoproai:experiment-request:account-a:source'), false);
});
test('子回执静默写失败也继续读取旧键', () => {
  const legacy = 'shoproai:experiment-request:account-a:source';
  const source = '59aca7a8-5bbc-4213-b181-bf3e81324c5d';
  const values = storage([[legacy, source]]);
  localStorage.setItem = () => {};
  assert.equal(projectStorageKey('experiment-request', 'account-a', 'source'), legacy);
  assert.equal(values.get(legacy), source);
});
test('数组回执及视频已受理任务ID继续兼容，空数组表示已清理', () => {
  for (const raw of ['[]', '[{"request_key":"original"}]', '{"job_id":"accepted-original"}']) {
    const values = storage([[previous, raw]]);
    assert.equal(values.get(projectStorageKey('batch-request', 'account-a')), raw);
  }
});
test('旧回执读取失败时明确阻止迁移，不能当作空回执重新提交', () => {
  storage([]);
  localStorage.getItem = key => {
    if (key === previous) throw new Error('blocked storage');
    return null;
  };
  assert.throws(() => projectStorageKey('batch-request', 'account-a'), /回执.*读取失败/);
});
test('运营申请的嵌套body原请求继续迁移', () => {
  const legacy = 'shopro-operator-request-account-a';
  const receipt = '{"kind":"operator","body":{"request_key":"original-operator-uuid","action":"save"}}';
  const values = storage([[legacy, receipt]]);
  assert.equal(values.get(projectStorageKey('operator-request', 'account-a')), receipt);
});
