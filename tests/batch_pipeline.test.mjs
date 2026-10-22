import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const backend = 'https://db.example';
const uid = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
globalThis.Deno = { env: { get: name => name === 'SUPABASE_URL' ? backend : undefined }, serve() {} };
const { pipelinePayload } = await loadEdge('supabase/functions/_shared/batch-pipeline.ts', 'pipeline-contract');
const { validateBatchRequest } = await loadEdge('supabase/functions/_shared/batch-video.ts', 'pipeline-input');
const url = name => `${backend}/storage/v1/object/authenticated/materials/${uid}/${name}`;
const request = { name: '双镜头台词', provider: 'Wan3', product_ids: [id],
  settings: { duration: 5, ratio: '9:16', resolution: '720P', style: '商品展示', language: 'zh' },
  overrides: { [id]: { narration: '已确认的实际台词' } },
  pipeline: { shots: ['特写', '使用'], voice: 'alloy', subtitles: true, transition: 'none', delivery: 'publish' },
  expected_unit_cost: 25, budget: 25 };
assert.deepEqual(validateBatchRequest(request), request);
for (const value of [{ ...request, overrides: {} }, { ...request, pipeline: { ...request.pipeline, voice: '' } },
  { ...request, pipeline: { ...request.pipeline, shots: ['单镜头'] } },
  { ...request, settings: { ...request.settings, resolution: '480P' } }]) assert.throws(() => validateBatchRequest(value));
const voice = { id: 'voice', kind: 'tts', result: { url: url('voice.mp3') } };
const stage = { id, kind: 'subtitles', request, credit_cost: 3, product_name: '测试商品', spec: {} };
const payload = pipelinePayload(stage, [voice], backend);
assert.equal(payload.pipeline_audio, true);
assert.equal(payload.source.duration, 10);
assert.equal(payload.mode, 'subtitles');
assert.equal(payload.source.url, voice.result.url);
const measured = { id: 'measured', kind: 'subtitles', result: {
  duration: 6.3, segments: [{ start: .2, end: 2.7, text: '实际台词甲' }, { start: 3.1, end: 6.2, text: '实际台词乙' }],
} };
const videos = [0, 1].map(position => ({ id: `shot-${position}`, position, kind: 'video', result: { video_url: url(`shot-${position}.mp4`) } }));
const render = pipelinePayload({ ...stage, kind: 'render' }, [...videos.reverse(), voice, measured], backend);
assert.equal(render.duration, 10);
assert.ok(render.tracks.every(track => typeof track.name === 'string' && track.name.trim()));
assert.deepEqual(render.tracks.filter(track => track.type === 'video').map(track => [track.id, track.start, track.volume]),
  [['shot-0', 0, 0], ['shot-1', 5, 0]]);
assert.equal(render.tracks.find(track => track.type === 'audio').duration, 6.3);
assert.deepEqual(render.tracks.filter(track => track.type === 'text').map(track => [track.start, track.duration, track.text]),
  [[.2, 2.5, '实际台词甲'], [3.1, 3.1, '实际台词乙']]);
for (const dependencies of [[voice, ...videos], [...videos, voice, { ...measured, result: { duration: 11 } }],
  [...videos, { ...voice, result: { url: 'https://foreign.example/audio.mp3' } }, measured]]) {
  assert.throws(() => pipelinePayload({ ...stage, kind: 'render' }, dependencies, backend));
}
const noSubtitles = { ...request, pipeline: { ...request.pipeline, subtitles: false } };
assert.equal(pipelinePayload({ ...stage, request: noSubtitles }, [voice], backend).mode, 'beats');
assert.equal(pipelinePayload({ ...stage, kind: 'render', request: noSubtitles }, [...videos, voice, measured], backend)
  .tracks.some(track => track.type === 'text'), false);
console.log('PASS 多镜头/台词参数、实际配音测量、镜头顺序与静音、真实时间戳字幕、私有依赖及无字幕测量');
