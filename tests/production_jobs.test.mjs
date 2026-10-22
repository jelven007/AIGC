import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
let user = { id: uid }, job, configKey, connection, imageSettings, modelCalls = 0, uploadFailure = false, events = [], taskUpdates = [];
let createError = null;
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
      update(value) { if (table === 'publish_tasks') taskUpdates.push(value); return this; },
      maybeSingle: async () => ({ data: table === 'model_configs' ? { enabled: true, current_version_id: 'image-version' } : null }),
      single: async () => ({ data: table === 'platform_connections' ? connection
        : { id: 'image-version', slot: 'image.primary', key_ciphertext: configKey,
          settings: imageSettings } }),
      then(resolve) { resolve({ data: [], error: null }); },
    };
    return query;
  },
  storage: { from() { return {
    createSignedUrl: async path => ({ data: { signedUrl: `https://db.example/storage/v1/object/sign/materials/${path}?token=short-lived` } }),
    upload: async () => ({ error: uploadFailure ? new Error('storage outage') : null }),
  }; } },
  async rpc(name, args) {
    if (name === 'create_production_job') return { error: createError };
    if (name === 'can_read_media') return { data: args.p_path.startsWith(uid + '/') || args.p_path.startsWith(`generated-images/${uid}/`) };
    if (name === 'claim_production_job') return { data: job };
    if (name === 'update_production_job') {
      events.push({ event: args.p_event, data: args.p_data });
      if (args.p_event === 'checkpoint') job.evidence = args.p_data;
      if (args.p_event === 'resolution') job.resolution = args.p_data;
      if (args.p_event === 'completed') job.status = 'completed';
      if (args.p_event === 'unknown') job.status = 'unknown';
      return { data: job };
    }
    throw new Error(`unexpected RPC ${name}`);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'production-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'production-catalog');
imageSettings = { ...defaultSettings('image.primary'), protocol: 'openai-images', endpoint: 'https://model.example/images', model: 'configured-image' };
configKey = await registry.encryptKey('image.primary', 'private-key');
const media = await loadEdge('supabase/functions/_shared/private-media.ts', 'production-media');
const production = await loadEdge('supabase/functions/_shared/production-jobs.ts', 'production-core');
const api = await loadEdge('supabase/functions/production-jobs/index.ts', 'production-api');
const platforms = await loadEdge('supabase/functions/_shared/platform-jobs.ts', 'production-platforms');
const request = body => new Request('https://db.example/functions/v1/production-jobs', {
  method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const own = `https://db.example/storage/v1/object/sign/materials/${uid}/image.png?token=expired`;
assert.equal(media.canonicalMediaTree(own, uid), `https://db.example/storage/v1/object/authenticated/materials/${uid}/image.png`);
assert.match(await media.signedMedia(db, own, uid), /token=short-lived/);
await assert.rejects(() => media.signedMedia(db, own.replace(uid, 'other-user'), uid), /无权/);
events = [];
const denied = await api.handleProductionJobs(request({ action: 'create', kind: 'image', request_key: crypto.randomUUID(),
  input: { prompt: '商品', reference_image: own.replace(uid, 'other-user') } }));
assert.equal(denied.status, 400); assert.equal(events.length, 0);
user = null;
assert.equal((await api.handleProductionJobs(request({ action: 'list' }))).status, 401);
user = { id: uid };
assert.equal((await api.handleProductionJobs(request({ action: 'create', kind: 'render', request_key: crypto.randomUUID(), input: { version: 999 } }))).status, 400);
console.log('PASS 私有签名续期、跨用户拒绝、计费前授权与工程参数错误');
for (const [message, status] of [['账号的新计费任务已受限，可通过工单申诉', 403], ['团队日积分预算不足', 429]]) {
  createError = { message };
  const response = await api.handleProductionJobs(request({ action: 'create', kind: 'image', request_key: crypto.randomUUID(), input: { prompt: '真实图片' } }));
  assert.equal(response.status, status);
  assert.equal((await response.json()).outcome, 'rejected');
  assert.equal(modelCalls, 0);
}
createError = null;
console.log('PASS 图片账号限制/团队预算为明确403/429，零供应商调用与零伪退款');

job = { id: crypto.randomUUID(), user_id: uid, request_key: crypto.randomUUID(), kind: 'image', status: 'running',
  lease_token: crypto.randomUUID(), model_config_version_id: 'image-version', payload: { prompt: '商品', size: '1024x1024' } };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9sAAAAASUVORK5CYII=';
globalThis.fetch = async () => { modelCalls++; return Response.json({ data: [{ b64_json: png }] }); };
uploadFailure = true; events = [];
await production.processImageJob(db);
assert.equal(events.filter(event => event.event === 'checkpoint').length, 1);
assert.equal(events.at(-1).event, 'retry');
uploadFailure = false;
await production.processImageJob(db);
assert.equal(modelCalls, 1); assert.equal(events.at(-1).event, 'completed');
const published = await production.publicProductionJob(db, { ...job, result: { url: own } });
assert.equal(published.payload, undefined); assert.equal(published.evidence, undefined); assert.match(published.result.url, /short-lived/);
console.log('PASS 图片归档故障恢复仅调用一次模型，查询不暴露任务证据');

job = { ...job, status: 'running', evidence: null, resolution: undefined };
events = []; globalThis.fetch = async () => { throw new TypeError('network failed after submission'); };
await production.processImageJob(db);
assert.equal(events.at(-1).event, 'unknown');
job = { ...job, status: 'running' }; events = [];
globalThis.fetch = async () => new Response('rejected', { status: 422 });
await production.processImageJob(db);
assert.equal(events.at(-1).event, 'failed'); assert.equal(events.at(-2).event, 'resolution');
console.log('PASS 上游受理未知禁止重发，确定拒绝持久化退款证据');

assert.deepEqual(platforms.videoCounts({ statistics: { play_count: 31, digg_count: 0, comment_count: -1 } }, 'douyin'),
  { view_count: 31, like_count: 0, comment_count: null, share_count: null });
assert.equal(platforms.videoCounts({ view_count: 'unknown' }, 'tiktok').view_count, null);
connection = { id: 'connection', platform: 'tiktok', open_id: 'creator', status: 'active',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  token_ciphertext: await registry.encryptKey(`platform-connection:${uid}:tiktok:creator`, JSON.stringify({ access_token: 'platform-token' })) };
job = { id: crypto.randomUUID(), user_id: uid, kind: 'publish', status: 'running', lease_token: crypto.randomUUID(),
  payload: { connection_id: 'connection', source_url: own.replace('image.png', 'video.mp4'), title: '商品', description: '', tags: [], options: {} },
  evidence: { platform: 'tiktok', publish_id: 'same-publish-id', uploaded: false, upload_url: 'https://open-upload.tiktokapis.com/upload' } };
let uploadRange, initializations = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/init/')) initializations++;
  if (String(url).includes('/status/fetch/')) {
    assert.equal(JSON.parse(options.body).publish_id, 'same-publish-id');
    return Response.json({ error: { code: 'ok' }, data: { status: 'PROCESSING_UPLOAD', uploaded_bytes: 2 } });
  }
  if (String(url).includes('open-upload')) {
    uploadRange = options.headers['Content-Range']; return new Response(null, { status: 201 });
  }
  return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'video/mp4' } });
};
events = []; taskUpdates = [];
await platforms.processPublishJob(db);
assert.equal(initializations, 0); assert.equal(uploadRange, 'bytes 2-3/4');
assert.equal(events.at(-1).data.waiting, true); assert.equal(taskUpdates.at(-1).status, 'submitted');
globalThis.fetch = async () => Response.json({ error: { code: 'ok' }, data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['real-id'] } });
await platforms.processPublishJob(db);
assert.equal(taskUpdates.at(-1).status, 'published'); assert.equal(taskUpdates.at(-1).platform_video_id, 'real-id');
console.log('PASS TikTok 按原ID断点上传，审核完成后更新真实作品ID');

connection = { ...connection, platform: 'douyin',
  token_ciphertext: await registry.encryptKey(`platform-connection:${uid}:douyin:creator`, JSON.stringify({ access_token: 'platform-token' })) };
job = { ...job, resolution: undefined, status: 'running', evidence: { platform: 'douyin', item_id: '@real-item' } };
let queried;
globalThis.fetch = async (url, options) => {
  queried = { url, body: JSON.parse(options.body) };
  return Response.json({ data: { error_code: 0, list: [{ item_id: '@real-item', video_status: 1, is_reviewed: true, share_url: 'https://www.douyin.com/video/real' }] } });
};
await platforms.processPublishJob(db);
assert.match(queried.url, /video_data/); assert.deepEqual(queried.body, { item_ids: ['@real-item'] });
assert.equal(taskUpdates.at(-1).status, 'published');
console.log('PASS 抖音按官方作品ID查询公开状态与真实指标映射');
console.log('7 groups passed');
