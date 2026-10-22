import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const { validateRender } = await loadEdge('supabase/functions/_shared/render-spec.ts', 'render-effects');
const { RENDER_TRANSITIONS, RENDER_BLENDS } = await loadEdge('supabase/functions/_shared/render-effects.ts', 'render-effects-catalog');
const spec = {
  version: 1, title: '剪辑效果', duration: 2, height: 720, fps: 30, ratio: '16:9',
  tracks: [
    { id: 'one', type: 'video', start: 0, duration: 1, url: 'https://media.example/one.mp4' },
    { id: 'two', type: 'video', start: 1, duration: 1, url: 'https://media.example/two.mp4' },
  ],
};
for (const transition of RENDER_TRANSITIONS) {
  assert.equal(validateRender({ ...spec, transition: transition.id, transitionDuration: .25 }).transition, transition.id);
}
for (const mode of RENDER_BLENDS) {
  const input = structuredClone(spec);
  Object.assign(input.tracks[1], { trackId: 'pip', start: 0, blendMode: mode.id,
    chromaKey: { color: '#00ff00', similarity: .25, smoothness: .08 } });
  assert.equal(validateRender(input), input);
}
console.log('PASS 十二转场、八混合、色键工程协议可提交');
const person = structuredClone(spec);
person.tracks[0].personMask = { model: 'pphumanseg-2023mar', threshold: .5, feather: 1 };
assert.equal(validateRender(person), person);
for (const mask of [{ model: 'untrusted-model', threshold: .5, feather: 1 }, { model: 'pphumanseg-2023mar', threshold: NaN, feather: 1 },
  { model: 'pphumanseg-2023mar', threshold: .5, feather: 8 }]) {
  assert.throws(() => validateRender({ ...spec, tracks: [{ ...spec.tracks[0], personMask: mask }] }));
}
person.tracks[0].chromaKey = { color: '#00ff00', similarity: .2, smoothness: .1 };
assert.throws(() => validateRender(person), /人物分割/);
console.log('PASS 固定人物模型参数与色键互斥，未知模型/错误阈值/边缘范围拒绝');
for (const change of [{ transition: 'unknown' }, { transition: null }, { transitionDuration: NaN }, { transitionDuration: 3 }]) {
  assert.throws(() => validateRender({ ...spec, ...change }));
}
for (const change of [
  { blendMode: 'movie=attack' }, { chromaKey: { color: 'red', similarity: .2, smoothness: 0 } },
  { chromaKey: { color: '#00ff00', similarity: true, smoothness: .1 } },
  { chromaKey: { color: '#00ff00', similarity: .2, smoothness: -1 } },
  { fadeIn: 2 }, { keyframes: [null] }, { id: '' },
]) {
  const input = structuredClone(spec); Object.assign(input.tracks[0], change);
  assert.throws(() => validateRender(input), JSON.stringify(change));
}
const overlap = structuredClone(spec);
overlap.transition = 't3'; overlap.tracks[1].start = .5;
assert.throws(() => validateRender(overlap), /不可重叠/);
overlap.tracks[1].trackId = 'pip';
assert.equal(validateRender(overlap), overlap);
console.log('PASS 错误蒙版/表达式/淡变、重叠主轨计费前拒绝，画中画保留叠加');

const audio = { ...spec, tracks: [{ ...spec.tracks[0], type: 'audio', eqBands: { 1000: -12, 4000: 6 }, echo: 50, voiceEffect: 'robot' }] };
assert.equal(validateRender(audio), audio);
for (const change of [{ eqBands: { 999: 3 } }, { eqBands: { 1000: NaN } }, { eqBands: { 1000: true } },
  { eqBands: { 1000: 13 } }, { eqBands: [] }, { echo: 101 }, { voiceEffect: 'unknown' }, { denoise: 'fake' }, { reverb: 'fake' }]) {
  assert.throws(() => validateRender({ ...audio, tracks: [{ ...audio.tracks[0], ...change }] }));
}
assert.throws(() => validateRender({ ...spec, tracks: [{ ...spec.tracks[0], type: 'image', echo: 0 }] }));
console.log('PASS 十频段均衡器、回声与机器人参数校验，错误效果计费前拒绝');

globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service',
  RENDER_WORKER_SECRET: 'render-secret' })[name] }, serve() {} };
let claims = 0;
globalThis.__createClient = () => ({ rpc: async () => { claims++; return { data: null }; } });
const { handleProductionWorker } = await loadEdge('supabase/functions/production-worker/index.ts', 'render-worker-capability');
const request = body => new Request('https://db.example/functions/v1/production-worker', { method: 'POST',
  headers: { Authorization: 'Bearer render-secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await handleProductionWorker(request({ action: 'claim' }))).status, 426);
assert.equal(claims, 0);
assert.equal((await handleProductionWorker(request({ action: 'claim', render_version: 2 }))).status, 426);
assert.equal((await handleProductionWorker(request({ action: 'claim', render_version: 3 }))).status, 426);
assert.equal((await handleProductionWorker(request({ action: 'claim', render_version: 4 }))).status, 200);
assert.equal(claims, 1);
assert.equal((await handleProductionWorker(request({ action: 'claim', kind: 'analysis_prepare' }))).status, 200);
console.log('PASS 旧Worker领取前426，不消耗租约，新版本渲染与原分析预处理可领取');
