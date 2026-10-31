import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEdge } from './edge-loader.mjs';
const env = new Map([
  ['SELF_HOSTED_BACKEND_ORIGIN', 'https://shopro.test:8443'],
  ['SELF_HOSTED_BACKEND_IPS', '172.31.247.10'],
]);
let addresses = ['172.31.247.10'];
globalThis.Deno = { env: { get: name => env.get(name) }, resolveDns: async (_, kind) => kind === 'A' ? addresses : [] };
const media = await loadEdge('supabase/functions/_shared/first-party.ts', 'selfhost-media');

test('仅指定origin的第一方存储路径可以使用私有地址', async () => {
  const url = 'https://shopro.test:8443/storage/v1/object/sign/materials/u/a.png?token=original';
  assert.equal((await media.validateFirstParty(url, true)).href, url);
  for (const value of ['https://shopro.test:9443/storage/v1/object/sign/materials/u/a',
    'https://other.test:8443/storage/v1/object/sign/materials/u/a',
    'https://shopro.test:8443/auth/v1/admin/users',
    'https://name:password@shopro.test:8443/storage/v1/object/sign/materials/u/a']) {
    await assert.rejects(media.validateFirstParty(value, true));
  }
});
test('未配置的私有DNS答案使请求失败', async () => {
  addresses = ['172.31.247.10', '172.31.247.11'];
  await assert.rejects(media.validateFirstParty('https://shopro.test:8443/storage/v1/object/sign/materials/u/a', true));
  addresses = [];
  await assert.rejects(media.validateFirstParty('https://shopro.test:8443/storage/v1/object/sign/materials/u/a', true));
});
