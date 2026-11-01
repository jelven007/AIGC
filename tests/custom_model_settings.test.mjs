import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64) };
let user = { id: 'admin', app_metadata: { role: 'admin' } };
const rows = [], calls = [];
let conflict = false;
globalThis.Deno = { env: { get: name => env[name] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user } }) },
  from: () => ({
    select() { return this; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  }),
  rpc: async (name, params) => {
    calls.push({ name, params });
    return conflict ? { error: { message: '创建标识已被使用' } } : { data: crypto.randomUUID(), error: null };
  },
});
const { handleModelSettings } = await loadEdge('supabase/functions/model-settings/index.ts', 'custom-settings');
const catalog = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'custom-catalog');
const request = body => new Request('https://db.example/functions/v1/model-settings', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body),
});
const call = body => handleModelSettings(request(body));
for (const category of ['text', 'video', 'image', 'audio', '3d', 'embedding']) {
  const id = crypto.randomUUID();
  const response = await call({ action: 'create', scope: 'models', category, id, name: `新增${category}` });
  assert.equal(response.status, 200, `创建${category}配置`);
  const { config } = await response.json();
  assert.equal(config.slot, `custom.${category}.${id}`);
  assert.equal(config.enabled, false);
  assert.equal(config.has_key, false);
  assert.ok(config.version_id);
  const params = calls.at(-1).params;
  assert.equal(calls.at(-1).name, 'create_custom_model_config');
  assert.equal(params.p_actor, 'admin');
  rows.push({ slot: config.slot, enabled: false, current_version_id: config.version_id,
    model_config_versions: { settings: config.settings, key_ciphertext: null } });
  assert.equal(catalog.defaultSettings(config.slot).protocol, config.settings.protocol);
}
const list = await (await call({ action: 'list', scope: 'models' })).json();
assert.equal(list.configs.length, 19, '刷新返回六种自建配置及13个内置入口');
assert.equal((await (await call({ action: 'list', scope: 'integrations' })).json()).configs.length, 4);
assert.equal((await (await call({ action: 'catalog' })).json()).configs.length, 20,
  '原业务目录不增加未接入生成路由的自建配置');
const slot = rows[0].slot;
const settings = { ...catalog.defaultSettings(slot), name: '自建文本模型' };
assert.equal((await call({ action: 'save', scope: 'models', slot, version_id: rows[0].current_version_id,
  enabled: false, settings })).status, 200);
assert.equal((await call({ action: 'save', scope: 'integrations', slot,
  version_id: rows[0].current_version_id, enabled: false, settings })).status, 400);
assert.equal((await call({ action: 'save', scope: 'models' })).status, 400);
for (const body of [
  { category: 'avatar', id: crypto.randomUUID(), name: '不支持' },
  { category: 'text', id: 'not-a-uuid', name: '错误ID' },
  { category: 'text', id: crypto.randomUUID(), name: '   ' },
  { category: 'text', id: crypto.randomUUID(), name: '有效', scope: 'integrations' },
]) assert.equal((await call({ action: 'create', scope: 'models', ...body })).status, 400);
conflict = true;
assert.equal((await call({ action: 'create', scope: 'models', category: 'text',
  id: crypto.randomUUID(), name: '重试冲突' })).status, 409);
user = { id: 'user', app_metadata: {}, user_metadata: { role: 'admin' } };
assert.equal((await call({ action: 'create', scope: 'models', category: 'text',
  id: crypto.randomUUID(), name: '无权限' })).status, 403);
const publicList = await (await call({ action: 'catalog', scope: 'models' })).text();
assert.equal(JSON.parse(publicList).configs.length, 19);
assert.ok(!publicList.includes('endpoint') && !publicList.includes('key_ciphertext'));
console.log('PASS 六类创建、目录重载、范围隔离、保存、冲突和管理员权限');
