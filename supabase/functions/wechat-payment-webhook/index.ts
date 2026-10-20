import { createClient } from 'npm:@supabase/supabase-js@2';
import { Aes } from 'npm:wechatpay-axios-plugin';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
import { finalizePayment } from '../_shared/payments.ts';
import { validateWechatTrade, verifyWechatNotification, type WechatTrade } from '../_shared/wechat.ts';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);
  const respond = (code: string, message: string, status = 200) =>
    new Response(JSON.stringify({ code, message }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  if (req.method !== 'POST') return respond('FAIL', '仅支持 POST', 405);

  const apiKey = Deno.env.get('MCH_API_V3_KEY') ?? '';
  const publicKeyId = Deno.env.get('WECHAT_PAY_PUBLIC_KEY_ID') ?? '';
  const publicKey = Deno.env.get('WECHAT_PAY_PUBLIC_KEY') ?? '';
  const appId = Deno.env.get('MERCHANT_APP_ID') ?? '';
  const merchantId = Deno.env.get('MERCHANT_ID') ?? '';
  if (!apiKey || !publicKeyId || !publicKey || !appId || !merchantId) {
    return respond('FAIL', '微信支付配置未完成', 503);
  }

  try {
    const rawBody = await req.text();
    if (!await verifyWechatNotification(req.headers, rawBody, publicKeyId, publicKey)) {
      return respond('FAIL', '微信支付签名或时间戳校验失败', 401);
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return respond('FAIL', '请求体不是有效 JSON', 400);
    }
    // 此入口只处理支付成功；其他已验签事件不触发权益发放。
    if (body.event_type !== 'TRANSACTION.SUCCESS') return respond('SUCCESS', '成功');
    const resource = body.resource;
    if (resource?.algorithm !== 'AEAD_AES_256_GCM' || !resource.ciphertext || !resource.nonce) {
      return respond('FAIL', '通知加密资源非法', 400);
    }
    const plaintext = await Aes.AesGcm.decrypt(
      resource.ciphertext, apiKey, resource.nonce, resource.associated_data ?? '',
    );
    const trade = JSON.parse(plaintext) as WechatTrade;
    const amount = validateWechatTrade(trade, appId, merchantId);
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await finalizePayment(admin, trade.out_trade_no!, 'wechat', trade.transaction_id!, amount);
    return respond('SUCCESS', '成功');
  } catch (e) {
    console.error('[wechat-payment-webhook]', e instanceof Error ? e.message : e);
    // 入账失败返回非成功响应，允许微信重试同一交易。
    return respond('FAIL', '支付入账失败，请重试', 500);
  }
});
