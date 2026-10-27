import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEdge } from './edge-loader.mjs';

globalThis.Deno = { env: { get: () => 'fixture' }, serve() {} };
globalThis.__createClient = () => ({});
// 从真实已有处理器抽出的解析入口：错误结构必须在保存前被拒绝。
const scripts = await loadEdge('supabase/functions/ai-assistant/index.ts', 'script-schema');
const scene = { order: 1, scene: '钩子', visual: '商品近景', dialogue: '介绍商品',
  duration: 3, prompt: 'Product closeup', layer: 'hook' };
const content = scenes => '```json\n' + JSON.stringify(scenes) + '\n```\n```prompt\nProduct video\n```';
test('空内容、缺代码块、错误数组及非法场景不可成为成功脚本', () => {
  for (const text of ['', '模型未输出', content({}), content([]), content([{}]),
    content([{ ...scene, order: 2 }]), content([{ ...scene, duration: '3' }]),
    content([{ ...scene, layer: 'unknown' }]), content([{ ...scene, dialogue: '' }])]) {
    assert.throws(() => scripts.parseScriptResult(text), /脚本|模型|场景/);
  }
});
test('正确脚本保留原顺序、分层、提示词和原输出', () => {
  const text = content([scene]);
  const result = scripts.parseScriptResult(text);
  assert.deepEqual(result.scenes, [scene]);
  assert.equal(result.prompt_text, 'Product video');
  assert.equal(result.full_content, text);
});
