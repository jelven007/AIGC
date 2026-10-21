/** 微信支付 API v3 通知必须使用未经改写的原始请求体验签。 */
export async function verifyWechatNotification(
  headers: Headers,
  rawBody: string,
  publicKeyId: string,
  publicKeyPem: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const timestamp = headers.get('wechatpay-timestamp') ?? '';
  const nonce = headers.get('wechatpay-nonce') ?? '';
  const signature = headers.get('wechatpay-signature') ?? '';
  const serial = headers.get('wechatpay-serial') ?? '';
  if (!/^\d+$/.test(timestamp) || !nonce || !signature || !serial || serial !== publicKeyId) return false;
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  try {
    const pem = publicKeyPem.replace(/\\n/g, '\n');
    const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
    const keyBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'spki', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const message = new TextEncoder().encode(`${timestamp}\n${nonce}\n${rawBody}\n`);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signatureBytes, message);
  } catch {
    return false;
  }
}

export interface WechatTrade {
  trade_state?: string;
  out_trade_no?: string;
  transaction_id?: string;
  appid?: string;
  mchid?: string;
  amount?: { total?: number; currency?: string };
}

/** 成功通知中的支付总额以整数分计，不能使用优惠后的 payer_total 代替。 */
export function validateWechatTrade(trade: WechatTrade, appId: string, merchantId: string): string {
  if (trade.trade_state !== 'SUCCESS' || trade.appid !== appId || trade.mchid !== merchantId
    || !trade.out_trade_no || !trade.transaction_id || trade.amount?.currency !== 'CNY'
    || !Number.isSafeInteger(trade.amount.total) || (trade.amount.total ?? 0) <= 0) {
    throw new Error('微信支付商户、应用、交易或金额校验失败');
  }
  const cents = trade.amount.total!;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export class WechatConfigError extends Error {}
export function getWechatConfig() {
  const read = (name: string) => (Deno.env.get(name) || '').trim().replace(/\\n/g, '\n');
  const config = {
    mchid: read('MERCHANT_ID'), appid: read('MERCHANT_APP_ID'),
    serial: read('MCH_CERT_SERIAL_NO'), privateKey: read('MCH_PRIVATE_KEY'),
    publicKeyId: read('WECHAT_PAY_PUBLIC_KEY_ID'), publicKey: read('WECHAT_PAY_PUBLIC_KEY'),
  };
  if (Object.values(config).some(value => !value)) throw new WechatConfigError('微信支付配置未完成');
  if (![config.mchid, config.appid, config.serial, config.publicKeyId].every(value => /^[A-Za-z0-9_-]{1,64}$/.test(value))) {
    throw new WechatConfigError('微信支付标识非法');
  }
  return config;
}
export type WechatConfig = ReturnType<typeof getWechatConfig>;
const bytes = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
function privateKeyBytes(pem: string) {
  const raw = bytes(pem.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g, ''));
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) return raw;
  const length = (size: number) => size < 128 ? [size] : size < 256 ? [0x81, size] : [0x82, size >> 8, size & 255];
  // PKCS#1外包PKCS#8 PrivateKeyInfo，保留历史商户RSA PEM配置。
  const content = [2, 1, 0, 0x30, 0x0d, 6, 9, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1, 5, 0,
    4, ...length(raw.length), ...raw];
  return new Uint8Array([0x30, ...length(content.length), ...content]);
}
export function wechatDescription(text: string) {
  let result = '';
  for (const char of text) {
    if (new TextEncoder().encode(result + char).byteLength > 127) break;
    result += char;
  }
  return result;
}

/** 固定官方域名；签名涵盖原路径、查询串和原正文。任何自动重试由持久化队列决定。 */
export async function wechatRequest(config: WechatConfig, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) {
  if (!/^\/v3\/[A-Za-z0-9/?=&_%.-]+$/.test(path)) throw new Error('微信接口路径非法');
  const raw = body ? JSON.stringify(body) : '';
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(config.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(`${method}\n${path}\n${timestamp}\n${nonce}\n${raw}\n`)));
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'Wechatpay-Serial': config.publicKeyId,
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.serial}",signature="${btoa(String.fromCharCode(...signature))}"`,
    }, ...(method === 'POST' ? { body: raw } : {}),
  });
  // 204只表示关单请求返回，必须另查到已验签的CLOSED才能改变本地资金状态。
  if (response.status === 204) return { status: 204, data: {} as Record<string, unknown>, verified: false };
  const reader = response.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (!reader) throw new Error('微信应答缺少正文');
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error('微信应答过大'); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { all.set(part, offset); offset += part.byteLength; }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(all);
  if (!await verifyWechatNotification(response.headers, text, config.publicKeyId, config.publicKey)) {
    throw new Error('微信应答验签失败');
  }
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('微信应答非法');
  return { status: response.status, data: data as Record<string, unknown>, verified: true };
}

export function wechatCents(value: unknown): number {
  const match = String(value).match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('微信金额非法');
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (cents <= 0 || cents > 2147483647n) throw new Error('微信金额超出支持范围');
  return Number(cents);
}

/** 验签之后解密AEAD通知；不返回或存储外层通知/买家身份。 */
export async function decryptWechatResource(body: Record<string, unknown>) {
  const resource = body.resource as Record<string, unknown> | undefined;
  const apiKey = Deno.env.get('MCH_API_V3_KEY') || '';
  if (new TextEncoder().encode(apiKey).length !== 32 || resource?.algorithm !== 'AEAD_AES_256_GCM'
    || typeof resource.ciphertext !== 'string' || typeof resource.nonce !== 'string'
    || resource.associated_data !== undefined && typeof resource.associated_data !== 'string') throw new Error('微信通知资源非法');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiKey), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: new TextEncoder().encode(resource.nonce),
    additionalData: new TextEncoder().encode(String(resource.associated_data || '')), tagLength: 128,
  }, key, bytes(resource.ciphertext));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as Record<string, unknown>;
}
