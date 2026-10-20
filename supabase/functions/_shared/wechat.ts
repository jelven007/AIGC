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
