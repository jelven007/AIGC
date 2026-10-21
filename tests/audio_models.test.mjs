import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'b'.repeat(64) };
let user = { id: 'audio-user' }, activeSlot, settings, ciphertext;
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  rpc: async () => ({ data: true }),
  from() { return {
    select() { return this; }, eq(key, value) { if (key === 'slot') activeSlot = value; return this; },
    maybeSingle: async () => ({ data: { enabled: true, current_version_id: 'audio-version' } }),
    single: async () => ({ data: { id: 'audio-version', slot: activeSlot, settings, key_ciphertext: ciphertext } }),
  }; },
};
globalThis.__createClient = () => db;
const { encryptKey } = await loadEdge('supabase/functions/_shared/model-registry.ts', 'audio-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'audio-catalog');
const { handleAudio } = await loadEdge('supabase/functions/_shared/audio-handler.ts', 'audio-handler');
const req = body => new Request('https://db.example/audio', { method: 'POST',
  headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
settings = { ...defaultSettings('audio.tts'), endpoint: 'https://audio.example/speech', model: 'configured-tts', voice: 'configured-voice' };
ciphertext = await encryptKey('audio.tts', 'private');
let payload;
globalThis.fetch = async (url, init) => {
  payload = JSON.parse(init.body); assert.equal(init.redirect, 'error');
  return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
};
assert.equal((await handleAudio(req({ input: '商品介绍' }))).status, 200);
assert.equal(payload.model, 'configured-tts'); assert.equal(payload.voice, 'configured-voice');
user = null;
assert.equal((await handleAudio(req({ input: 'test' }))).status, 401); user = { id: 'audio-user' };
settings = { ...defaultSettings('audio.asr'), endpoint: 'https://audio.example/asr', model: 'configured-asr' };
ciphertext = await encryptKey('audio.asr', 'private');
const fileRequest = () => {
  const form = new FormData(); form.append('file', new Blob(['wav-data'], { type: 'audio/wav' }), 'audio.wav');
  return new Request('https://db.example/audio?action=asr', { method: 'POST', headers: { Authorization: 'Bearer user' }, body: form });
};
globalThis.fetch = async (url, init) => {
  assert.equal(init.body.get('model'), 'configured-asr');
  return Response.json({ text: '商品语音' });
};
assert.equal((await (await handleAudio(fileRequest())).json()).text, '商品语音');
settings.protocol = 'step-asr';
globalThis.fetch = async (url, init) => {
  payload = JSON.parse(init.body);
  return new Response('data: {"text":"识别结果"}\n\ndata: [DONE]\n\n');
};
assert.equal((await (await handleAudio(fileRequest())).json()).text, '识别结果');
assert.equal(payload.audio.input.transcription.model, 'configured-asr');
assert.equal(payload.audio.input.format.type, 'wav');
globalThis.fetch = async () => new Response('sensitive upstream', { status: 403 });
const failed = await handleAudio(fileRequest());
assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('sensitive'));
console.log('PASS 音频 JWT、配置模型/音色、OpenAI 文件、Step SSE 与错误脱敏');
console.log('1 group passed');
