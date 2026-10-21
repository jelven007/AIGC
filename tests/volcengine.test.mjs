import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
let env = {};
let handler;
let enabled = true;
globalThis.Deno = { env: { get: name => env[name] }, serve: value => { handler = value; },
  resolveDns: async () => ['8.8.8.8'] };
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'volc-catalog');
env.MODEL_CONFIG_ENCRYPTION_KEY = '2'.repeat(64);
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'volc-registry');
const keys = {
  'video.ArkSeedance': await registry.encryptKey('video.ArkSeedance', 'private'),
  'text.primary': await registry.encryptKey('text.primary', 'private'),
};
let activeSlot;
globalThis.__createClient = () => ({
  auth: { getUser: async token => ({ data: { user: token === 'user' ? { id: 'user-id' } : null } }) },
  rpc: async () => ({ data: true, error: null }),
  from(table) {
    return {
      select() { return this; },
      eq(key, value) { if (key === 'slot') activeSlot = value; return this; },
      async maybeSingle() { return { data: { enabled, current_version_id: 'config-id' } }; },
      async single() { return { data: { id: 'config-id', slot: activeSlot,
        settings: { ...defaultSettings(activeSlot), model: activeSlot === 'text.primary' ? 'ep-text' : 'ep-video' },
        key_ciphertext: keys[activeSlot] } }; },
    };
  },
});
const video = await loadEdge('supabase/functions/_shared/video-providers.ts', 'volc-video');
const text = await loadEdge('supabase/functions/_shared/text-provider.ts', 'volc-text');
await loadEdge('supabase/functions/text-generation/index.ts', 'volc-handler');
const input = { prompt: '商品镜头', title: '商品', duration: 5, ratio: '9:16', resolution: '720P',
  reference_images: [], reference_videos: [] };

enabled = false;
await assert.rejects(() => video.providerConfig('ArkSeedance'));
enabled = true;
env = { MODEL_CONFIG_ENCRYPTION_KEY: '2'.repeat(64),
  SUPABASE_URL: 'https://backend.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const config = await video.providerConfig('ArkSeedance');
assert.equal(config.createUrl, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
assert.deepEqual(video.providerBody('ArkSeedance', input, config.model), {
  model: 'ep-video', content: [{ type: 'text', text: '商品镜头' }], duration: 5,
  resolution: '720p', ratio: '9:16', watermark: false, generate_audio: true,
});
assert.throws(() => video.validateVideoInput('ArkSeedance', {
  ...input, first_frame: 'https://assets.example/first.png', reference_images: ['https://assets.example/ref.png'],
}));
assert.throws(() => video.validateVideoInput('ArkSeedance', {
  ...input, last_frame: 'https://assets.example/last.png',
}));
console.log('PASS 方舟端点、模型与首尾帧互斥规格');

let calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ id: 'ark-task' }); };
assert.equal(await video.submitVideo(config, input), 'ark-task');
assert.equal(calls.length, 1);
globalThis.fetch = async url => {
  assert.equal(url, `${config.queryUrl}/ark-task`);
  return Response.json({ status: 'succeeded', content: { video_url: 'https://cdn.example/video.mp4' } });
};
assert.equal((await video.queryVideo(config, 'ark-task')).url, 'https://cdn.example/video.mp4');
console.log('PASS 方舟创建与查询协议');

calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return Response.json({ choices: [{ message: { content: '营销脚本' } }] });
};
assert.equal(await text.generateText([{ role: 'user', content: '商品' }]), '营销脚本');
assert.equal(calls[0].url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
assert.equal(JSON.parse(calls[0].options.body).model, 'ep-text');
console.log('PASS 服务端方舟文本配置');

const request = (body, token = 'user') => new Request('https://backend.example/text-generation', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
const body = { messages: [{ role: 'user', content: '测试' }] };
assert.equal((await handler(request(body, 'anon'))).status, 401);
assert.equal((await handler(request({ ...body, max_tokens: 999999 }))).status, 400);
enabled = false;
assert.equal((await handler(request(body))).status, 503);
enabled = true;
globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: [DONE]\n\n');
const response = await handler(request(body));
assert.equal(response.status, 200);
assert.equal(response.headers.get('content-type'), 'text/event-stream');
console.log('PASS 文本 JWT、非法规格、缺配置与 SSE 响应');
console.log('4 groups passed');
