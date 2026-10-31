import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const env = {
  SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64), DEEPSEEK_API_KEY: 'fixture-text-key',
  URL_READER_API_KEY: 'fixture-reader-key',
};
let user = { id: 'admin', app_metadata: { role: 'admin' } };
const writes = [];
globalThis.Deno = { env: { get: name => env[name] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user } }) },
  from: () => ({
    select() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  }),
  rpc: async (name, params) => { writes.push(params.p_slot); return { data: 'version', error: null }; },
});
const { handleModelSettings } = await loadEdge('supabase/functions/model-settings/index.ts', 'settings-scope');
const request = body => new Request('https://db.example/functions/v1/model-settings', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body),
});
const call = async body => {
  const response = await handleModelSettings(request(body));
  assert.equal(response.status, 200);
  return response.json();
};
const models = (await call({ action: 'list', scope: 'models' })).configs;
assert.equal(models.length, 16, '模型接口列表只返回模型 API');
assert.ok(models.every(item => !/^(intelligence|reader)\./.test(item.slot)));
const integrations = (await call({ action: 'list', scope: 'integrations' })).configs;
assert.deepEqual(integrations.map(item => item.slot).sort(),
  ['intelligence.ebay', 'intelligence.licensed', 'intelligence.youtube', 'reader.primary']);
assert.equal((await call({ action: 'catalog' })).configs.length, 20, '业务目录继续兼容全部原配置');

await call({ action: 'import', scope: 'models' });
assert.deepEqual(writes, ['text.primary', 'text.fallback'], '模型页导入不能写入网页读取凭据');
writes.length = 0;
await call({ action: 'import', scope: 'integrations' });
assert.deepEqual(writes, ['reader.primary'], '集成页导入不能写入模型凭据');
writes.length = 0;
assert.equal((await handleModelSettings(request({ action: 'import', scope: 'invalid' }))).status, 400);
assert.equal((await handleModelSettings(request({
  action: 'save', scope: 'models', slot: 'reader.primary',
}))).status, 400);
assert.equal(writes.length, 0, '非法范围或跨范围保存不写入配置');
user = { id: 'ordinary', app_metadata: {}, user_metadata: { role: 'admin' } };
assert.equal((await handleModelSettings(request({ action: 'list', scope: 'integrations' }))).status, 403);
assert.equal((await handleModelSettings(request({ action: 'import', scope: 'integrations' }))).status, 403);
assert.equal((await call({ action: 'catalog', scope: 'models' })).configs.length, 16);
console.log('PASS 模型与集成目录、历史导入隔离、旧业务兼容和管理员权限');
