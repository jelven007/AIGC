import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111', key = '22222222-2222-4222-8222-222222222222';
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[name] }, serve() {} };
let user = { id: uid }, calls = [], failure = null, listFailure = false, filters = [];
const material = { id: key, name: '授权录音', type: 'audio', duration_sec: 2.5,
  url: `https://db.example/storage/v1/object/authenticated/materials/${uid}/uploads/${key}.wav` };
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  rpc: async (name, args) => {
    if (name === 'can_read_media') return { data: true };
    calls.push({ name, args }); return { data: { material, request_key: key }, error: failure };
  },
  from() {
    return { select() { return this; }, eq(...args) { filters.push(args); return this; }, order() { return this; },
      range: async () => ({ data: [material], count: 1, error: listFailure ? new Error('down') : null }) };
  },
  storage: { from() { return { createSignedUrl: async () => ({ data: { signedUrl: material.url.replace('/authenticated/', '/sign/') + '?token=fixture' } }) }; } },
};
globalThis.__createClient = () => db;
const { handleMaterialAssets } = await loadEdge('supabase/functions/material-assets/index.ts', 'material-register');
const request = body => new Request('https://db.example/functions/v1/material-assets', {
  method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const input = { name: material.name, type: 'audio', extension: 'wav', content_hash: 'a'.repeat(64),
  size: 4000, mime: 'audio/wav', source: 'recording', rights_confirmed: true, duration_sec: 2.5,
  url: 'https://attacker.example/foreign.wav', path: 'foreign/path.wav', user_id: key };
const created = await handleMaterialAssets(request({ action: 'register', request_key: key, input }));
assert.equal(created.status, 200); assert.match((await created.json()).material.url, /token=fixture/);
assert.equal(calls[0].args.p_user, uid);
assert.equal(calls[0].args.p_request.path, `${uid}/uploads/${key}.wav`);
assert.equal(calls[0].args.p_request.url, material.url);
assert.equal(calls[0].args.p_request.user_id, undefined);
console.log('PASS 用户身份、服务端路径和稳定引用，不信任客户端权属/URL/路径');
for (const change of [{ rights_confirmed: false }, { rights_confirmed: 'true' }, { size: 1.5 }, { size: 50 * 1024 * 1024 + 1 },
  { content_hash: null }, { mime: 'video/mp4' }, { duration_sec: null }, { duration_sec: 0 }, { source: 'unlicensed' }]) {
  assert.equal((await handleMaterialAssets(request({ action: 'register', request_key: key, input: { ...input, ...change } }))).status, 400);
}
assert.equal(calls.length, 1);
console.log('PASS 缺使用权、大小/类型/时长/指纹无效不进入登记事务');
for (const [message, status] of [['原素材尚未上传', 404], ['同一请求标识不能登记不同素材', 409],
  ['存储对象大小或媒体类型与登记不一致', 409], ['原素材已进入清理流程', 409], ['database unavailable', 503]]) {
  failure = { message };
  assert.equal((await handleMaterialAssets(request({ action: 'register', request_key: key, input }))).status, status);
}
failure = null;
const list = await handleMaterialAssets(request({ action: 'list', type: 'audio', offset: 30, limit: 30 }));
assert.equal(list.status, 200); assert.equal((await list.json()).total, 1);
assert.deepEqual(filters, [['user_id', uid], ['type', 'audio']]);
assert.equal((await handleMaterialAssets(request({ action: 'list', offset: -1 }))).status, 400);
listFailure = true;
assert.equal((await handleMaterialAssets(request({ action: 'list' }))).status, 503);
user = null;
assert.equal((await handleMaterialAssets(request({ action: 'register', request_key: key, input }))).status, 401);
assert.equal((await handleMaterialAssets(request({ action: 'list' }))).status, 401);
console.log('PASS 原上传故障分类、用户分页/音频过滤、数据库故障和失效身份');
