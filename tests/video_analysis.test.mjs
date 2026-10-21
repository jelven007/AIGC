import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: 'e'.repeat(64), RENDER_WORKER_SECRET: 'r'.repeat(32), VIDEO_WORKER_SECRET: 'w'.repeat(32) };
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
let events = [], job, failCompletion = false, versions = {}, configRows = {}, user = { id: uid };
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    const filters = {};
    const query = {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; }, in() { return this; },
      limit() { return this; }, order() { return this; },
      maybeSingle: async () => ({ data: table === 'model_configs' ? configRows[filters.slot] : null }),
      single: async () => ({ data: table === 'model_config_versions' ? versions[filters.id] : job }),
    };
    return query;
  },
  storage: { from: () => ({
    createSignedUrl: async path => ({ data: { signedUrl: `https://db.example/storage/v1/object/sign/materials/${path}?token=temp` } }),
    createSignedUploadUrl: async path => ({ data: { signedUrl: `https://db.example/upload/${path}` } }),
  }) },
  rpc: async (name, args) => {
    if (name === 'can_read_media') return { data: args.p_path.startsWith(uid + '/') };
    if (name === 'claim_production_job') return { data: job };
    if (name === 'update_production_job') {
      events.push({ event: args.p_event, data: args.p_data });
      if (args.p_event === 'checkpoint') job.evidence = args.p_data;
      if (args.p_event === 'resolution') job.resolution = args.p_data;
      if (args.p_event === 'completed' && failCompletion) return { error: new Error('db outage') };
      return { data: job };
    }
    throw new Error('Unexpected RPC ' + name);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'analysis-registry');
const catalog = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'analysis-catalog');
const structured = await loadEdge('supabase/functions/_shared/structured-analysis.ts', 'analysis-structured');
const analysis = await loadEdge('supabase/functions/_shared/video-analysis.ts', 'analysis-core');
const api = await loadEdge('supabase/functions/production-jobs/index.ts', 'analysis-api');
const worker = await loadEdge('supabase/functions/production-worker/index.ts', 'analysis-worker');
const phase3 = await loadEdge('supabase/functions/phase3-assistant/index.ts', 'analysis-phase3');
const own = name => `https://db.example/storage/v1/object/authenticated/materials/${uid}/${name}`;
const timed = [{ start: .4, end: 1.8, text: '真实商品介绍' }, { start: 2, end: 3.5, text: '真实演示' }];
const raw = { transcript_summary: '介绍商品并演示', highlights: [{ first_segment: 0, last_segment: 1, type: 'demo',
  title: '演示高光', score: 82, keyword: '演示', suggested_title: '真实产品演示', reason: '完整展示商品用途' }] };
assert.deepEqual(structured.groundedHighlights(raw, timed).highlights[0].start_sec, .4);
assert.equal(structured.groundedHighlights(raw, timed).highlights[0].end_sec, 3.5);
assert.equal(structured.groundedHighlights(raw, timed).highlights[0].peak_viewers, null);
assert.throws(() => structured.groundedHighlights({ ...raw, highlights: [{ ...raw.highlights[0], last_segment: 999 }] }, timed));
assert.throws(() => structured.timedTranscript([{ ...timed[0], end: 40 }], 10));
assert.throws(() => structured.timedTranscript([], 10));
const sentence = structured.emotionSegments([{ index: 0, emotion: 'hook', intensity: 80, text: 'fabricated', color: 'red', suggestion: '自然开场' }], ['真实原句']);
assert.equal(sentence[0].text, '真实原句'); assert.equal(sentence[0].color, '#f59e0b');
console.log('PASS 高光依据真实字幕边界，越界/无时间戳拒绝；情绪保留原句和白名单色值');
for (const slot of ['text.primary', 'audio.asr']) {
  versions[slot] = { id: slot, slot, settings: { ...catalog.defaultSettings(slot),
    endpoint: slot === 'audio.asr' ? 'https://audio.example/asr' : 'https://text.example/chat',
    ...(slot === 'audio.asr' ? { protocol: 'openai-asr', model: 'whisper-1' } : { model: 'vision-model' }) },
    key_ciphertext: await registry.encryptKey(slot, 'private-key') };
  configRows[slot] = { enabled: true, current_version_id: slot };
}
function reset() {
  events = []; failCompletion = false;
  job = { id: crypto.randomUUID(), user_id: uid, lease_token: crypto.randomUUID(), kind: 'analysis',
    model_config_version_id: 'text.primary', payload: { mode: 'live', title: '真实素材', source_url: own('source.mp4'), asr_version: 'audio.asr' },
    evidence: { source_hash: 'a'.repeat(64), duration: 4, has_audio: true, audio_url: own('audio.wav'), frames: [{ time: 0, url: own('frame.jpg') }] } };
}
reset();
let submissions = [];
globalThis.fetch = async (url, options = {}) => {
  if (options.method !== 'POST') return new Response('RIFF-audio', { headers: { 'content-type': 'audio/wav' } });
  submissions.push(String(url));
  if (String(url).includes('audio.example')) return Response.json({ text: '真实商品介绍与演示', segments: timed });
  const body = JSON.parse(options.body);
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.match(body.messages[1].content[1].image_url.url, /token=temp/);
  assert.match(body.messages[1].content[0].text, /真实商品介绍/);
  return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
};
configRows['text.primary'].enabled = false; configRows['audio.asr'].enabled = false;
failCompletion = true;
await analysis.processAnalysisJob(db);
assert.equal(events.at(-1).event, 'retry');
assert.equal(submissions.length, 2, JSON.stringify(events)); assert.ok(job.resolution);
failCompletion = false;
await analysis.processAnalysisJob(db);
assert.equal(events.at(-1).event, 'completed'); assert.equal(submissions.length, 2);
assert.equal(events.at(-1).data.highlights[0].end_sec, 3.5);
console.log('PASS 抽帧+私有音轨+旧模型版本真实协议；结案故障恢复不重发模型');
reset();
globalThis.fetch = async (_url, options = {}) => {
  if (options.method !== 'POST') return new Response('RIFF-audio');
  throw new Error('lost response');
};
await analysis.processAnalysisJob(db);
assert.equal(events.at(-1).event, 'unknown');
reset(); job.evidence.has_audio = false;
await analysis.processAnalysisJob(db);
assert.equal(events.at(-1).event, 'failed');
console.log('PASS 上游超时保留未知原任务；静音直播拒绝时间戳编造');
const request = (body, token = 'user') => new Request('https://db.example/functions/v1/test', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await api.handleProductionJobs(request({ action: 'create', kind: 'analysis', request_key: crypto.randomUUID(),
  input: { mode: 'live', title: '素材', source_url: 'https://live.example/playback/123', confirmed_credit_cost: 6 } }))).status, 400);
assert.equal((await phase3.handlePhase3(request({ action: 'analyze_live_highlight' }))).status, 410);
user = null;
assert.equal((await api.handleProductionJobs(request({ action: 'analysis-price' }))).status, 401);
user = { id: uid };
reset(); job.evidence = null;
const claim = await (await worker.handleProductionWorker(request({ action: 'claim', kind: 'analysis_prepare' }, env.RENDER_WORKER_SECRET))).json();
assert.equal(claim.job.kind, 'analysis'); assert.equal(claim.outputs.length, 9);
assert.equal(claim.outputs[0].name, 'audio.wav');
assert.equal((await worker.handleProductionWorker(request({ action: 'completed', job_id: job.id, lease_token: job.lease_token }, env.RENDER_WORKER_SECRET))).status, 409);
console.log('PASS 平台播放页/匿名拒绝、旧直播410、9个租约上传对象及模型阶段权限隔离');
