import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSamples } from '../scripts/evaluate_ai.mjs';
const dataset = { version: 'fixture-v1', samples: [{ id: 'translation-1', task: 'translation',
  input: { target_language: 'en' }, checks: { required_paths: ['translated', 'target_language'], forbidden_claims: ['100%有效'] } }] };
const record = { sample_id: 'translation-1', config_version: 'version-a', prompt_version: 'prompt-3',
  input_schema_version: 1, kind: 'fixture', latency_ms: 20,
  output: { translated: 'Canvas bag', target_language: 'en' } };
test('结构失败和未人工复核的事实不标通过，未知现金成本不变零', () => {
  const [group] = evaluateSamples(dataset, [record]).groups;
  assert.equal(group.structure.passed, 1);
  assert.equal(group.facts.reviewed, 0);
  assert.equal(group.facts.pass_rate, null);
  assert.equal(group.cash.unrecorded, 1);
  assert.deepEqual(group.cash.totals, {});
  const bad = evaluateSamples(dataset, [{ ...record, output: { translated: '' } }]).groups[0];
  assert.equal(bad.structure.passed, 0);
});
test('配置与提示词版本分组，币种独立、真实调用与替身结果不混合', () => {
  const result = evaluateSamples(dataset, [record, { ...record, kind: 'provider', config_version: 'version-b',
    cash: { amount_minor: 12, currency: 'USD', recorded: true }, review: { facts: true, language: true, citations: true } }]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[1].facts.pass_rate, 1);
  assert.equal(result.groups[1].cash.totals.USD, 12);
  assert.equal(result.groups[0].kind, 'fixture');
});
test('未知样本、重复版本样本以及非法用量拒绝进入版本比较', () => {
  assert.throws(() => evaluateSamples(dataset, [{ ...record, sample_id: 'missing' }]), /样本/);
  assert.throws(() => evaluateSamples(dataset, [record, record]), /重复/);
  assert.throws(() => evaluateSamples(dataset, [{ ...record, usage: { total_tokens: -1 } }]), /用量/);
});
