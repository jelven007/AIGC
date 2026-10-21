import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
import { wechatFixture } from './wechat_fixture.mjs';
const uid = crypto.randomUUID(), key = crypto.randomUUID(), planId = crypto.randomUUID();
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALIPAY_APP_ID: 'fixture', ALIPAY_PRIVATE_KEY: 'isolated-private', ALIPAY_PUBLIC_KEY: 'isolated-public',
  ALIPAY_GATEWAY: 'https://openapi.alipay.com/gateway.do', ALIPAY_SITE_URL: 'https://site.example',
  MERCHANT_ID: 'merchant', MERCHANT_APP_ID: 'app', MCH_CERT_SERIAL_NO: 'serial', MCH_PRIVATE_KEY: 'private',
  WECHAT_PAY_PUBLIC_KEY_ID: 'key', WECHAT_PAY_PUBLIC_KEY: 'public' };
globalThis.Deno = { env: { get: name => env[name] }, serve() {} };
const fixture = await wechatFixture(env);
const order = { id: crypto.randomUUID(), order_no: 'a'.repeat(32), user_id: uid, plan_id: planId, status: 'pending',
  total_amount: '10.00', refunded_amount: 0, wechat_expires_at: new Date(Date.now() + 1800000).toISOString(),
  wechat_pay_url: null, plan_snapshot: { name: '原名称', credits: 100, level: 1 } };
let dbError = null, upstreamFails = false, saveFails = false;
const calls = [], upstream = [];
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (dbError) return { error: dbError };
    if (name === 'claim_wechat_order') return { data: {
      mode: order.status !== 'pending' || order.wechat_pay_url ? 'done' : 'create',
      order, transaction: { lease_token: key },
    } };
    if (name === 'finish_wechat_order') {
      if (saveFails) return { error: { message: 'private database detail' } };
      order.wechat_pay_url = args.p_code_url;
    }
    return { data: order };
  },
  from: name => ({ update: body => ({ eq: async () => {
    assert.equal(name, 'orders'); if (!saveFails) order.wechat_pay_url = body.wechat_pay_url;
    return { error: saveFails ? { message: 'private database detail' } : null };
  } }) }),
});
globalThis.__alipaySdk = () => ({ pageExec: (method, verb, args) => {
  upstream.push({ channel: 'alipay', method, verb, args });
  if (upstreamFails) throw new Error('private signing error');
  return '<form method="post" action="https://openapi.alipay.com/gateway.do"><input type="hidden" name="sign" value="signed"></form>';
} });
globalThis.fetch = async (url, options) => {
  const call = await fixture.request(url, options);
  upstream.push({ channel: 'wechat', args: call.body, options });
  if (upstreamFails) throw new Error('private upstream response');
  return fixture.signed(JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=real-order' }));
};
const { handleAlipayPaymentOrder } = await loadEdge('supabase/functions/alipay-payment-order/index.ts', 'checkout-alipay');
const { handleWechatPaymentOrder } = await loadEdge('supabase/functions/create-payment-order/index.ts', 'checkout-wechat');
const original = { plan_id: planId, request_key: key, expected_amount: '10.00', expected_credits: 100 };
const req = (body = original, token = 'session') => new Request('https://db.example/functions/v1/pay', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
for (const handler of [handleAlipayPaymentOrder, handleWechatPaymentOrder]) {
  assert.equal((await handler(req(original, 'service'))).status, 401);
  assert.equal((await handler(req(original, 'ak_fake'))).status, 401);
  assert.equal((await handler(req({ ...original, request_key: undefined }))).status, 400);
  assert.equal((await handler(req({ ...original, expected_amount: '10.001' }))).status, 400);
  assert.equal((await handler(req({ ...original, expected_credits: undefined }))).status, 400);
}
assert.equal(calls.length, 0); assert.equal(upstream.length, 0);
console.log('PASS 两渠道只允许个人会话/UUID/精确金额，非法参数不创建订单或调用供应商');
for (const handler of [handleAlipayPaymentOrder, handleWechatPaymentOrder]) {
  dbError = { code: '22023', message: '套餐价格已变更，请刷新套餐后重新确认' };
  const result = await handler(req());
  assert.equal(result.status, 409); assert.equal((await result.json()).outcome, 'rejected');
  dbError = { code: '54000', message: '待支付订单已达上限' };
  assert.equal((await handler(req())).status, 429);
  dbError = { message: 'private connection error' };
  const unknown = await handler(req());
  assert.equal(unknown.status, 503); assert.equal((await unknown.json()).outcome, 'unknown');
}
assert.equal(upstream.length, 0); dbError = null;
console.log('PASS 价格冲突/订单配额/数据库结果未知均不外呼，错误不泄漏内部信息');
let response = await handleAlipayPaymentOrder(req());
assert.equal(response.status, 200);
let receipt = (await response.json()).data;
assert.equal(receipt.local_status, 'pending'); assert.equal(receipt.order_id, order.id);
assert.equal(upstream.at(-1).method, 'alipay.trade.page.pay');
assert.equal(upstream.at(-1).verb, 'POST');
assert.equal(upstream.at(-1).args.bizContent.total_amount, '10.00');
assert.equal(upstream.at(-1).args.bizContent.subject, 'Shopro-原名称');
assert.equal(calls.at(-1).name, 'begin_checkout_order'); assert.equal(calls.at(-1).args.p_request_key, key);
console.log('PASS 支付宝使用原订单号/权益快照/数据库金额、pageExec POST与真实回跳');
upstreamFails = true;
for (const handler of [handleAlipayPaymentOrder, handleWechatPaymentOrder]) {
  response = await handler(req());
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.outcome, 'unknown'); assert.equal(result.data.order_id, order.id);
  assert.ok(!JSON.stringify(result).includes('private'));
}
upstreamFails = false; saveFails = true;
assert.equal((await handleWechatPaymentOrder(req())).status, 503);
saveFails = false;
response = await handleWechatPaymentOrder(req());
assert.equal(response.status, 200); receipt = (await response.json()).data;
assert.ok(receipt.wechat_pay_url.startsWith('weixin://'));
const wxCalls = upstream.filter(item => item.channel === 'wechat');
assert.equal(new Set(wxCalls.map(item => item.args.out_trade_no)).size, 1);
assert.equal(wxCalls.at(-1).args.amount.total, 1000);
assert.equal(wxCalls.at(-1).args.time_expire, order.wechat_expires_at);
assert.equal(wxCalls.at(-1).args.amount.currency, 'CNY');
const count = upstream.length;
assert.equal((await handleWechatPaymentOrder(req())).status, 200);
assert.equal(upstream.length, count);
console.log('PASS 签名/上游/二维码落库失败保留原回执，微信同订单恢复，已存二维码不重复外呼');
order.status = 'paid';
for (const handler of [handleAlipayPaymentOrder, handleWechatPaymentOrder]) {
  const paid = (await (await handler(req())).json()).data;
  assert.equal(paid.local_status, 'paid'); assert.equal(paid.payment_html, undefined); assert.ok(!paid.wechat_pay_url);
}
assert.equal(upstream.length, count);
delete env.MERCHANT_ID;
assert.equal((await handleWechatPaymentOrder(req())).status, 503);
delete env.ALIPAY_APP_ID;
assert.equal((await handleAlipayPaymentOrder(req())).status, 503);
assert.equal(upstream.length, count);
console.log('PASS 终态恢复不重收款、未开通渠道不回退演示支付');
