// 支付宝 AI 网页应用收款 - 统一下单 Edge Function（alipay.trade.page.pay）
// 前端确认套餐/金额/原UUID，数据库创建或恢复原订单，pageExec 生成支付表单。
// 密钥仅从 Edge Function Secrets 注入：ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY(PKCS#1 原值) /
// ALIPAY_PUBLIC_KEY / ALIPAY_GATEWAY / ALIPAY_SITE_URL / ALIPAY_NOTIFY_URL(可选)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
import { beginCheckout, checkoutReceipt, CheckoutError, type CheckoutOrder } from '../_shared/checkout.ts';
import {
  AlipayConfigError,
  createAlipaySdk,
  getAlipayConfig,
  normalizeAmountText,
  sanitizeSubject,
} from '../_shared/alipay.ts';

function json(body: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
const ok = (data: unknown, cors: Record<string, string>) =>
  json({ code: 0, message: 'success', data }, cors);
const err = (message: string, cors: Record<string, string>, status = 400) =>
  json({ code: 1, message, data: null }, cors, status);

export async function handleAlipayPaymentOrder(req: Request) {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') return err('仅支持 POST', corsHeaders, 405);

  // 1. 验证用户 JWT（下单必须登录）
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '') || '';
  if (!token || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || token.startsWith('ak_')) return err('请使用个人登录会话', corsHeaders, 401);
  const { data: { user }, error: authErr } = await createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  ).auth.getUser(token);
  if (authErr || !user) return err('认证失败', corsHeaders, 401);

  let runtimeConfig;
  try {
    runtimeConfig = getAlipayConfig();
  } catch (e) {
    if (e instanceof AlipayConfigError) return json({ code: 1, message: '支付宝支付暂未开通，请稍后重试或选择其他支付渠道', outcome: 'rejected' }, corsHeaders, 503);
    throw e;
  }

  let order: CheckoutOrder | undefined;
  try {
    const body = await req.json().catch(() => { throw new CheckoutError('支付参数非法', 400); });
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    order = await beginCheckout(supabaseAdmin, user.id, 'alipay', body);
    if (order.status !== 'pending') return ok(checkoutReceipt(order), corsHeaders);
    const totalAmount = normalizeAmountText(order.total_amount);
    if (!totalAmount) return err('套餐价格格式非法', corsHeaders, 500);

    const orderNo = order.order_no;

    // 4. 生成支付页面表单 HTML（页面跳转类 API 必须使用 pageExec + POST）
    const sdk = createAlipaySdk();
    const requestOptions: Record<string, unknown> = {
      bizContent: {
        out_trade_no: orderNo,
        total_amount: totalAmount,
        subject: sanitizeSubject(`Shopro-${order.plan_snapshot.name}`),
        product_code: 'FAST_INSTANT_TRADE_PAY',
      },
    };
    // 本地验收无公网 HTTPS 通知地址时直接省略 notifyUrl，禁止传空串/占位值
    if (runtimeConfig.notifyUrl) {
      requestOptions.notifyUrl = runtimeConfig.notifyUrl;
    }
    // 同步回跳仅作支付结束提示，结果以异步通知/交易查询为准
    if (runtimeConfig.siteUrl) {
      requestOptions.returnUrl = `${runtimeConfig.siteUrl.replace(/\/+$/, '')}/alipay-return?order_no=${encodeURIComponent(orderNo)}`;
    }
    const paymentHtml = sdk.pageExec('alipay.trade.page.pay', 'POST', requestOptions as never);

    return ok({
      ...checkoutReceipt(order),
      payment_html: paymentHtml,
      amount: totalAmount,
    }, corsHeaders);
  } catch (e) {
    if (e instanceof CheckoutError) return json({ code: 1, message: e.message, outcome: e.outcome }, corsHeaders, e.status);
    return json({ code: 1, message: '支付表单暂不可用，请恢复原支付请求', outcome: 'unknown',
      data: order ? checkoutReceipt(order) : null }, corsHeaders, 503);
  }
}
Deno.serve(handleAlipayPaymentOrder);
