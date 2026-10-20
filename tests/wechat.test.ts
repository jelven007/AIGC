import { validateWechatTrade, verifyWechatNotification } from '../supabase/functions/_shared/wechat.ts';

function assert(value: unknown, message = '断言失败'): asserts value {
  if (!value) throw new Error(message);
}

Deno.test('微信通知验签：原文、时间戳、序列号和签名都必须匹配', async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const bytes = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PUBLIC KEY-----`;
  const rawBody = '{"event_type":"TRANSACTION.SUCCESS","id":"test"}';
  const timestamp = 1800000000;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', keys.privateKey,
    new TextEncoder().encode(`${timestamp}\nnonce\n${rawBody}\n`),
  ));
  const headers = new Headers({
    'wechatpay-timestamp': String(timestamp), 'wechatpay-nonce': 'nonce',
    'wechatpay-serial': 'PUB_KEY_ID_test',
    'wechatpay-signature': btoa(String.fromCharCode(...signature)),
  });
  assert(await verifyWechatNotification(headers, rawBody, 'PUB_KEY_ID_test', pem, timestamp));
  assert(!await verifyWechatNotification(headers, rawBody + ' ', 'PUB_KEY_ID_test', pem, timestamp));
  assert(!await verifyWechatNotification(headers, rawBody, 'other', pem, timestamp));
  assert(!await verifyWechatNotification(headers, rawBody, 'PUB_KEY_ID_test', pem, timestamp + 301));
  headers.set('wechatpay-signature', 'invalid');
  assert(!await verifyWechatNotification(headers, rawBody, 'PUB_KEY_ID_test', pem, timestamp));
});

Deno.test('微信交易核对：商户、应用、币种与总金额一致，忽略优惠后的实付额', () => {
  const trade = {
    trade_state: 'SUCCESS', appid: 'app', mchid: 'merchant',
    out_trade_no: 'order', transaction_id: 'trade',
    amount: { total: 1234, currency: 'CNY', payer_total: 1000 },
  };
  assert(validateWechatTrade(trade, 'app', 'merchant') === '12.34');
  for (const invalid of [
    { ...trade, appid: 'other' }, { ...trade, mchid: 'other' }, { ...trade, transaction_id: '' },
    { ...trade, amount: { total: 12.34, currency: 'CNY' } },
    { ...trade, amount: { total: -1, currency: 'CNY' } },
    { ...trade, amount: { total: 1234, currency: 'USD' } },
  ]) {
    let rejected = false;
    try { validateWechatTrade(invalid, 'app', 'merchant'); } catch { rejected = true; }
    assert(rejected, '非法交易必须拒绝');
  }
});
