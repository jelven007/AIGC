import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: 'e'.repeat(64), RENDER_WORKER_SECRET: 'r'.repeat(32), VIDEO_WORKER_SECRET: 'w'.repeat(32) };
globalThis.Deno = { env: { get: name => env[name] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
const own = name => `https://db.example/storage/v1/object/authenticated/materials/${uid}/${name}`;
const source = { id: 'music', type: 'audio', url: own('audio.wav'), start: 2, duration: 4, sourceStart: 1, speed: 2 };
const input = { title: '真实音轨', mode: 'subtitles', source, confirmed_credit_cost: 3 };
const { editInput, editEvidence } = await loadEdge('supabase/functions/_shared/edit-contract.ts', 'edit-contract');
assert.deepEqual(editInput(input), input);
for (const change of [{ duration: -1 }, { start: 599 }, { speed: true }, { sourceStart: NaN }, { type: 'text' }]) {
  assert.throws(() => editInput({ ...input, source: { ...source, ...change } }));
}
const beats = { duration: 4, source_hash: 'a'.repeat(64), beats: [.5, 1, 1.5], bpm: null, confidence: .9, algorithm: 'spectral-flux-v1' };
assert.equal(editEvidence(beats, { ...input, mode: 'beats' }).beats.length, 3);
for (const change of [{ beats: [1, .5] }, { duration: 5 }, { bpm: 120 }, { confidence: NaN }]) {
  assert.throws(() => editEvidence({ ...beats, ...change }, { ...input, mode: 'beats' }));
}
console.log('PASS 原素材、速度、裁剪和时间戳协议，节拍不足不接受BPM');

const js = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const media = uri(js(readFileSync('apps/web/src/lib/privateMedia.ts', 'utf8').replace(
  "import { backendUrl } from './backendConfig';", "const backendUrl = 'https://db.example';")));
const timeline = await import(uri(js(readFileSync('apps/web/src/lib/editTimeline.ts', 'utf8').replace(
  "'@/lib/privateMedia'", JSON.stringify(media)))));
const tracks = [{ id: 'main', type: 'video', trackId: 'video', name: '主视频', start: 0, duration: 6,
  url: own('main.mp4'), sourceStart: 2, speed: 1.5 }, { ...source, trackId: 'audio', name: '节拍' }];
const cut = timeline.beatCuts(tracks, { ...beats, mode: 'beats', source });
assert.equal(cut.count, 3);
assert.equal(cut.tracks[1].start, 2.5);
assert.equal(cut.tracks[1].sourceStart, 5.75);
assert.ok(cut.tracks.every(track => track.duration > 0));
assert.throws(() => timeline.beatCuts(tracks.map(track => track.id === 'music' ? { ...track, speed: 1 } : track),
  { ...beats, mode: 'beats', source }), /已调整/);
const subtitles = timeline.subtitleItems({ mode: 'subtitles', source, segments: [{ start: .2, end: 1.3, text: '原台词' }] }, 6, 'job');
assert.equal(subtitles[0].start, 2.2); assert.equal(subtitles[0].duration, 1.0999999999999996);
assert.equal(subtitles[0].id, 'subtitle:job:0');
assert.throws(() => timeline.subtitleItems({ mode: 'subtitles', source, segments: [{ start: 2, end: 8, text: '越界' }] }, 6, 'job'));
console.log('PASS 真实节拍切分保留原源位置、字幕偏移与同任务标识、素材改变拒绝应用');

let job, events = [], failure = false, posts = 0, configRows = {}, versions = {};
const db = {
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  from(table) {
    const filters = {};
    return { select() { return this; }, eq(name, value) { filters[name] = value; return this; },
      in() { return this; }, limit() { return this; }, order() { return this; },
      maybeSingle: async () => ({ data: table === 'model_configs' ? configRows[filters.slot] : null }),
      single: async () => ({ data: table === 'model_config_versions' ? versions[filters.id] : job }) };
  },
  storage: { from: () => ({ createSignedUrl: async path => ({ data: { signedUrl: `https://db.example/storage/v1/object/sign/materials/${path}?token=temp` } }),
    createSignedUploadUrl: async path => ({ data: { signedUrl: `https://db.example/upload/${path}` } }),
    list: async () => ({ data: [{ name: 'audio.wav', metadata: { size: 1000 } }] }) }) },
  rpc: async (name, args) => {
    if (name === 'can_read_media') return { data: true };
    if (name === 'claim_production_job') return { data: job };
    if (name === 'update_production_job') {
      events.push({ event: args.p_event, data: args.p_data });
      if (args.p_event === 'checkpoint') job.evidence = args.p_data;
      if (args.p_event === 'resolution') job.resolution = args.p_data;
      if (args.p_event === 'completed' && failure) return { error: new Error('db outage') };
      return { data: job };
    }
    throw new Error('Unexpected RPC ' + name);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'edit-registry');
const catalog = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'edit-catalog');
versions.asr = { id: 'asr', slot: 'audio.asr', settings: { ...catalog.defaultSettings('audio.asr'), protocol: 'openai-asr', model: 'whisper-1', endpoint: 'https://audio.example/asr' },
  key_ciphertext: await registry.encryptKey('audio.asr', 'private-key') };
configRows['audio.asr'] = { enabled: false, current_version_id: 'other' };
const core = await loadEdge('supabase/functions/_shared/edit-jobs.ts', 'edit-core');
function reset() {
  job = { id: crypto.randomUUID(), user_id: uid, kind: 'edit_analysis', lease_token: crypto.randomUUID(),
    model_config_version_id: 'asr', payload: input, evidence: { duration: 4, source_hash: 'a'.repeat(64), audio_url: own('audio.wav') } };
  events = []; failure = false; posts = 0;
}
reset();
globalThis.fetch = async (_url, options = {}) => {
  if (options.method !== 'POST') return new Response('RIFF-audio');
  posts++; assert.equal(options.body.get('response_format'), 'verbose_json');
  return Response.json({ text: '原台词', segments: [{ start: .2, end: 1.3, text: '原台词' }] });
};
failure = true;
await core.processEditJob(db);
assert.equal(events.at(-1).event, 'retry'); assert.equal(posts, 1); assert.ok(job.resolution);
failure = false;
await core.processEditJob(db);
assert.equal(events.at(-1).event, 'completed'); assert.equal(posts, 1);
assert.equal(events.at(-1).data.asr_version, 'asr'); assert.equal(events.at(-1).data.segments[0].start, .2);
console.log('PASS 原ASR版本/真实verbose_json与分段，数据库结案故障恢复不重发识别');
reset();
globalThis.fetch = async (_url, options = {}) => {
  if (options.method !== 'POST') return new Response('RIFF-audio');
  throw new Error('lost response');
};
await core.processEditJob(db);
assert.equal(events.at(-1).event, 'unknown');
reset();
globalThis.fetch = async (_url, options = {}) => options.method === 'POST'
  ? Response.json({ text: '没有时间戳' }) : new Response('RIFF-audio');
await core.processEditJob(db);
assert.equal(events.at(-1).event, 'failed');
console.log('PASS 识别超时保留原未知任务，无时间戳明确失败，禁止固定时长铺字幕');
const worker = await loadEdge('supabase/functions/production-worker/index.ts', 'edit-worker');
const request = body => new Request('https://db.example/functions/v1/production-worker', { method: 'POST',
  headers: { Authorization: `Bearer ${env.RENDER_WORKER_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
reset(); job.payload.mode = 'beats'; job.evidence = null;
assert.equal((await worker.handleProductionWorker(request({ action: 'claim', kind: 'edit_prepare', render_version: 2 }))).status, 426);
const claim = await (await worker.handleProductionWorker(request({ action: 'claim', kind: 'edit_prepare', render_version: 4, edit_version: 2 }))).json();
assert.equal(claim.outputs.length, 0);
assert.equal((await worker.handleProductionWorker(request({ action: 'completed', job_id: job.id, lease_token: job.lease_token, data: beats }))).status, 200);
assert.deepEqual(events.at(-1).data.source, source);
console.log('PASS Worker新协议及节拍直接结案，原素材由服务端绑定，不生成无用上传凭据');
const { publicProductionJob } = await loadEdge('supabase/functions/_shared/production-jobs.ts', 'edit-public');
let signed = 0;
const removed = await publicProductionJob({ storage: { from: () => ({ createSignedUrl: async () => {
  signed++; return { error: new Error('deleted') };
} }) } }, { ...job, status: 'completed', result: { media_deleted: true } });
assert.equal(signed, 0); assert.equal(removed.result.media_deleted, true);
assert.equal(removed.edit_request.source.url, source.url);
console.log('PASS 源素材清理后仍可读取终态回执，原输入只返回稳定引用，不续签已删除对象');
