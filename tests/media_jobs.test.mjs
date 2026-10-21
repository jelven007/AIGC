import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'e'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
let user = { id: uid }, job, events = [], uploadFailure = false, capturedUpload, configRows = {}, versions = {}, clone;
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    const filters = {};
    const query = {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; },
      maybeSingle: async () => ({ data: table === 'model_configs' ? configRows[filters.slot]
        : table === 'voice_clones' ? clone : null }),
      single: async () => ({ data: table === 'model_config_versions' ? versions[filters.id] : clone }),
    };
    return query;
  },
  storage: { from: () => ({
    createSignedUrl: async path => ({ data: { signedUrl: `https://db.example/storage/v1/object/sign/materials/${path}?token=temporary` } }),
    upload: async (path, blob) => { capturedUpload = { path, blob }; return { error: uploadFailure ? new Error('outage') : null }; },
  }) },
  async rpc(name, args) {
    if (name === 'can_read_media') return { data: args.p_path.startsWith(uid + '/') };
    if (name === 'claim_production_job') return { data: job };
    if (name === 'update_production_job') {
      events.push({ event: args.p_event, data: args.p_data });
      if (args.p_event === 'checkpoint') job.evidence = args.p_data;
      if (args.p_event === 'resolution') job.resolution = args.p_data;
      if (args.p_event === 'completed') job.status = 'completed';
      return { data: job };
    }
    throw new Error('unexpected RPC ' + name);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'media-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'media-catalog');
const core = await loadEdge('supabase/functions/_shared/media-jobs.ts', 'media-core');
const api = await loadEdge('supabase/functions/production-jobs/index.ts', 'media-api');
async function config(slot, settings = {}) {
  const id = slot + '-old';
  versions[id] = { id, slot, settings: { ...defaultSettings(slot), ...settings },
    key_ciphertext: await registry.encryptKey(slot, 'private-key') };
  configRows[slot] = { enabled: true, current_version_id: id };
  return id;
}
async function reset(kind, payload, settings) {
  events = []; uploadFailure = false;
  job = { id: crypto.randomUUID(), user_id: uid, request_key: crypto.randomUUID(), kind, status: 'running',
    created_at: new Date().toISOString(), lease_token: crypto.randomUUID(), payload,
    model_config_version_id: await config(core.MEDIA_JOB_SLOTS[kind], settings) };
}
const own = name => `https://db.example/storage/v1/object/authenticated/materials/${uid}/${name}`;
const req = body => new Request('https://db.example/functions/v1/production-jobs', { method: 'POST',
  headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await api.handleProductionJobs(req({ action: 'create', kind: 'voice_clone',
  request_key: crypto.randomUUID(), input: { name: '我的声音', audio_url: own('voice.wav'), filename: 'voice.wav' } }))).status, 400);
assert.equal((await api.handleProductionJobs(req({ action: 'create', kind: 'asr',
  request_key: crypto.randomUUID(), input: { audio_url: own('voice.wav').replace(uid, 'other'), filename: 'voice.wav' } }))).status, 400);
user = null; assert.equal((await api.handleProductionJobs(req({ action: 'voices' }))).status, 401); user = { id: uid };
console.log('PASS 计费前输入/授权校验、跨用户拒绝和登录鉴权');

await reset('tts', { input: '商品介绍', voice: '', speed: 1, response_format: 'mp3' },
  { endpoint: 'https://audio.example/speech', model: 'old-tts', voice: 'default-voice' });
configRows['audio.tts'] = { enabled: false, current_version_id: 'new-and-disabled' };
let submissions = 0;
globalThis.fetch = async (url, options) => {
  submissions++; const body = JSON.parse(options.body);
  assert.equal(body.model, 'old-tts'); assert.equal(body.voice, 'default-voice');
  assert.equal(options.headers.Authorization, 'Bearer private-key');
  return new Response(new Uint8Array([0x49, 0x44, 0x33, 0, 0]));
};
uploadFailure = true;
await core.processMediaJob(db, 'tts');
assert.equal(events.at(-1).event, 'retry'); assert.ok(job.evidence.audio_b64);
uploadFailure = false; await core.processMediaJob(db, 'tts');
assert.equal(submissions, 1); assert.equal(events.at(-1).event, 'completed');
assert.match(capturedUpload.path, /media-jobs/);
console.log('PASS 配音绑定旧版本，禁用不影响在途任务，归档故障不重复提交');

await reset('asr', { audio_url: own('voice.wav'), filename: 'voice.wav', language: 'zh' },
  { endpoint: 'https://audio.example/asr', model: 'whisper-1' });
globalThis.fetch = async (url, options) => {
  if (options.method !== 'POST') return new Response('RIFF-audio', { headers: { 'content-type': 'audio/wav' } });
  assert.equal(options.body.get('model'), 'whisper-1'); assert.equal(options.body.get('response_format'), 'verbose_json');
  assert.equal(options.body.get('file').name, 'voice.wav');
  return Response.json({ text: '商品真实转录', segments: [{ start: 0, end: 2, text: '商品真实转录' }, { start: -1, end: 1, text: 'bad' }] });
};
await core.processMediaJob(db, 'asr');
assert.equal(events.at(-1).data.text, '商品真实转录'); assert.equal(events.at(-1).data.segments.length, 1);
job.resolution = undefined; job.evidence = null; job.status = 'running';
versions[job.model_config_version_id].settings.protocol = 'step-asr';
globalThis.fetch = async (url, options) => options.method !== 'POST'
  ? new Response('RIFF-audio', { headers: { 'content-type': 'audio/wav' } })
  : new Response('data: {"text":"分块识别"}\n\ndata: [DONE]\n\n');
await core.processMediaJob(db, 'asr'); assert.equal(events.at(-1).data.text, '分块识别');
console.log('PASS 私有音频读取、OpenAI真实分段和Step SSE协议');

await reset('voice_clone', { name: '我的声音', audio_url: own('sample.wav'), filename: 'sample.wav', consent: true });
globalThis.fetch = async (url, options) => {
  if (options.method !== 'POST') return new Response('RIFF-sample', { headers: { 'content-type': 'audio/wav' } });
  assert.equal(String(url), 'https://api.elevenlabs.io/v1/voices/add');
  assert.equal(options.headers['xi-api-key'], 'private-key'); assert.equal(options.body.get('name'), '我的声音');
  assert.equal(options.body.getAll('files').length, 1);
  return Response.json({ voice_id: 'real-voice', requires_verification: false });
};
await core.processMediaJob(db, 'voice_clone');
assert.equal(events.at(-1).data.voice_id, 'real-voice');
console.log('PASS ElevenLabs即时克隆Multipart与验证状态保留');

clone = { id: crypto.randomUUID(), user_id: uid, provider_voice_id: 'real-voice', requires_verification: false,
  model_config_version_id: job.model_config_version_id };
await reset('tts', { input: '克隆配音', voice_clone_id: clone.id, speed: 1, response_format: 'mp3' },
  { endpoint: 'https://audio.example/speech', model: 'base-tts' });
job.model_config_version_id = clone.model_config_version_id;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://api.elevenlabs.io/v1/text-to-speech/real-voice');
  assert.equal(JSON.parse(options.body).model_id, 'eleven_multilingual_v2');
  assert.equal(options.headers['xi-api-key'], 'private-key');
  return new Response('ID3audio');
};
await core.processMediaJob(db, 'tts'); assert.equal(events.at(-1).event, 'completed');
console.log('PASS 克隆配音使用原账号凭据与模型版本，不接受浏览器供应商voice_id');

await reset('avatar', { image_url: own('person.png'), audio_url: own('speech.mp3'), title: '口播', consent: true });
submissions = 0;
globalThis.fetch = async (url, options) => {
  if (options.method === 'POST') {
    submissions++; assert.equal(options.headers.Authorization, 'Basic private-key');
    const body = JSON.parse(options.body); assert.equal(body.script.type, 'audio'); assert.match(body.script.audio_url, /temporary/);
    return Response.json({ id: 'tlk-original', status: 'created' });
  }
  if (String(url).includes('/talks/')) return Response.json({ status: 'done', result_url: 'https://result.example/output.mp4', duration: 3 });
  return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
};
uploadFailure = true; await core.processMediaJob(db, 'avatar'); assert.equal(events.at(-1).event, 'retry');
uploadFailure = false; await core.processMediaJob(db, 'avatar');
assert.equal(submissions, 1); assert.equal(events.at(-1).event, 'completed'); assert.equal(events.at(-1).data.duration, 3);
console.log('PASS D-ID照片口播Basic、原任务ID查询和成片归档恢复');

await reset('lipsync', { video_url: own('person.mp4'), audio_url: own('speech.mp3'), title: '同步', consent: true });
globalThis.fetch = async (url, options) => {
  if (options.method === 'POST') {
    assert.equal(options.headers['Idempotency-Key'], job.id);
    assert.equal(options.headers['x-api-key'], 'private-key');
    assert.deepEqual(JSON.parse(options.body).input.map(item => item.type), ['video', 'audio']);
    return Response.json({ id: 'sync-original', status: 'PENDING' });
  }
  return Response.json({ status: 'PROCESSING' });
};
await core.processMediaJob(db, 'lipsync'); assert.equal(events.at(-1).data.waiting, true);
globalThis.fetch = async () => Response.json({ status: 'FAILED', error: 'private provider detail' });
await core.processMediaJob(db, 'lipsync'); assert.equal(events.at(-1).event, 'failed');
assert.ok(!events.at(-1).data.error.includes('private'));
console.log('PASS Sync固定幂等标识、异步状态和确定失败返还事件');

await reset('tts', { input: '口播', voice: 'voice', response_format: 'mp3' },
  { endpoint: 'https://audio.example/speech', model: 'tts' });
globalThis.fetch = async () => { throw new Error('network after accepted'); };
await core.processMediaJob(db, 'tts'); assert.equal(events.at(-1).event, 'unknown');
job.evidence = null; job.resolution = undefined;
globalThis.fetch = async () => new Response('sensitive provider content', { status: 422 });
await core.processMediaJob(db, 'tts'); assert.equal(events.at(-1).event, 'failed');
assert.equal(events.at(-2).event, 'resolution'); assert.ok(!events.at(-1).data.error.includes('sensitive'));
console.log('PASS 受理未知禁止重发，明确拒绝保存退款证据及错误脱敏');
console.log('8 groups passed');
