// 创建微信支付订单 Edge Function
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { beginCheckout, checkoutReceipt, CheckoutError, type CheckoutOrder } from '../_shared/checkout.ts';
import { executeWechatOrder } from '../_shared/wechat-transactions.ts';
import { getWechatConfig, WechatConfigError } from '../_shared/wechat.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

export async function handleWechatPaymentOrder(req: Request) {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  if (req.method !== 'POST') return json({ code: 1, message: '仅支持 POST', outcome: 'rejected' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let order: CheckoutOrder | undefined;
  try {
    // 验证用户 JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '') || '';
    if (!token || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || token.startsWith('ak_')) {
      return json({ code: 1, message: '请使用个人登录会话', outcome: 'rejected' }, 401);
    }
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    ).auth.getUser(token);
    if (authErr || !user) return json({ code: 1, message: '认证失败', outcome: 'rejected' }, 401);

    let body;
    try { body = JSON.parse(new TextDecoder().decode(await responseBytes(new Response(req.body), 8192))); }
    catch { throw new CheckoutError('支付正文非法或超过8KB', 400); }
    getWechatConfig();

    order = await beginCheckout(supabase, user.id, 'wechat', body);
    const receipt = await executeWechatOrder(supabase, user.id, order.order_no, 'create');
    return json({ code: 0, data: receipt }, receipt.checking ? 202 : 200);
  } catch (e) {
    if (e instanceof WechatConfigError) return json({ code: 1, message: '微信支付暂未开通', outcome: 'rejected' }, 503);
    if (e instanceof SyntaxError) return json({ code: 1, message: '支付参数非法', outcome: 'rejected' }, 400);
    if (e instanceof CheckoutError) return json({ code: 1, message: e.message, outcome: e.outcome }, e.status);
    return json({ code: 1, message: '微信订单受理结果待核对，请恢复原支付请求', outcome: 'unknown',
      data: order ? checkoutReceipt(order) : null }, 503);
  }
}
Deno.serve(handleWechatPaymentOrder);
