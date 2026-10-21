import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
import { decryptWechatResource, verifyWechatNotification, type WechatTrade } from '../_shared/wechat.ts';
import { finalizeWechatTrade } from '../_shared/wechat-transactions.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

export async function handleWechatPaymentWebhook(req: Request) {
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
    const rawBody = new TextDecoder().decode(await responseBytes(new Response(req.body), 65536));
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
    const trade = await decryptWechatResource(body) as WechatTrade;
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await finalizeWechatTrade(admin, trade);
    return respond('SUCCESS', '成功');
  } catch {
    // 入账失败返回非成功响应，允许微信重试同一交易。
    return respond('FAIL', '支付入账失败，请重试', 500);
  }
}
Deno.serve(handleWechatPaymentWebhook);
