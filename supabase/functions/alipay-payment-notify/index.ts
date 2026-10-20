// 支付宝 AI 网页应用收款 - 异步通知接收 Edge Function（notify_url）
// 规范：支付宝以 application/x-www-form-urlencoded POST 通知，禁止按 JSON 解析；
// 必须全量收集参数验签 → 校验 app_id/out_trade_no/total_amount/seller → 幂等入账 → 返回纯文本 success。
// 公网联调需将 ALIPAY_NOTIFY_URL 配置为本函数公网 HTTPS 地址：
//   {SUPABASE_URL}/functions/v1/alipay-payment-notify
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
import {
  AlipayConfigError,
  amountEquals,
  createAlipaySdk,
  finalizePaidOrder,
  getAlipayConfig,
  isPaidTradeNotification,
  safeLogNotifyError,
} from '../_shared/alipay.ts';

const textRes = (text: string, cors: Record<string, string>, status = 200) =>
  new Response(text, { status, headers: { ...cors, 'Content-Type': 'text/plain' } });

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') return textRes('fail', corsHeaders, 405);

  let config;
  let params: Record<string, string>;
  try {
    config = getAlipayConfig();
    // 表单解析：验签前不得丢字段、改字段名或改字段值
    const form = await req.formData();
    params = {};
    form.forEach((value, key) => {
      if (typeof value === 'string') params[key] = value;
    });
  } catch (e) {
    if (e instanceof AlipayConfigError) {
      console.error('[alipay-notify]', e.message);
      return textRes('fail', corsHeaders, 503);
    }
    console.error('[alipay-notify] bad form body', e);
    return textRes('fail', corsHeaders, 400);
  }

  const logger = { warn: (...args: unknown[]) => console.warn(...args) };

  try {
    // 1. 用通知中的 app_id 选择运行时配置（仅为选择验签上下文，不代表信任通知内容）
    if (params.app_id !== config.appId) {
      safeLogNotifyError(logger, '[alipay-notify] app_id mismatch', params);
      return textRes('fail', corsHeaders);
    }

    // 2. SDK 验签（alipay-sdk@4.14.0 已确认暴露 checkNotifySignV2）
    const sdk = createAlipaySdk();
    let verified = false;
    try {
      verified = sdk.checkNotifySignV2(params);
    } catch (verifyErr) {
      console.error('[alipay-notify] verify exception:', verifyErr instanceof Error ? verifyErr.message : verifyErr);
    }
    if (!verified) {
      safeLogNotifyError(logger, '[alipay-notify] signature check failed', params);
      return textRes('fail', corsHeaders);
    }

    // 3. 业务关键字段校验：订单存在、金额一致、卖家匹配
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, order_no, user_id, plan_id, total_amount, status, pay_channel')
      .eq('order_no', params.out_trade_no ?? '')
      .maybeSingle();

    const sellerOk =
      (!config.sellerId && !config.sellerEmail) ||
      (config.sellerId && params.seller_id === config.sellerId) ||
      (config.sellerEmail && params.seller_email === config.sellerEmail);

    if (!order || order.pay_channel !== 'alipay' || !amountEquals(order.total_amount, params.total_amount) || !sellerOk) {
      safeLogNotifyError(logger, '[alipay-notify] business check failed', {
        ...params,
        _localAmount: String(order?.total_amount ?? ''),
        _sellerOk: String(sellerOk),
      });
      return textRes('fail', corsHeaders);
    }

    // 4. 事件去重仅用于审计；重复通知仍执行入账事务，补偿上次发放失败。
    const { error: insertErr } = await supabaseAdmin
      .from('alipay_notify_events')
      .insert({
        notify_id: params.notify_id ?? '',
        trade_no: params.trade_no ?? null,
        out_trade_no: params.out_trade_no ?? '',
        trade_status: params.trade_status ?? '',
        notify_type: params.notify_type ?? null,
        total_amount: params.total_amount ?? null,
        out_biz_no: params.out_biz_no ?? null,
        gmt_refund: params.gmt_refund ?? null,
        refund_fee: params.refund_fee ?? null,
      });
    if (insertErr && insertErr.code !== '23505') {
      console.error('[alipay-notify] event insert failed:', insertErr.message);
      return textRes('fail', corsHeaders);
    }

    // 5. 仅付款成功事件（排除退款/关单/分账）才标记已支付并发放权益；
    //    退款/关闭等其他事件记录后仍回 success，避免支付宝重复推送
    if (isPaidTradeNotification(params)) {
      await finalizePaidOrder(supabaseAdmin, params.out_trade_no ?? '', params.trade_no ?? '', params.total_amount ?? '');
    } else {
      console.log(`[alipay-notify] non-paid event ${params.notify_type ?? params.trade_status} for ${params.out_trade_no}`);
    }

    return textRes('success', corsHeaders);
  } catch (e) {
    safeLogNotifyError(logger, '[alipay-notify] unexpected exception', params);
    console.error('[alipay-notify]', e instanceof Error ? e.message : e);
    return textRes('fail', corsHeaders);
  }
});
