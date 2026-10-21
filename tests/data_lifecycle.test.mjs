import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: 'b'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, resolveDns: async () => ['8.8.8.8'], serve() {} };
let cipher, user = { id: uid }, failStorage = false, staleLease = false, removed = [], receipts = [], requests = [], status = 200, reply = { status: 'ok' };
const item = { id, user_id: uid, clone_id: id, bucket: 'materials', path: `${uid}/imports/old.png`, lease_token: 'current-lease' };
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    const filters = {};
    return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      single: async () => ({ data: table === 'voice_clones' ? { id, user_id: uid, revoked_at: '2026-10-22',
        provider_voice_id: 'original/voice', model_config_version_id: id }
        : { id, slot: 'audio.voice_clone', settings: { ...defaults('audio.voice_clone'), endpoint: 'https://voices.example/v1' }, key_ciphertext: cipher } }),
    };
  },
  storage: { from: bucket => ({ remove: async paths => { removed.push({ bucket, paths }); return { error: failStorage ? {} : null }; } }) },
  async rpc(name, args) {
    receipts.push({ name, args });
    if (name === 'claim_media_deletions' || name === 'claim_voice_deletions') return { data: [item] };
    if (name.startsWith('finish_')) return { data: !staleLease };
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'delete_knowledge_entry') return { data: { deleted: true, entry_id: args.p_entry } };
    if (name === 'revoke_voice_clone') return { data: { id: args.p_clone, revoked_at: '2026-10-22' } };
    throw new Error('unexpected RPC ' + name);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'lifecycle-registry');
const { defaultSettings: defaults } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'lifecycle-defaults');
const core = await loadEdge('supabase/functions/_shared/media-cleanup.ts', 'lifecycle-cleanup');
const { handleProductionJobs } = await loadEdge('supabase/functions/production-jobs/index.ts', 'lifecycle-media-api');
const { handleKnowledge } = await loadEdge('supabase/functions/knowledge-base/index.ts', 'lifecycle-knowledge-api');
cipher = await registry.encryptKey('audio.voice_clone', 'original-private-key');
assert.equal(await core.processMediaDeletions(db), 1);
assert.deepEqual(removed, [{ bucket: 'materials', paths: [item.path] }]);
assert.deepEqual(receipts.at(-1).args, { p_id: id, p_lease: 'current-lease', p_success: true });
failStorage = true;
assert.equal(await core.processMediaDeletions(db), 0);
assert.equal(receipts.at(-1).args.p_success, false);
failStorage = false; staleLease = true;
assert.equal(await core.processMediaDeletions(db), 0);
assert.equal(receipts.at(-1).args.p_lease, 'current-lease'); staleLease = false;
console.log('PASS Storage删除故障重试及租约回执拒绝迟到成功');
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return Response.json(reply, { status });
};
assert.equal(await core.processVoiceDeletions(db), 1);
assert.equal(requests[0].url, 'https://voices.example/v1/voices/original%2Fvoice');
assert.equal(requests[0].options.method, 'DELETE');
assert.equal(requests[0].options.headers['xi-api-key'], 'original-private-key');
assert.equal(requests[0].options.redirect, 'error');
console.log('PASS ElevenLabs官方DELETE和status=ok，使用声纹原配置凭据及编码后的ID');
for (const invalid of [{ code: 200, data: {} }, { code: 403, data: { status: 'ok' } }, { code: 404, data: { detail: 'gateway missing' } }]) {
  status = invalid.code; reply = invalid.data;
  assert.equal(await core.processVoiceDeletions(db), 0);
  assert.equal(receipts.at(-1).args.p_success, false);
}
status = 404; reply = { detail: { status: 'voice_not_found' } };
assert.equal(await core.processVoiceDeletions(db), 1);
console.log('PASS 响应丢失后明确voice_not_found可恢复，拒绝普通404/权限失败和伪成功');
const request = body => new Request('https://db.example/functions/v1/test', { method: 'POST',
  headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body) });
for (const [handler, body] of [
  [handleProductionJobs, { action: 'revoke-voice', voice_clone_id: id, request_key: id }],
  [handleKnowledge, { action: 'delete', entry_id: id }],
]) {
  assert.equal((await handler(request(body))).status, 200);
  const latest = receipts.at(-1);
  assert.equal(latest.args.p_user, uid);
  user = null; assert.equal((await handler(request(body))).status, 401); user = { id: uid };
}
assert.equal((await handleProductionJobs(request({ action: 'revoke-voice', voice_clone_id: id }))).status, 400);
assert.equal((await handleKnowledge(request({ action: 'delete', entry_id: 'invalid' }))).status, 400);
console.log('PASS 两个删除入口绑定认证身份、登录鉴权与标识边界');
