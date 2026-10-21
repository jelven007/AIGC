import assert from 'node:assert/strict';

/** 夹具只替换HTTP，真实WebCrypto签名/原文验签/AES-GCM协议均执行。 */
export async function wechatFixture(env) {
  const keys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const pem = async (format, key, label) => `-----BEGIN ${label}-----\n${Buffer.from(await crypto.subtle.exportKey(format, key)).toString('base64')}\n-----END ${label}-----`;
  Object.assign(env, { MERCHANT_ID: 'merchant', MERCHANT_APP_ID: 'app', MCH_CERT_SERIAL_NO: 'serial',
    MCH_PRIVATE_KEY: await pem('pkcs8', keys.privateKey, 'PRIVATE KEY'),
    WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_fixture', WECHAT_PAY_PUBLIC_KEY: await pem('spki', keys.publicKey, 'PUBLIC KEY'),
    MCH_API_V3_KEY: '12345678901234567890123456789012' });
  const calls = [];
  async function signed(raw, status = 200, overrides = {}) {
    const timestamp = Math.floor(Date.now() / 1000), nonce = 'upstream-nonce';
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey,
      new TextEncoder().encode(`${timestamp}\n${nonce}\n${raw}\n`));
    return new Response(raw, { status, headers: {
      'Wechatpay-Timestamp': String(timestamp), 'Wechatpay-Nonce': nonce,
      'Wechatpay-Serial': env.WECHAT_PAY_PUBLIC_KEY_ID,
      'Wechatpay-Signature': Buffer.from(signature).toString('base64'), ...overrides,
    } });
  }
  async function request(url, options) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.mch.weixin.qq.com'); assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const auth = options.headers.Authorization;
    const fields = Object.fromEntries([...auth.matchAll(/(\w+)="([^"]+)"/g)].map(match => [match[1], match[2]]));
    assert.equal(fields.mchid, env.MERCHANT_ID); assert.equal(fields.serial_no, env.MCH_CERT_SERIAL_NO);
    assert.equal(options.headers['Wechatpay-Serial'], env.WECHAT_PAY_PUBLIC_KEY_ID);
    const raw = options.body || '';
    assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(fields.signature, 'base64'),
      new TextEncoder().encode(`${options.method}\n${parsed.pathname}${parsed.search}\n${fields.timestamp}\n${fields.nonce_str}\n${raw}\n`)));
    calls.push({ method: options.method, path: parsed.pathname, query: parsed.search, raw, body: raw ? JSON.parse(raw) : null });
    if (options.method === 'GET') assert.equal(options.body, undefined);
    return calls.at(-1);
  }
  async function notification(event, payload) {
    const nonce = 'refund-nonce', associated = 'refund';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MCH_API_V3_KEY), 'AES-GCM', false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new TextEncoder().encode(nonce),
      additionalData: new TextEncoder().encode(associated), tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(payload)));
    const raw = JSON.stringify({ event_type: event, resource: { algorithm: 'AEAD_AES_256_GCM', nonce,
      associated_data: associated, ciphertext: Buffer.from(encrypted).toString('base64') } });
    const response = await signed(raw);
    return new Request('https://db.example/functions/v1/webhook', { method: 'POST', headers: response.headers, body: raw });
  }
  return { calls, signed, request, notification };
}
