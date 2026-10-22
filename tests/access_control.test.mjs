import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
let consumed = { user_id: uid, key_id: 'key' }, user = { id: uid, email_confirmed_at: '2026-10-21' };
let insertFail = false, revokeFail = false, deleteFail = false, removalsFail = false;
let inserted, seenScope, deleted, claimed = [];
const deletionReceipts = [];
const keyRecord = { id: 'key', name: '生产', key_prefix: 'ak_live_', scopes: ['video:read'], is_active: true };
const db = {
  auth: { getUser: async () => ({ data: { user } }), admin: { getUserById: async id => ({ data: { user: { ...user, id } } }) } },
  from(table) {
    return {
      select() { return this; }, eq() { return this; }, order() { return this; },
      insert(value) { inserted = value; return this; }, update() { return this; },
      single: async () => ({ data: insertFail ? null : keyRecord, error: insertFail ? new Error('database down') : null }),
      maybeSingle: async () => table === 'materials' ? { data: {
        id: 'material', user_id: uid, url: `https://db.example/storage/v1/object/sign/materials/${uid}/%E5%95%86%E5%93%81%20%E5%9B%BE.png?token=expired`,
      } } : { data: keyRecord, error: revokeFail ? new Error('database down') : null },
      then(resolve) { resolve({ data: [keyRecord] }); },
    };
  },
  rpc: async (name, args) => {
    if (name === 'consume_api_key') { seenScope = args.p_scope; return { data: consumed }; }
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'delete_owned_material') { deleted = args; return { error: deleteFail ? { message: '素材仍被引用' } : null }; }
    if (name === 'claim_media_deletions') return { data: claimed };
    if (name === 'finish_media_deletion') {
      assert.equal(args.p_lease, claimed[0].lease_token);
      deletionReceipts.push(args);
      return { data: true };
    }
    throw new Error(name);
  },
  storage: { from() { return { remove: async () => ({ error: removalsFail ? new Error('storage outage') : null }) }; } },
};
globalThis.__createClient = () => db;
const auth = await loadEdge('supabase/functions/_shared/auth.ts', 'access-auth');
const keys = await loadEdge('supabase/functions/api-keys/index.ts', 'access-keys');
const assets = await loadEdge('supabase/functions/material-assets/index.ts', 'access-assets');
const cleanup = await loadEdge('supabase/functions/_shared/media-cleanup.ts', 'access-cleanup');
const token = `ak_live_${'a'.repeat(64)}`;
const request = (body = {}, bearer = 'user') => new Request('https://db.example/functions/v1/video-jobs', {
  method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
assert.equal((await auth.authenticateRequest(request({}, token))).status, 401);
assert.equal((await auth.authenticateRequest(request({}, token), 'video:read')).userId, uid);
assert.equal(seenScope, 'video:read');
for (const status of [401, 403, 429]) {
  consumed = { error: status === 403 ? 'scope_denied' : status === 429 ? 'rate_limited' : 'invalid_key', status };
  assert.equal((await auth.authenticateRequest(request({}, token), 'video:create')).status, status);
}
assert.equal(await auth.hashApiKey('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
consumed = { user_id: uid, key_id: 'key' };
assert.equal((await keys.handleApiKeys(request({ action: 'list' }, token))).status, 401);
console.log('PASS API Key 按权限鉴权、错误状态、SHA256摘要与拒绝密钥管理旁路');
const invalid = await keys.handleApiKeys(request({ action: 'create', name: '生产', scopes: ['admin:*'], expires_in_days: 90 }));
assert.equal(invalid.status, 400); assert.equal(inserted, undefined);
const createBody = { action: 'create', name: '生产', scopes: ['video:read'], expires_in_days: 90 };
insertFail = true;
assert.equal((await keys.handleApiKeys(request(createBody))).status, 503);
insertFail = false;
const created = await keys.handleApiKeys(request(createBody));
assert.equal(created.status, 201);
const result = await created.json();
assert.match(result.raw_key, /^ak_live_[0-9a-f]{64}$/);
assert.equal(inserted.key_hash, await auth.hashApiKey(result.raw_key)); assert.equal(inserted.raw_key, undefined);
revokeFail = true;
assert.equal((await keys.handleApiKeys(request({ action: 'revoke', key_id: 'key' }))).status, 503);
revokeFail = false;
assert.equal((await keys.handleApiKeys(request({ action: 'revoke', key_id: 'key' }))).status, 200);
console.log('PASS 服务端签发只存摘要，创建/撤销故障不冒报成功');
const removed = await assets.handleMaterialAssets(request({ action: 'delete', material_id: 'material' }));
assert.equal(removed.status, 200);
assert.equal(deleted.p_path, `${uid}/商品 图.png`); assert.equal(deleted.p_bucket, 'materials');
deleteFail = true;
assert.equal((await assets.handleMaterialAssets(request({ action: 'delete', material_id: 'material' }))).status, 409);
claimed = [{ id: 'cleanup', bucket: 'materials', path: 'file', attempts: 1, lease_token: crypto.randomUUID() }];
removalsFail = true; assert.equal(await cleanup.processMediaDeletions(db), 0);
removalsFail = false; assert.equal(await cleanup.processMediaDeletions(db), 1);
assert.deepEqual(deletionReceipts.map(row => row.p_success), [false, true]);
console.log('PASS 删除签名URL去令牌和解码、引用冲突、清理故障可恢复');
