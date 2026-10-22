import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = crypto.randomUUID(), key = crypto.randomUUID(), id = crypto.randomUUID();
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: name => env[name] }, serve() {} };
const calls = [];
let rpcError = null;
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'upsert_rate_limit') return { data: true };
    return rpcError ? { error: rpcError } : { data: { id, version: 2, items: [], totals: [] } };
  },
});
const { handleOperations } = await loadEdge('supabase/functions/operations/index.ts', 'operations-workflows');
const request = (body, token = 'session') => new Request('https://db.example/functions/v1/operations', {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
for (const action of ['support', 'tenant', 'cost_report']) {
  const body = { action, team_id: id, ticket_id: id };
  const response = await handleOperations(request({ ...body, actor: id }));
  assert.equal(response.status, 200);
  assert.equal(calls.at(-1).args.p_actor, uid);
  assert.equal((await handleOperations(request(body, 'service'))).status, 401);
  assert.equal((await handleOperations(request(body, 'ak_live_bad'))).status, 401);
}
console.log('PASS 工单/租户/成本读取强制个人身份，客户端actor不成为RPC主体');
const valid = {
  ticket_create: { title: '真实问题', category: 'task', body: '原任务没有结果' },
  ticket_reply: { ticket_id: id, expected: 1, body: '补充说明', internal: false },
  ticket_update: { ticket_id: id, expected: 1, status: 'resolved', reason: '原任务核对完成' },
  tenant_update: { team_id: id, expected: 1, name: '客户团队', state: 'suspended', max_members: 5, daily_credit_budget: 30, reason: '核对租户策略' },
  tenant_member: { team_id: id, member_id: id, expected: 1, member_action: 'role', role: 'viewer', reason: '调整成员职责' },
  risk_review: { event_id: id, expected: 1, disposition: 'dismissed', reason: '人工复核误报' },
  restriction: { user_id: id, expected: 0, restricted: true, reason: '暂停新计费任务' },
  cost_record: { job_type: 'video', job_id: id, amount_minor: 123, currency: 'USD', statement_ref: 'provider/account/invoice', line_ref: '1', evidence_sha256: 'a'.repeat(64), reason: '原供应商账单核对' },
  cost_reverse: { entry_id: id, statement_ref: 'provider/account/correction', line_ref: '2', evidence_sha256: 'b'.repeat(64), reason: '原账单撤销' },
  alert_ack: { alert_id: id, expected: 1, reason: '值班已接手核对原任务' },
};
for (const [operation, payload] of Object.entries(valid)) {
  const response = await handleOperations(request({ action: 'mutate', operation, payload, request_key: key, actor: id }));
  assert.equal(response.status, 200, operation);
  assert.deepEqual(calls.at(-1), { name: 'operator_mutate', args: { p_actor: uid, p_key: key, p_action: operation, p_payload: payload } });
}
console.log('PASS 九种持久操作保留完整原UUID/参数，现金以分币种整数提交');
for (const [operation, payload] of [
  ['ticket_reply', { ...valid.ticket_reply, internal: 'true' }], ['ticket_update', { ...valid.ticket_update, expected: undefined }],
  ['tenant_update', { ...valid.tenant_update, max_members: 0 }], ['restriction', { ...valid.restriction, restricted: 1 }],
  ['cost_record', { ...valid.cost_record, amount_minor: 1.23 }], ['cost_record', { ...valid.cost_record, evidence_sha256: 'bad' }],
  ['tenant_member', { ...valid.tenant_member, role: 'owner' }], ['risk_review', { ...valid.risk_review, reason: '' }],
  ['alert_ack', { ...valid.alert_ack, expected: undefined }], ['alert_ack', { ...valid.alert_ack, alert_id: 'bad' }],
]) {
  const before = calls.length;
  const response = await handleOperations(request({ action: 'mutate', operation, payload, request_key: key }));
  assert.equal(response.status, 400); assert.equal((await response.json()).outcome, 'rejected');
  assert.equal(calls.slice(before).some(x => x.name === 'operator_mutate'), false);
}
assert.equal((await handleOperations(request({ action: 'mutate', operation: 'ticket_create', payload: valid.ticket_create, request_key: key, padding: 'x'.repeat(17000) }))).status, 400);
console.log('PASS 版本/角色/金额/指纹/16KB边界在变更前拒绝，已验证参数零写入');
for (const [error, status, outcome] of [
  [{ code: '42501', message: 'private account detail' }, 403, 'rejected'],
  [{ code: '22023', message: '参数非法' }, 400, 'rejected'],
  [{ code: '23505', message: 'private duplicate invoice' }, 409, 'rejected'],
  [{ message: '工单版本已变化，请刷新后重试' }, 409, 'rejected'],
  [{ message: '同一运营申请不能修改参数' }, 409, 'unknown'],
  [{ message: 'private unavailable database' }, 503, 'unknown'],
]) {
  rpcError = error;
  const response = await handleOperations(request({ action: 'mutate', operation: 'ticket_reply', payload: valid.ticket_reply, request_key: key }));
  assert.equal(response.status, status);
  const result = await response.json(); assert.equal(result.outcome, outcome);
  assert.equal(JSON.stringify(result).includes('private'), false);
}
console.log('PASS 确定冲突/拒绝可刷新重填，UUID参数冲突及数据库故障保留原申请，回执不泄露原错误');
