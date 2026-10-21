import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
let user = { id: uid }, group = null, tasks = [], rpcCalls = [], reads = [], modelCalls = 0, rpcError = null;
let limitResult = { data: true };
const project = { video_url: `https://db.example/storage/v1/object/authenticated/materials/${uid}/video.mp4`, duration: 2 };
const connections = {};
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    const filters = {};
    const query = {
      select(fields) { reads.push({ table, fields, filters }); return this; },
      eq(key, value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() {
        return { data: table === 'publish_groups' ? group?.request_key === filters.request_key && group.user_id === filters.user_id ? group : null
          : table === 'video_projects' && filters.user_id === uid ? project : null };
      },
      async single() { return { data: connections[filters.id]?.user_id === filters.user_id ? connections[filters.id] : null }; },
      then(resolve) { resolve({ data: table === 'publish_tasks' ? tasks : table === 'publish_groups' ? group ? [group] : [] : [] }); },
    };
    return query;
  },
  async rpc(name, args) {
    if (name === 'upsert_rate_limit') return limitResult;
    rpcCalls.push({ name, args });
    if (rpcError) return { error: rpcError };
    if (name === 'create_publish_group') {
      if (group && JSON.stringify(group.request) !== JSON.stringify(args.p_payload)) {
        return { error: { code: 'P0001', message: '同一请求标识不能用于不同发布' } };
      }
      if (!group) {
        group = { id: crypto.randomUUID(), user_id: args.p_user, request_key: args.p_request, request: args.p_payload };
        tasks = args.p_payload.targets.map(target => ({ id: crypto.randomUUID(), group_id: group.id,
          connection_id: target.connection_id, status: 'draft', request_key: crypto.randomUUID() }));
      }
      return { data: group.id };
    }
    throw new Error(name);
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'publish-groups-registry');
const { handlePlatformPublish } = await loadEdge('supabase/functions/platform-publish/index.ts', 'publish-groups-api');
const contract = await loadEdge('supabase/functions/_shared/publish-contract.ts', 'publish-groups-contract');
const accounts = [crypto.randomUUID(), crypto.randomUUID()];
for (const id of accounts) connections[id] = { id, user_id: uid, platform: 'tiktok', open_id: id, status: 'active',
  display_name: `账号${id.slice(0, 4)}`, expires_at: new Date(Date.now() + 3600000).toISOString(),
  token_ciphertext: await registry.encryptKey(`platform-connection:${uid}:tiktok:${id}`, JSON.stringify({ access_token: 'private-platform-token' })) };
const info = { privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], max_video_post_duration_sec: 60,
  comment_disabled: true, duet_disabled: false, stitch_disabled: false };
globalThis.fetch = async () => { modelCalls++; return Response.json({ error: { code: 'ok' }, data: info }); };
const options = { consent: true, privacy_level: 'SELF_ONLY', disable_comment: true, disable_duet: true,
  disable_stitch: true, brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true };
const payload = { action: 'create_group', request_key: crypto.randomUUID(), project_id: crypto.randomUUID(),
  title: '预览的成片', description: '', tags: [], source_url: project.video_url, duration: project.duration,
  targets: accounts.map(connection_id => ({ connection_id, options })) };
const request = body => new Request('https://db.example/functions/v1/platform-publish', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body),
});
const call = body => handlePlatformPublish(request(body));

user = null;
assert.equal((await call(payload)).status, 401);
assert.equal(rpcCalls.length, 0); user = { id: uid };
assert.equal((await handlePlatformPublish(new Request('https://db.example/functions/v1/platform-publish', {
  method: 'POST', body: JSON.stringify({ title: 'x'.repeat(32769) }),
}))).status, 400);
for (const body of [{ ...payload, targets: [] }, { ...payload, targets: [payload.targets[0], payload.targets[0]] },
  { ...payload, targets: [{ ...payload.targets[0], options: { ...options, consent: false } }] },
  { ...payload, duration: Infinity }, { ...payload, source_url: undefined }]) {
  assert.equal((await call(body)).status, 400);
}
assert.equal(rpcCalls.length, 0); assert.equal(modelCalls, 0);
assert.equal((await call({ ...payload, source_url: 'https://wrong.example/video.mp4' })).status, 400);
assert.equal(modelCalls, 0);
limitResult = { data: false };
assert.equal((await call(payload)).status, 429); assert.equal(modelCalls, 0);
limitResult = { error: { message: 'rate limiter unavailable' } };
assert.equal((await call(payload)).status, 503); assert.equal(modelCalls, 0);
limitResult = { data: true };
console.log('PASS 登录、重复账号、逐账号确认和预览源绑定在调用平台与入队前校验');

assert.equal((await call({ ...payload, targets: [{ ...payload.targets[0],
  options: { ...options, disable_comment: false } }] })).status, 400);
assert.equal(rpcCalls.length, 0);
assert.match(contract.capabilityError({ ...info, platform: 'tiktok' }, { ...options, brand_content_toggle: true }, 2), /付费/);
const response = await call(payload);
assert.equal(response.status, 202);
const created = await response.json();
assert.equal(created.group.tasks.length, 2); assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].args.p_user, uid); assert.equal(rpcCalls[0].args.p_source, project.video_url);
assert.equal(new Set(created.group.tasks.map(task => task.request_key)).size, 2);
console.log('PASS 权限限制与商业可见范围检查，通过后一次RPC创建账号任务');

const before = modelCalls;
project.video_url = 'https://changed.example/new.mp4'; project.duration = 5;
for (const id of accounts) connections[id].status = 'revoked';
assert.equal((await call({ ...payload, targets: [...payload.targets].reverse() })).status, 202);
assert.equal(modelCalls, before);
assert.equal(rpcCalls.at(-1).args.p_source, null);
const conflict = await call({ ...payload, title: '不同内容' });
assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'publish_group_conflict');
assert.equal((await call({ action: 'query_group', request_key: payload.request_key })).status, 200);
user = { id: other };
assert.equal((await (await call({ action: 'query_group', request_key: payload.request_key })).json()).group, null);
user = { id: uid };
console.log('PASS 源变化/断开后按原组恢复不重新调用平台，内容变化冲突与跨用户隔离');

group = null; project.video_url = payload.source_url; project.duration = 2;
for (const id of accounts) connections[id].status = 'active';
rpcError = { code: 'P0001', message: '最多保留24个未结案发布任务' };
const rejected = await call(payload);
assert.equal(rejected.status, 409); assert.equal((await rejected.json()).code, 'publish_group_rejected');
rpcError = { code: '57014', message: 'statement timeout' };
assert.equal((await call(payload)).status, 503);
rpcError = null;
await call({ action: 'list' });
assert.ok(reads.filter(read => ['publish_groups', 'publish_tasks'].includes(read.table)).every(read => read.filters.user_id));
assert.ok(reads.filter(read => read.table === 'publish_tasks').every(read => !read.fields.includes('source_url')));
console.log('PASS 确定回滚与未知结果区分，发布查询只返回归属用户的安全字段');
