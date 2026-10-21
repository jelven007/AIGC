import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const uid = crypto.randomUUID(), key = crypto.randomUUID(), lease = crypto.randomUUID();
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALIPAY_APP_ID: 'fixture-app', ALIPAY_PRIVATE_KEY: 'isolated-private', ALIPAY_PUBLIC_KEY: 'isolated-public',
  ALIPAY_GATEWAY: 'https://openapi.alipay.com/gateway.do' };
globalThis.Deno = { env: { get: name => env[name] }, serve() {} };
const order = { id: crypto.randomUUID(), order_no: 'order-1', user_id: crypto.randomUUID(), status: 'paid', pay_channel: 'alipay', provider_trade_no: 'trade-1' };
let row = { id: key, order_id: order.id, request_key: key, out_trade_no: order.order_no,
  out_request_no: `RF-${key}`, refund_amount: '3.33', refund_reason: '原原因', status: 'requested',
  lease_token: lease, applied_at: null, revoked_credits: 0, next_query_at: null, needs_attention: true };
let canRefund = true, failReserve = false, failFinish = false, upstreamThrow = false, mode = 'refund';
let evidence = null, calls = [], upstreamCalls = [], receipts = [], logs = [];
const db = {
  auth: { getUser: async () => ({ data: { user: { id: uid, app_metadata: {} } } }) },
  from(table) {
    return { select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: table === 'orders' ? order : row }) };
  },
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'operator_can') return { data: canRefund };
    if (name === 'reserve_cash_refund') return failReserve
      ? { error: { message: 'database unavailable' } } : { data: row };
    if (name === 'claim_cash_refund') return { data: { mode, refund: row, trade_no: order.provider_trade_no } };
    if (name === 'finish_cash_refund') {
      evidence = args.p_evidence; receipts.push(evidence);
      if (failFinish) return { error: { message: 'private DB detail' } };
      return { data: { ...row, status: evidence.outcome === 'success' ? 'success' : 'unknown' } };
    }
    if (name === 'close_paid_order_guarded') return { data: 'paid' };
    throw new Error(name);
  },
};
let responseFields = { code: '10000', tradeNo: 'trade-1', outTradeNo: 'order-1', refundFee: '3.33', fundChange: 'Y' };
globalThis.__createClient = () => db;
globalThis.__alipaySdk = config => {
  assert.equal(config.timeout, 15000);
  return { exec: async (method, args, options) => {
    assert.equal(options.validateSign, true);
    upstreamCalls.push({ method, args });
    if (upstreamThrow) throw new Error('raw upstream buyer identity/secret');
    return responseFields;
  } };
};
const originalError = console.error;
console.error = (...args) => logs.push(args);
const { handleAlipayTradeOps } = await loadEdge('supabase/functions/alipay-trade-ops/index.ts', 'cash-refunds');
const request = (body, token = 'session') => new Request('https://db.example/functions/v1/alipay-trade-ops', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const original = { action: 'refund', order_no: order.order_no, request_key: key, refund_amount: '3.33', refund_reason: '原原因' };
assert.equal((await handleAlipayTradeOps(request(original, 'service'))).status, 401);
assert.equal((await handleAlipayTradeOps(request(original, 'ak_live_invalid'))).status, 401);
canRefund = false;
assert.equal((await handleAlipayTradeOps(request(original))).status, 403);
assert.equal(upstreamCalls.length, 0);
canRefund = true;
assert.equal((await handleAlipayTradeOps(request({ ...original, request_key: undefined }))).status, 400);
assert.equal((await handleAlipayTradeOps(request({ ...original, refund_amount: '1.001' }))).status, 400);
assert.equal((await handleAlipayTradeOps(request({ ...original, out_request_no: row.out_request_no, refund_amount: '9.00' }))).status, 409);
assert.equal(upstreamCalls.length, 0);
console.log('PASS 仅个人会话/可信运营权限，新退款强制UUID，修改原金额拒绝且不外呼');

let response = await handleAlipayTradeOps(request(original));
assert.equal(response.status, 200); assert.equal(evidence.outcome, 'success');
assert.equal(upstreamCalls[0].args.bizContent.refund_amount, '3.33');
assert.equal(calls.find(call => call.name === 'reserve_cash_refund').args.p_actor, uid);
assert.equal(calls.find(call => call.name === 'claim_cash_refund').args.p_submit, true);
for (const field of ['refund_fee', 'trade_no', 'out_trade_no', 'fund_change']) {
  responseFields = { code: '10000', trade_no: 'trade-1', out_trade_no: 'order-1', refund_fee: '3.33', fund_change: 'Y' };
  delete responseFields[field];
  response = await handleAlipayTradeOps(request(original));
  assert.equal(response.status, 202); assert.equal(evidence.outcome, 'unknown');
}
responseFields = { code: '10000', tradeNo: 'trade-1', outTradeNo: 'order-1', refundFee: '3.33', fundChange: 'N' };
assert.equal((await handleAlipayTradeOps(request(original))).status, 202);
responseFields = { code: '10000', tradeNo: 'wrong', outTradeNo: 'order-1', refundFee: '3.33', fundChange: 'Y' };
assert.equal((await handleAlipayTradeOps(request(original))).status, 202);
console.log('PASS 响应验签/精确金额/订单与交易绑定，无字段或fund_change=N不认到账');

mode = 'query';
responseFields = { code: '10000', tradeNo: 'trade-1', outTradeNo: 'order-1', outRequestNo: row.out_request_no,
  refundAmount: '3.33', refundStatus: 'REFUND_SUCCESS' };
response = await handleAlipayTradeOps(request({ action: 'refundQuery', order_no: order.order_no, request_key: key }));
assert.equal(response.status, 200); assert.equal(evidence.method, 'query'); assert.equal(evidence.outcome, 'success');
assert.equal(upstreamCalls.at(-1).method, 'alipay.trade.fastpay.refund.query');
assert.equal(calls.at(-2).args.p_submit, false);
responseFields.outRequestNo = 'other';
assert.equal((await handleAlipayTradeOps(request({ action: 'refundQuery', order_no: order.order_no, out_request_no: row.out_request_no }))).status, 202);
assert.equal(evidence.outcome, 'unknown');
console.log('PASS 查询支持原UUID，要求REFUND_SUCCESS与原退款编号，金额不可替换');

const before = upstreamCalls.length;
mode = 'wait';
assert.equal((await handleAlipayTradeOps(request(original))).status, 202);
assert.equal(upstreamCalls.length, before);
mode = 'done'; row = { ...row, status: 'success', applied_at: new Date().toISOString() };
assert.equal((await handleAlipayTradeOps(request(original))).status, 200);
assert.equal(upstreamCalls.length, before);
console.log('PASS 数据库控制查询间隔/租约；等待和已完成请求不调用上游');

row = { ...row, status: 'requested', applied_at: null }; mode = 'refund';
upstreamThrow = true;
assert.equal((await handleAlipayTradeOps(request(original))).status, 202); assert.equal(evidence.outcome, 'unknown');
assert.equal(evidence.verified, false);
failFinish = true;
response = await handleAlipayTradeOps(request(original));
assert.equal(response.status, 503); assert.equal((await response.json()).outcome, 'unknown');
failFinish = false; failReserve = true;
response = await handleAlipayTradeOps(request(original));
assert.equal(response.status, 503); assert.equal((await response.json()).outcome, 'unknown');
assert.deepEqual(logs, []);
assert.equal(JSON.stringify(receipts).includes('identity/secret'), false);
console.log('PASS 超时/验签异常保留未知，落库失败返回503原申请恢复，日志和证据无原响应');

upstreamThrow = false; failReserve = false; order.status = 'pending';
responseFields = { code: '10000', out_trade_no: order.order_no };
response = await handleAlipayTradeOps(request({ action: 'close', order_no: order.order_no }));
assert.equal(response.status, 200);
assert.equal((await response.json()).data.closed, false);
console.error = originalError;
console.log('PASS 关闭与支付竞争按数据库最新状态返回，不把已支付订单报告为已取消');

const originalRpc = db.rpc.bind(db);
db.rpc = async (name, args) => {
  if (name === 'upsert_rate_limit') {
    assert.equal(args.p_client_id, `operations:${uid}`);
    assert.equal(args.p_max_req, 60); return { data: true };
  }
  if (name === 'operator_access') { assert.equal(args.p_actor, uid); return { data: { permissions: [] } }; }
  if (name === 'operator_list') {
    assert.equal(args.p_actor, uid); assert.equal(args.p_user, null);
    return { error: { code: '42501', message: 'private details' } };
  }
  if (name === 'operator_mutate') return { error: { message: 'database unavailable' } };
  return originalRpc(name, args);
};
const { handleOperations } = await loadEdge('supabase/functions/operations/index.ts', 'cash-operations');
assert.equal((await handleOperations(request({ action: 'access' }, 'service'))).status, 401);
assert.equal((await handleOperations(request({ action: 'access', user_id: 'forged' }))).status, 200);
assert.equal((await handleOperations(request({ action: 'list', domain: 'orders', actor: 'forged' }))).status, 403);
assert.equal((await handleOperations(request({ action: 'list', domain: 'secrets' }))).status, 400);
assert.equal((await handleOperations(request({ action: 'mutate', operation: 'grant', request_key: key,
  payload: { operator_id: uid, role: 'admin', scope_user_id: null } }))).status, 400);
response = await handleOperations(request({ action: 'mutate', operation: 'budget', request_key: key,
  payload: { user_id: uid, amount: 25, expected: 0 } }));
assert.equal(response.status, 503); assert.equal((await response.json()).outcome, 'unknown');
console.log('PASS 运营Edge按认证主体调用RPC/限流，越权域/根角色拒绝，写故障保留原申请');

const { processCashRefund } = await loadEdge('supabase/functions/_shared/cash-refunds.ts', 'cash-scheduler');
const originalFrom = db.from;
db.from = table => {
  assert.equal(table, 'alipay_refunds');
  return { select() { return this; }, in() { return this; }, is() { return this; }, lte() { return this; }, lt() { return this; },
    or() { return this; }, order() { return this; }, limit: async () => ({ data: [row] }) };
};
db.rpc = async (name, args) => {
  if (name === 'claim_cash_refund') { assert.equal(args.p_actor, null); assert.equal(args.p_submit, false);
    return { data: { mode: 'query', refund: row, trade_no: order.provider_trade_no } }; }
  return originalRpc(name, args);
};
responseFields = { code: '10000', tradeNo: 'trade-1', outTradeNo: 'order-1', outRequestNo: row.out_request_no,
  refundAmount: '3.33', refundStatus: 'REFUND_SUCCESS' };
assert.equal(await processCashRefund(db), true);
assert.equal(upstreamCalls.at(-1).method, 'alipay.trade.fastpay.refund.query');
db.from = originalFrom;
console.log('PASS 真实退款调度模块只查询原编号，绝不自动发起退款');
