import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service' };
let user = { id: 'audio-user' }, calls = 0;
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
globalThis.__createClient = () => ({ auth: { getUser: async () => ({ data: { user } }) } });
globalThis.fetch = async () => { calls++; throw new Error('legacy endpoint must never submit'); };
const { handleAudio } = await loadEdge('supabase/functions/_shared/audio-handler.ts', 'audio-retired');
const request = () => new Request('https://db.example/audio', { method: 'POST',
  headers: { Authorization: 'Bearer user' }, body: JSON.stringify({ input: '商品介绍' }) });
assert.equal((await handleAudio(request())).status, 410);
user = null; assert.equal((await handleAudio(request())).status, 401);
assert.equal(calls, 0);
console.log('PASS 旧同步音频入口410，无免费计费旁路及供应商提交');
console.log('1 group passed');
