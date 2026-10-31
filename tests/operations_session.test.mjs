import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-loader.mjs';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
let owner = first, mode = '', calls = [], custom = null, status = 200;
const receipt = { user_id: first, daily_credit_budget: 25 };
globalThis.__frontendDB = {
  auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: `token-${owner}` } } }) },
  functions: { invoke: async () => {
    calls.push({ owner });
    if (mode === 'switch') owner = second;
    return { data: mode === 'empty' ? {} : mode === 'rejected' ? { error: '未受理', outcome: 'rejected' } : receipt };
  } },
};
globalThis.fetch = async (_url, init) => {
  calls.push({ owner: new Headers(init.headers).get('authorization')?.replace('Bearer token-', '') });
  const value = custom ?? (mode === 'empty' ? {} : mode === 'rejected' ? { error: '未受理', outcome: 'rejected' } : receipt);
  const response = Response.json(value, { status });
  if (mode === 'switch') response.json = async () => { owner = second; return value; };
  return response;
};
const api = await loadFrontend('src/api/operations.ts', 'operations-session', process.env.OPERATIONS_BASELINE_FILE
  ? { 'src/api/operations.ts': readFileSync(process.env.OPERATIONS_BASELINE_FILE, 'utf8') } : {});
const request = { action: 'mutate', operation: 'budget', request_key: crypto.randomUUID(),
  payload: { user_id: first, amount: 25, expected: 0 } };

test('会话已切换时运营申请不能以另一个账号发送', async () => {
  owner = second; mode = ''; calls = [];
  await assert.rejects(api.operationsRequest(request, first), /账号|会话/);
  assert.equal(calls.length, 0);
});
test('解析回执期间换号时拒绝迟到结果，保留发起账号回执', async () => {
  owner = first; mode = 'switch'; calls = [];
  await assert.rejects(api.operationsRequest(request, first), /账号|会话/);
  assert.equal(calls[0].owner, first);
});
test('空的200回执不能被当作预算变更已生效', async () => {
  owner = first; mode = 'empty'; calls = [];
  await assert.rejects(api.operationsRequest(request, first),
    error => error instanceof api.OperatorRequestError && error.outcome === 'unknown');
});
test('正文明确拒绝时保留rejected状态以释放未受理申请', async () => {
  owner = first; mode = 'rejected'; calls = [];
  await assert.rejects(api.operationsRequest(request, first),
    error => error instanceof api.OperatorRequestError && error.outcome === 'rejected');
});
const variants = [
  ['budget', { user_id: first, amount: 25, expected: 0 }, receipt],
  ['grant', { operator_id: second, role: 'finance', scope_user_id: null }, { grant_id: second }],
  ['revoke', { grant_id: second }, { grant_id: second, revoked: true }],
  ['ticket_create', { title: ' 原任务 ', category: 'task', body: '核对' }, { id: second, title: '原任务', version: 1, status: 'open' }],
  ['ticket_reply', { ticket_id: second, expected: 1, body: '回复' }, { id: second, version: 2, status: 'open' }],
  ['ticket_update', { ticket_id: second, expected: 1, status: 'resolved' }, { id: second, version: 2, status: 'resolved' }],
  ['tenant_update', { team_id: second, expected: 1, name: ' 团队 ', state: 'active', max_members: 5, daily_credit_budget: 20 },
    { id: second, ops_version: 2, name: '团队', state: 'active', max_members: 5, daily_credit_budget: 20 }],
  ['tenant_member', { team_id: second, member_id: first, expected: 1 }, { tenant: { id: second, ops_version: 2 }, member_id: first }],
  ['restriction', { user_id: second, expected: 1, restricted: true }, { user_id: second, version: 2, restricted: true }],
  ['risk_review', { event_id: second, expected: 1, disposition: 'confirmed' }, { id: second, ops_version: 2, disposition: 'confirmed' }],
  ['cost_record', { job_id: second, job_type: 'model_attempt', currency: 'USD', amount_minor: 123 },
    { id: first, job_id: second, job_type: 'model_attempt', currency: 'USD', amount_minor: 123, reversal_of: null }],
  ['cost_reverse', { entry_id: second }, { id: first, job_id: second, currency: 'USD', amount_minor: -123, reversal_of: second }],
  ['alert_ack', { alert_id: second, expected: 1 }, { id: second, status: 'acknowledged', version: 2 }],
];
for (const [operation, payload, result] of variants) test(`${operation}仅接受原对象和对应变更回执`, async () => {
  owner = first; mode = ''; status = 200;
  const body = { ...request, operation, payload };
  custom = result;
  assert.deepEqual(await api.operationsRequest(body, first), result);
  custom = { id: crypto.randomUUID(), version: 0, status: 'open' };
  await assert.rejects(api.operationsRequest(body, first),
    error => error instanceof api.OperatorRequestError && error.outcome === 'unknown');
});
for (const channel of ['alipay', 'wechat']) test(`${channel}退款身份、回执编号和入账状态固定`, async () => {
  const body = { action: 'refund', order_no: 'original-order', refund_amount: '3.33', request_key: crypto.randomUUID() };
  const refund = { id: first, order_id: second, out_request_no: 'original-refund', request_key: body.request_key,
    pay_channel: channel, refund_amount: '3.33', refund_status: 'success', applied_at: new Date().toISOString(),
    revoked_credits: 3, needs_attention: false };
  mode = ''; status = 200; custom = { code: 0, data: refund }; owner = second; calls = [];
  await assert.rejects(api.refundTradeOps(channel, body, first), /账号|会话/);
  assert.equal(calls.length, 0);
  owner = first; mode = 'switch';
  await assert.rejects(api.refundTradeOps(channel, body, first), /账号|会话/);
  assert.equal(calls[0].owner, first);
  owner = first; mode = '';
  assert.deepEqual(await api.refundTradeOps(channel, body, first), refund);
  for (const invalid of [{}, { ...refund, request_key: crypto.randomUUID() }, { ...refund, applied_at: null }, { ...refund, refund_amount: '9.99' }]) {
    custom = { code: 0, data: invalid };
    await assert.rejects(api.refundTradeOps(channel, body, first),
      error => error.outcome === 'unknown');
  }
  custom = { code: 1, message: '未受理', outcome: 'rejected' }; status = 429;
  await assert.rejects(api.refundTradeOps(channel, body, first), error => error.outcome === 'rejected' && error.status === 429);
});
