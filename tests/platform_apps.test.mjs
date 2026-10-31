import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64) };
let readError = false, conflict = false, writes = 0;
let old = { platform: 'tiktok', client_key: 'old', updated_at: '2026-10-30T00:00:00Z', secret_ciphertext: 'private-cipher' };
globalThis.Deno = { env: { get: name => env[name] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'admin', app_metadata: { role: 'admin' } } } }) },
  from() {
    let saved;
    return {
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: old, error: readError ? { message: 'failure' } : null }),
      update(value) { writes++; saved = { ...old, ...value }; return this; },
      insert(value) { writes++; saved = value; return this; },
      then(resolve) { return Promise.resolve({ data: conflict ? [] : [saved], error: null }).then(resolve); },
    };
  },
});
const { handlePlatformAccounts } = await loadEdge('supabase/functions/platform-accounts/index.ts', 'platform-apps');
const request = updated_at => new Request('https://db.example/functions/v1/platform-accounts', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify({
    action: 'save_app', platform: 'tiktok', client_key: ' normalized ', enabled: true,
    redirect_uri: 'https://db.example/functions/v1/platform-oauth-callback', updated_at,
  }),
});
let response = await handlePlatformAccounts(request(old.updated_at));
assert.equal(response.status, 200);
const receipt = await response.json();
assert.equal(receipt.ok, true);
assert.equal(receipt.app?.platform, 'tiktok', '保存须返回权威应用回执');
assert.equal(receipt.app.client_key, 'normalized');
assert.notEqual(receipt.app.updated_at, old.updated_at);
assert.equal(receipt.app.has_secret, true);
assert.ok(!JSON.stringify(receipt).includes('private-cipher'));
const before = writes;
readError = true;
assert.equal((await handlePlatformAccounts(request(old.updated_at))).status, 503);
assert.equal(writes, before, '读取旧版本失败不得执行保存');
readError = false; conflict = true;
assert.equal((await handlePlatformAccounts(request(old.updated_at))).status, 409);
console.log('PASS 平台保存权威版本、不回传密文、旧版本读取失败不写入、CAS冲突拒绝');
