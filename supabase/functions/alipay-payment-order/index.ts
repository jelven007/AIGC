// 支付宝 AI 网页应用收款 - 统一下单 Edge Function（alipay.trade.page.pay）
// 前端 POST { plan_id }，服务端创建订单并返回支付页面 HTML 表单（pageExec 生成，禁止 exec）。
// 密钥仅从 Edge Function Secrets 注入：ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY(PKCS#1 原值) /
// ALIPAY_PUBLIC_KEY / ALIPAY_GATEWAY / ALIPAY_SITE_URL / ALIPAY_NOTIFY_URL(可选)
import { createClient } from 'npm:@supabase/supabase-js@2';
import ShortUniqueId from 'npm:short-unique-id';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
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

function generateOrderNo(): string {
  const uid = new ShortUniqueId({ length: 8 });
  const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `ALIPAY-${yymmdd}-${uid.rnd()}`;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') return err('仅支持 POST', corsHeaders, 405);

  // 1. 验证用户 JWT（下单必须登录）
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return err('未授权', corsHeaders, 401);
  const { data: { user }, error: authErr } = await createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  ).auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) return err('认证失败', corsHeaders, 401);

  let runtimeConfig;
  try {
    runtimeConfig = getAlipayConfig();
  } catch (e) {
    if (e instanceof AlipayConfigError) return err(e.message, corsHeaders, 503);
    throw e;
  }

  try {
    const body = await req.json();
    const { plan_id: planId } = body as { plan_id?: string };
    if (!planId) return err('缺少 plan_id', corsHeaders);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 2. 读取套餐并以服务端价格为准（金额不信任前端）
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id, name, price, credits, level')
      .eq('id', planId)
      .maybeSingle();
    if (!plan) return err('套餐不存在', corsHeaders);
    if (Number(plan.price) <= 0) return err('免费套餐无需支付', corsHeaders);

    const totalAmount = normalizeAmountText(plan.price);
    if (!totalAmount) return err('套餐价格格式非法', corsHeaders, 500);

    // 3. 商户订单号唯一（partnerId + out_trade_no 在支付宝端唯一对应一笔单据）
    const orderNo = generateOrderNo();
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .insert({
        order_no: orderNo,
        user_id: user.id,
        plan_id: plan.id,
        status: 'pending',
        total_amount: totalAmount,
        pay_channel: 'alipay',
      })
      .select('id, order_no, status, total_amount')
      .maybeSingle();
    if (orderErr || !order) {
      console.error('[alipay-payment-order] insert order failed:', orderErr?.message);
      return err('订单创建失败', corsHeaders, 500);
    }

    // 4. 生成支付页面表单 HTML（页面跳转类 API 必须使用 pageExec + POST）
    const sdk = createAlipaySdk();
    const requestOptions: Record<string, unknown> = {
      bizContent: {
        out_trade_no: orderNo,
        total_amount: totalAmount,
        subject: sanitizeSubject(`Shopro-${plan.name}`),
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
      order_no: order.order_no,
      order_id: order.id,
      payment_html: paymentHtml,
      plan_name: plan.name,
      amount: totalAmount,
    }, corsHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '服务内部错误';
    console.error('[alipay-payment-order]', msg);
    return err(msg, corsHeaders, 500);
  }
});
