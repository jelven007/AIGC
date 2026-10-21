import assert from 'node:assert/strict';
import { createPrivateKey } from 'node:crypto';
import { loadEdge } from './edge-loader.mjs';
import { wechatFixture } from './wechat_fixture.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: name => env[name] }, serve() {} };
const fixture = await wechatFixture(env);
const uid = crypto.randomUUID(), key = crypto.randomUUID(), lease = crypto.randomUUID();
const order = { id: crypto.randomUUID(), order_no: 'a'.repeat(32), user_id: uid, status: 'paid',
  pay_channel: 'wechat', provider_trade_no: 'trade-original', total_amount: '10.00', refunded_amount: 0,
  plan_snapshot: { name: '原套餐', credits: 100 }, wechat_pay_url: null,
  wechat_expires_at: new Date(Date.now() + 1800000).toISOString(), wechat_close_requested_at: null };
let row = { id: crypto.randomUUID(), order_id: order.id, request_key: key, out_trade_no: order.order_no,
  out_request_no: `RF-${key}`, refund_amount: '3.33', refund_reason: '原原因', pay_channel: 'wechat',
  status: 'requested', lease_token: lease, applied_at: null, provider_refund_id: null };
let mode = 'refund', paymentMode = 'query', canRefund = true, failFinish = false, missingRefund = false, scheduled = false;
let evidence, paymentEvidence;
const rpcCalls = [], steps = [];
const trade = (state = 'SUCCESS') => ({ mchid: env.MERCHANT_ID, appid: env.MERCHANT_APP_ID,
  out_trade_no: order.order_no, transaction_id: order.provider_trade_no, trade_state: state, amount: { total: 1000, currency: 'CNY' } });
const refund = (status = 'SUCCESS') => ({ mchid: env.MERCHANT_ID, transaction_id: order.provider_trade_no,
  out_trade_no: order.order_no, out_refund_no: row.out_request_no, refund_id: 'wx-original-refund',
  status, refund_status: status, amount: { total: 1000, refund: 333, currency: 'CNY' }, user_received_account: 'never-store-buyer' });
globalThis.fetch = async (url, options) => {
  await fixture.request(url, options);
  const step = steps.shift();
  assert.ok(step, `未预期的微信请求：${new URL(url).pathname}`);
  if (step.throw) throw new Error('private upstream secret');
  if (step.status === 204) return new Response(null, { status: 204 });
  return fixture.signed(JSON.stringify(step.data), step.status || 200, step.headers || {});
};
const db = {
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  from(table) {
    return { select() { return this; }, eq() { return this; }, in() { return this; }, is() { return this; },
      lte() { return this; }, or() { return this; }, order() { return this; },
      maybeSingle: async () => ({ data: table === 'orders' ? order
        : table === 'wechat_transactions' ? { mchid: 'merchant', appid: 'app' } : missingRefund ? null : row }),
      single: async () => ({ data: table === 'orders' ? order : { mchid: 'merchant', appid: 'app' } }),
      limit: async () => ({ data: scheduled ? table === 'wechat_transactions'
        ? [{ orders: { order_no: order.order_no } }] : [row] : [] }),
    };
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'operator_can') return { data: canRefund };
    if (name === 'reserve_cash_refund') return { data: row };
    if (name === 'claim_cash_refund') return { data: { mode, refund: row, trade_no: order.provider_trade_no,
      total_amount: order.total_amount, mchid: 'merchant', appid: 'app' } };
    if (name === 'finish_wechat_refund') {
      evidence = args.p_evidence;
      if (failFinish) return { error: { message: 'private database detail' } };
      return { data: { ...row, status: evidence.refund_status === 'SUCCESS' ? 'success'
        : evidence.refund_status === 'CLOSED' ? 'closed' : 'unknown' } };
    }
    if (name === 'claim_wechat_order') return { data: { mode: paymentMode, order, transaction: { lease_token: lease } } };
    if (name === 'finish_wechat_order') {
      paymentEvidence = args.p_evidence;
      if (failFinish) return { error: { message: 'private database detail' } };
      if (paymentEvidence.trade_state === 'CLOSED' && order.status === 'pending') order.status = 'cancelled';
      return { data: order };
    }
    if (name === 'finalize_paid_order') {
      assert.equal(args.p_amount, '10.00'); assert.equal(args.p_pay_channel, 'wechat');
      order.status = 'paid'; return { data: { outcome: 'granted', user_id: uid } };
    }
    throw new Error(name);
  },
};
globalThis.__createClient = () => db;
globalThis.__alipaySdk = () => { throw new Error('微信不可走支付宝协议'); };
const { handleWechatTradeOps } = await loadEdge('supabase/functions/wechat-trade-ops/index.ts', 'wechat-ops');
const { handleWechatRefundWebhook } = await loadEdge('supabase/functions/wechat-refund-webhook/index.ts', 'wechat-notify');
const request = (body, token = 'session') => new Request('https://db.example/functions/v1/wechat-trade-ops', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const original = { action: 'refund', order_no: order.order_no, request_key: key, refund_amount: '3.33', refund_reason: '原原因' };
const query = { action: 'refundQuery', order_no: order.order_no, request_key: key };
for (const token of ['service', 'ak_fake']) assert.equal((await handleWechatTradeOps(request(original, token))).status, 401);
canRefund = false;
assert.equal((await handleWechatTradeOps(request(original))).status, 403);
canRefund = true;
assert.equal((await handleWechatTradeOps(request({ ...original, request_key: undefined }))).status, 400);
assert.equal((await handleWechatTradeOps(request({ ...original, refund_amount: '3.001' }))).status, 400);
assert.equal(fixture.calls.length, 0);
console.log('PASS 微信交易仅个人会话与可信财务，UUID/金额非法不外呼');

steps.push({ data: trade() }, { data: refund('PROCESSING') });
let response = await handleWechatTradeOps(request(original));
assert.equal(response.status, 202); assert.equal(evidence.refund_status, 'PROCESSING');
assert.equal(fixture.calls.at(-2).method, 'GET'); assert.equal(fixture.calls.at(-1).method, 'POST');
assert.deepEqual(fixture.calls.at(-1).body.amount, { total: 1000, refund: 333, currency: 'CNY' });
assert.equal(fixture.calls.at(-1).body.out_refund_no, row.out_request_no);
assert.equal(fixture.calls.at(-1).body.transaction_id, order.provider_trade_no);
assert.ok(!JSON.stringify(evidence).includes('never-store-buyer'));
console.log('PASS 官方原文请求签名/查单前置/整数分与原退款号，PROCESSING不认到账');
mode = 'query';
steps.push({ data: refund() });
assert.equal((await handleWechatTradeOps(request(query))).status, 200);
assert.equal(evidence.refund_status, 'SUCCESS'); assert.equal(evidence.method, 'query');
assert.equal(fixture.calls.at(-1).path, `/v3/refund/domestic/refunds/${row.out_request_no}`);
for (const field of ['transaction_id', 'out_trade_no', 'out_refund_no', 'refund_id', 'amount']) {
  const wrong = refund(); delete wrong[field]; steps.push({ data: wrong });
  assert.equal((await handleWechatTradeOps(request(query))).status, 202); assert.equal(evidence.verified, false);
}
for (const wrong of [{ ...refund(), out_refund_no: 'wrong' }, { ...refund(), amount: { total: 1000, refund: 333, currency: 'USD' } }]) {
  steps.push({ data: wrong }); assert.equal((await handleWechatTradeOps(request(query))).status, 202);
}
console.log('PASS 成功退款严格绑定原交易/原退款/精确金额/币种，缺失或错配不回收权益');
for (const headers of [{ 'Wechatpay-Serial': 'wrong' }, { 'Wechatpay-Signature': 'WECHATPAY/SIGNTEST/fake' },
  { 'Wechatpay-Timestamp': String(Math.floor(Date.now() / 1000) - 301) }]) {
  steps.push({ data: refund(), headers }); assert.equal((await handleWechatTradeOps(request(query))).status, 202);
  assert.equal(evidence.verified, false);
}
steps.push({ status: 404, data: { code: 'RESOURCE_NOT_EXISTS' } });
assert.equal((await handleWechatTradeOps(request(query))).status, 202);
assert.equal(evidence.code, 'RESOURCE_NOT_EXISTS'); assert.equal(evidence.verified, true);
for (const status of ['ABNORMAL', 'CLOSED']) {
  steps.push({ data: refund(status) });
  assert.equal((await handleWechatTradeOps(request(query))).status, status === 'CLOSED' ? 200 : 202);
  assert.equal(evidence.refund_status, status);
}
console.log('PASS 错公钥/签名测试/过期应答保持未知；不存在原单仅可原号重试，ABNORMAL保留、CLOSED结案');

const validNotify = await fixture.notification('REFUND.SUCCESS', refund());
assert.equal((await handleWechatRefundWebhook(validNotify)).status, 200);
assert.equal(evidence.method, 'notify'); assert.equal(rpcCalls.at(-1).args.p_lease, null);
assert.equal((await handleWechatRefundWebhook(await fixture.notification('REFUND.SUCCESS', refund()))).status, 200);
assert.equal((await handleWechatRefundWebhook(await fixture.notification('REFUND.ABNORMAL', refund('SUCCESS')))).status, 400);
assert.equal((await handleWechatRefundWebhook(await fixture.notification('REFUND.SUCCESS', { ...refund(), mchid: 'wrong' }))).status, 500);
missingRefund = true;
assert.equal((await handleWechatRefundWebhook(await fixture.notification('REFUND.SUCCESS', refund()))).status, 409);
missingRefund = false;
const tampered = await fixture.notification('REFUND.SUCCESS', refund());
assert.equal((await handleWechatRefundWebhook(new Request(tampered.url, { method: 'POST', headers: tampered.headers,
  body: (await tampered.text()) + ' ' }))).status, 401);
failFinish = true;
assert.equal((await handleWechatRefundWebhook(await fixture.notification('REFUND.SUCCESS', refund()))).status, 500);
failFinish = false;
console.log('PASS AES-GCM真实通知解密/原文验签/事件商户绑定/重复回执与入账故障返回重试');

order.status = 'pending'; canRefund = false;
steps.push({ data: trade() });
assert.equal((await handleWechatTradeOps(request({ action: 'query', order_no: order.order_no }))).status, 200);
assert.equal(order.status, 'paid');
assert.ok(rpcCalls.some(call => call.name === 'finalize_paid_order'));
order.status = 'pending'; order.wechat_close_requested_at = new Date().toISOString();
steps.push({ data: trade('NOTPAY') }, { status: 204 }, { data: trade('CLOSED') });
assert.equal((await handleWechatTradeOps(request({ action: 'close', order_no: order.order_no }))).status, 200);
assert.equal(order.status, 'cancelled'); assert.equal(paymentEvidence.trade_state, 'CLOSED');
assert.equal(fixture.calls.at(-2).path, `/v3/pay/transactions/out-trade-no/${order.order_no}/close`);
assert.deepEqual(fixture.calls.at(-2).body, { mchid: env.MERCHANT_ID });
order.status = 'pending';
steps.push({ data: trade('NOTPAY') }, { status: 204 }, { throw: true });
response = await handleWechatTradeOps(request({ action: 'close', order_no: order.order_no }));
assert.equal(response.status, 503); assert.equal((await response.json()).outcome, 'unknown');
assert.equal(order.status, 'pending'); assert.equal(paymentEvidence.verified, false);
steps.push({ data: trade('USERPAYING') });
assert.equal((await handleWechatTradeOps(request({ action: 'close', order_no: order.order_no }))).status, 202);
assert.equal(fixture.calls.at(-1).method, 'GET');
console.log('PASS 本人签名查单补偿入账，关单204必须另查CLOSED，响应丢失/USERPAYING不误取消');

const { processWechatRefund } = await loadEdge('supabase/functions/_shared/wechat-refunds.ts', 'wechat-schedule-refund');
const { processWechatOrder } = await loadEdge('supabase/functions/_shared/wechat-transactions.ts', 'wechat-schedule-order');
scheduled = true; steps.push({ data: refund() });
assert.equal(await processWechatRefund(db), true);
assert.equal(rpcCalls.findLast(call => call.name === 'claim_cash_refund').args.p_actor, null);
assert.equal(rpcCalls.findLast(call => call.name === 'claim_cash_refund').args.p_submit, false);
order.wechat_close_requested_at = null; steps.push({ data: trade('NOTPAY') });
assert.equal(await processWechatOrder(db), true);
assert.equal(rpcCalls.findLast(call => call.name === 'claim_wechat_order').args.p_actor, null);
assert.equal(fixture.calls.at(-1).method, 'GET');
assert.equal(steps.length, 0);
console.log('PASS 后台关页核对使用原订单/原退款，仅查询现金退款，不自动现金出账');

const helper = await loadEdge('supabase/functions/_shared/wechat.ts', 'wechat-native-crypto');
const pkcs8 = env.MCH_PRIVATE_KEY;
env.MCH_PRIVATE_KEY = createPrivateKey(pkcs8).export({ type: 'pkcs1', format: 'pem' });
steps.push({ data: trade('NOTPAY') });
await helper.wechatRequest(helper.getWechatConfig(), 'GET', `/v3/pay/transactions/out-trade-no/${order.order_no}?mchid=merchant`);
env.MCH_PRIVATE_KEY = pkcs8;
assert.equal(helper.wechatCents('0.29'), 29);
for (const invalid of ['0', '-1', '3.333', 'Infinity', '21474836.48']) assert.throws(() => helper.wechatCents(invalid));
assert.ok(new TextEncoder().encode(helper.wechatDescription('套餐😀'.repeat(100))).length <= 127);
console.log('PASS PKCS1/PKCS8真实商户签名兼容，金额无浮点舍入，中文标题遵守127字节');
