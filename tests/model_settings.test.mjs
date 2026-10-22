import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64) };
let user = { id: 'admin-id', app_metadata: { role: 'admin' } };
let dbRows = [], versions = [], calls = [], conflict = false, dns = ['8.8.8.8'];
let selectedSlot, selectedVersion;
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    return {
      select() { return this; },
      eq(key, value) { if (key === 'slot') selectedSlot = value; if (key === 'id') selectedVersion = value; return this; },
      maybeSingle: async () => ({ data: dbRows.find(row => row.slot === selectedSlot) }),
      single: async () => ({ data: versions.find(row => row.id === selectedVersion && row.slot === selectedSlot) }),
      then(resolve) { return Promise.resolve({ data: dbRows, error: null }).then(resolve); },
    };
  },
  rpc: async (name, params) => {
    calls.push({ name, params });
    return conflict ? { error: { message: '配置已被更新' } } : { data: 'new-version', error: null };
  },
};
globalThis.__createClient = () => db;
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => dns };
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'settings-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'settings-catalog');
const { handleModelSettings } = await loadEdge('supabase/functions/model-settings/index.ts', 'settings-handler');
const { generateImage } = await loadEdge('supabase/functions/_shared/image-provider.ts', 'settings-image');
const settings = { ...defaultSettings('text.primary'), model: 'ep-text',
  test_endpoint: 'https://models.example/v1/models' };
const key = 'private-api-key';
const cipher = await registry.encryptKey('text.primary', key);
assert.equal(await registry.decryptKey('text.primary', cipher), key);
await assert.rejects(() => registry.decryptKey('text.fallback', cipher));
assert.notEqual(await registry.encryptKey('text.primary', key), cipher);
console.log('PASS AES-GCM 随机 IV 与配置项绑定');
for (const endpoint of ['http://example.com', 'https://127.0.0.1', 'https://10.1.2.3',
  'https://169.254.169.254/latest', 'https://[::1]', 'https://user:pass@api.example',
  'https://api.example/?api_key=private', 'https://metadata.google.internal', 'https://2130706433']) {
  assert.throws(() => registry.publicHttpsUrl(endpoint), endpoint);
}
dns = ['10.0.0.1']; await assert.rejects(() => registry.validateEndpoint('https://api.example'));
dns = ['8.8.8.8'];
console.log('PASS URL 与 DNS 拒绝内网、元数据及凭据');
const request = body => new Request('https://db.example/functions/v1/model-settings', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body),
});
user = null;
assert.equal((await handleModelSettings(request({ action: 'list' }))).status, 401);
user = { id: 'regular', app_metadata: {}, user_metadata: { role: 'admin' } };
for (const action of ['list', 'save', 'import', 'test']) {
  assert.equal((await handleModelSettings(request({ action }))).status, 403);
}
assert.equal(calls.length, 0);
console.log('PASS 服务端管理员鉴权，user_metadata 不授予权限');
user = { id: 'admin-id', app_metadata: { role: 'admin' } };
dbRows = [{ slot: 'text.primary', enabled: true, current_version_id: 'old-version',
  model_config_versions: { settings, key_ciphertext: cipher } }];
versions = [{ id: 'old-version', slot: 'text.primary', settings, key_ciphertext: cipher }];
const listed = await (await handleModelSettings(request({ action: 'list' }))).text();
assert.ok(!listed.includes(key) && !listed.includes(cipher)); assert.ok(listed.includes('"has_key":true'));
const catalog = await (await handleModelSettings(request({ action: 'catalog' }))).text();
assert.ok(!catalog.includes('endpoint') && !catalog.includes('key_ciphertext'));
assert.equal(JSON.parse(catalog).configs.filter(item => item.version_id !== undefined).length, 1);
console.log('PASS 管理列表与用户目录都不回传密钥');
let response = await handleModelSettings(request({ action: 'save', slot: 'text.primary',
  version_id: null, settings, enabled: true, api_key: key }));
assert.equal(response.status, 200);
assert.equal(calls.at(-1).params.p_actor, 'admin-id');
assert.notEqual(calls.at(-1).params.p_key_ciphertext, key);
assert.equal(await registry.decryptKey('text.primary', calls.at(-1).params.p_key_ciphertext), key);
conflict = true;
assert.equal((await handleModelSettings(request({ action: 'save', slot: 'text.primary',
  version_id: null, settings, enabled: true }))).status, 409);
conflict = false;
console.log('PASS 保存加密且并发冲突返回 409');
let fetches = [];
globalThis.fetch = async (url, init) => { fetches.push({ url, init }); return new Response('secret-response'); };
response = await handleModelSettings(request({ action: 'test', slot: 'text.primary' }));
assert.equal(response.status, 200); assert.equal(fetches[0].init.method, 'GET'); assert.equal(fetches[0].init.redirect, 'error');
assert.ok(!(await response.text()).includes('secret-response'));
console.log('PASS 连接检查只读且不回显上游正文');
dbRows[0].enabled = false;
await assert.rejects(() => registry.resolveModel('text.primary', db));
const old = await registry.resolveModel('text.primary', db, 'old-version');
assert.equal(old.headers.Authorization, `Bearer ${key}`);
console.log('PASS 禁用后旧版本仍可解析');
dbRows = [{ slot: 'image.primary', enabled: true, current_version_id: 'image-version' }];
const imageSettings = { ...defaultSettings('image.primary'), endpoint: 'https://images.example/v1/images/generations', model: 'image-real' };
versions = [{ id: 'image-version', slot: 'image.primary', settings: imageSettings,
  key_ciphertext: await registry.encryptKey('image.primary', key) }];
globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '没有图片' } }] });
await assert.rejects(() => generateImage(db, 'user-id', { prompt: '商品' }), /未返回图片/);
globalThis.fetch = async () => new Response('private raw upstream error', { status: 401 });
await assert.rejects(() => generateImage(db, 'user-id', { prompt: '商品' }), error => error.message === '模型返回 HTTP 401');
await assert.rejects(() => generateImage(db, 'user-id', { prompt: '商品', reference_image: 'https://ref.example/image.png' }), /不支持参考图/);
console.log('PASS 图片失败明确报错，无模拟成功或上游密钥泄露');
let savedImage;
db.storage = { from: () => ({
  upload: async (path, blob) => { savedImage = { path, blob }; return { error: null }; },
  getPublicUrl: path => ({ data: { publicUrl: `https://storage.example/${path}` } }),
}) };
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
globalThis.fetch = async () => Response.json({ data: [{ b64_json: pngBytes.toString('base64') }] });
const image = await generateImage(db, 'user-id', { prompt: '商品' });
assert.match(image.image_url, /^https:\/\/db.example\/storage\/v1\/object\/authenticated\/materials\/generated-images\/user-id\//);
assert.equal(savedImage.blob.size, 11);
versions[0].settings = { ...imageSettings, protocol: 'chat-image' };
fetches = [];
globalThis.fetch = async (url, init) => {
  fetches.push({ url, init });
  return url === imageSettings.endpoint
    ? Response.json({ choices: [{ message: { content: '![图](https://cdn.example/image.png)' } }] })
    : new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } });
};
await generateImage(db, 'user-id', { prompt: '商品', reference_image: 'https://ref.example/image.png' });
assert.equal(JSON.parse(fetches[0].init.body).messages[0].content[1].image_url.url, 'https://ref.example/image.png');
assert.equal(fetches[1].init.headers, undefined);
globalThis.fetch = async () => Response.json({ data: [{ b64_json: Buffer.from('not-an-image').toString('base64') }] });
await assert.rejects(() => generateImage(db, 'user-id', { prompt: '商品' }), /不是有效图片/);
console.log('PASS 两种图片协议真实归档，参考图传递且下载不携带模型凭据');
console.log('9 groups passed');
