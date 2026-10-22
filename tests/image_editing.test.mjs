import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111', version = '44444444-4444-4444-8444-444444444444';
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'd'.repeat(64) })[name] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
function png(width = 1024, height = 1024, mask = false, alpha = null) {
  const chunk = (type, payload) => {
    const data = Buffer.concat([Buffer.from(type), payload]), result = Buffer.alloc(payload.length + 12); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    result.writeUInt32BE(payload.length); data.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    pixels[offset] = 50; pixels[offset + 1] = 150; pixels[offset + 2] = 100;
    pixels[offset + 3] = alpha ?? (mask && x < width / 4 ? 0 : 255);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
let config, key, job, events = [], creates = [], modelCalls = 0, archiveFailure = false, maskBytes = png(1024, 1024, true);
const sourceBytes = png(), own = name => `https://db.example/storage/v1/object/authenticated/materials/${uid}/${name}.png`;
let originalBytes = sourceBytes;
const db = {
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  from(table) {
    return { select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: table === 'model_configs' ? { enabled: true, current_version_id: version } : null }),
      single: async () => ({ data: { id: version, slot: 'image.primary', settings: config, key_ciphertext: key } }) };
  },
  storage: { from: () => ({
    createSignedUrl: async path => ({ data: { signedUrl: `https://db.example/storage/v1/object/sign/materials/${path}?token=renewed` } }),
    upload: async () => ({ error: archiveFailure ? new Error('archive failure') : null }),
  }) },
  async rpc(name, args) {
    if (name === 'can_read_media') return { data: args.p_path.startsWith(uid + '/') };
    if (name === 'create_production_job') {
      creates.push(args); return { data: { id: crypto.randomUUID(), user_id: uid, ...args, kind: 'image', payload: args.p_payload, result: null } };
    }
    if (name === 'claim_production_job') return { data: job };
    if (name === 'update_production_job') {
      events.push({ event: args.p_event, data: args.p_data });
      if (args.p_event === 'checkpoint') job.evidence = args.p_data;
      if (args.p_event === 'resolution') job.resolution = args.p_data;
      return { data: job };
    }
    throw new Error(name);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'image-edit-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'image-edit-catalog');
const { imageCapabilities } = await loadEdge('supabase/functions/_shared/image-contract.ts', 'image-edit-contract');
config = { ...defaultSettings('image.primary'), endpoint: 'https://model.example/v1/images/generations',
  edit_endpoint: 'https://model.example/v1/images/edits', model: 'gpt-image-1.5' };
key = await registry.encryptKey('image.primary', 'private-model-key');
assert.deepEqual(imageCapabilities(config), { reference: true, mask: true });
for (const change of [{ edit_endpoint: 'https://other.example/v1/images/edits' }, { model: 'unverified-model' },
  { edit_endpoint: 'https://model.example/another/edits' }, { protocol: 'chat-image' }]) {
  await assert.rejects(() => registry.validateSettings('image.primary', { ...config, ...change }, true), /编辑/);
}
console.log('PASS 官方编辑模型目录、同域同路径与旧未配置版本能力隔离');
let supplier;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/storage/')) return new Response(String(url).includes('mask.png') ? maskBytes : originalBytes, { headers: { 'Content-Type': 'image/png' } });
  modelCalls++; supplier = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
  return Response.json({ data: [{ b64_json: sourceBytes.toString('base64') }] });
};
const core = await loadEdge('supabase/functions/_shared/production-jobs.ts', 'image-edit-core');
const input = { mode: 'outpaint', prompt: '扩展自然光背景', size: '1024x1024', quality: 'low',
  reference_image: own('original'), mask_image: own('mask'), confirmed_credit_cost: 10, confirmed_model_version: version };
await core.createImageJob(db, uid, crypto.randomUUID(), input);
assert.equal(creates.length, 1); assert.equal(modelCalls, 0);
assert.ok(!JSON.stringify(creates[0]).includes('renewed')); assert.ok(!JSON.stringify(creates[0]).includes('data:image'));
console.log('PASS 创建前读取实际PNG与透明区域，数据库仅存稳定私有引用');
for (const candidate of [png(1024, 1024, true, 255), png(1024, 1024, true, 0), png(1024, 1024, true, 128), png(1536, 1024, true), Buffer.from('not png')]) {
  maskBytes = candidate;
  await assert.rejects(() => core.createImageJob(db, uid, crypto.randomUUID(), input), /掩码|PNG/);
}
maskBytes = png(1024, 1024, true);
originalBytes = sourceBytes.subarray(0, 45);
await assert.rejects(() => core.createImageJob(db, uid, crypto.randomUUID(), input), /损坏|不完整|PNG/);
originalBytes = sourceBytes;
await assert.rejects(() => core.createImageJob(db, uid, crypto.randomUUID(), { ...input, mask_image: own('mask').replace(uid, 'other') }), /无权/);
await assert.rejects(() => core.createImageJob(db, uid, crypto.randomUUID(), { ...input, mask_image: 'https://external.example/mask.png' }), /私有素材/);
await assert.rejects(() => core.createImageJob(db, uid, crypto.randomUUID(), { ...input, confirmed_credit_cost: undefined }), /确认/);
assert.equal(creates.length, 1); assert.equal(modelCalls, 0);
console.log('PASS 错尺寸/伪PNG/全透明/全保留/半透明/外部/越权掩码均在扣费前拒绝');
job = { id: crypto.randomUUID(), user_id: uid, kind: 'image', lease_token: crypto.randomUUID(),
  model_config_version_id: version, payload: input, evidence: null };
archiveFailure = true; await core.processImageJob(db);
assert.equal(modelCalls, 1); assert.equal(events.at(-1).event, 'retry');
assert.equal(supplier.url, config.edit_endpoint); assert.equal(supplier.body.model, 'gpt-image-1.5');
assert.equal(supplier.body.n, 1); assert.equal(supplier.body.output_format, 'png');
assert.match(supplier.body.images[0].image_url, /^data:image\/png;base64,/);
assert.match(supplier.body.mask.image_url, /^data:image\/png;base64,/);
assert.equal(supplier.headers.Authorization, 'Bearer private-model-key');
archiveFailure = false;
globalThis.fetch = async () => { throw new Error('checkpoint恢复不能读取原图或重调模型'); };
await core.processImageJob(db);
assert.equal(modelCalls, 1); assert.equal(events.at(-1).event, 'completed');
console.log('PASS 官方JSON编辑契约、原版本/一次调用、归档恢复无需源下载或供应商重发');
job = { ...job, evidence: null, resolution: undefined }; events = [];
globalThis.fetch = async (url) => {
  if (String(url).includes('/storage/')) return new Response(String(url).includes('mask.png') ? maskBytes : sourceBytes);
  throw new TypeError('post response lost');
};
await core.processImageJob(db); assert.equal(events.at(-1).event, 'unknown');
events = [];
globalThis.fetch = async (url) => String(url).includes('/storage/') ? new Response(String(url).includes('mask.png') ? maskBytes : sourceBytes)
  : new Response('private upstream detail', { status: 422 });
await core.processImageJob(db); assert.equal(events.at(-1).event, 'failed'); assert.equal(events.at(-2).event, 'resolution');
assert.ok(!JSON.stringify(events).includes('private upstream detail'));
console.log('PASS 编辑POST未知保留原任务，确定拒绝只保存安全结案证据');
config = { ...config, edit_endpoint: '' }; creates = [];
await assert.rejects(() => core.createImageJob(db, uid, crypto.randomUUID(), input), /能力/);
assert.equal(creates.length, 0);
console.log('6 groups passed');
