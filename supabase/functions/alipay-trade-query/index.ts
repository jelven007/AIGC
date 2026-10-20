// 支付宝 AI 网页应用收款 - 交易查询 Edge Function（alipay.trade.query）
// 用途：同步回跳结果页与前端轮询兜底（本地无公网 notify_url 时的最终一致性来源）。
// 调用方式（遵循 GET 参数拼 URL 规范）：
//   supabase.functions.invoke(`alipay-trade-query?order_no=${orderNo}`, { method: 'GET' })
// 服务端查单成功后如为已支付，执行幂等补偿入账（finalizePaidOrder），不信任前端传入的支付结果。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
import {
  AlipayConfigError,
  amountEquals,
  createAlipaySdk,
  finalizePaidOrder,
  getAlipayConfig,
  mapTradeStatus,
  readResultField,
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

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== 'GET') return err('仅支持 GET', corsHeaders, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return err('未授权', corsHeaders, 401);
  const url = new URL(req.url);
  const orderNo = (url.searchParams.get('order_no') || '').trim();
  if (!orderNo) return err('缺少 order_no', corsHeaders);

  try {
    getAlipayConfig();
  } catch (e) {
    if (e instanceof AlipayConfigError) return err(e.message, corsHeaders, 503);
    throw e;
  }

  try {
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authErr || !user) return err('认证失败', corsHeaders, 401);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. 订单归属校验（只允许查询本人订单）
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, order_no, user_id, plan_id, total_amount, status, pay_channel, alipay_trade_no, entitlement_granted_at')
      .eq('order_no', orderNo)
      .maybeSingle();
    if (!order || order.user_id !== user.id) return err('订单不存在', corsHeaders, 404);
    if (order.pay_channel !== 'alipay') return err('订单渠道不匹配', corsHeaders, 400);

    // 本地已支付直接返回，避免重复外呼
    if (order.status === 'paid' && order.entitlement_granted_at) {
      return ok({ order_no: order.order_no, local_status: 'paid', trade_status: 'TRADE_SUCCESS', amount: order.total_amount }, corsHeaders);
    }
    if (order.status === 'paid') return err('历史订单权益需要核对，请联系客服', corsHeaders, 409);

    // 2. 调起 alipay.trade.query（非页面跳转类 API 使用 exec）
    const sdk = createAlipaySdk();
    const res = await sdk.exec('alipay.trade.query', {
      bizContent: { out_trade_no: order.order_no },
    });
    const response = res as any;
    const subCode = readResultField(response, 'sub_code') ?? response?.error_response?.subCode;
    if (subCode === 'ACQ.TRADE_NOT_EXIST') {
      // 用户尚未在支付宝完成下单，本地保持 pending
      return ok({ order_no: order.order_no, local_status: order.status, trade_status: 'NOT_EXIST', amount: order.total_amount }, corsHeaders);
    }
    if (response?.error_response || (readResultField(response, 'code') && readResultField(response, 'code') !== '10000')) {
      console.error('[alipay-trade-query] upstream failed:', JSON.stringify(response?.error_response ?? response));
      return err('支付宝查询失败', corsHeaders, 502);
    }

    const tradeStatus = readResultField(response, 'trade_status');
    const tradeNo = readResultField(response, 'trade_no');
    const queryAmount = readResultField(response, 'total_amount');
    const mapped = mapTradeStatus(tradeStatus);

    // 3. 金额一致性校验后才可采信支付结果
    if (mapped === 'PAID') {
      if (!amountEquals(order.total_amount, queryAmount)) {
        console.error(`[alipay-trade-query] amount mismatch for ${order.order_no}: local=${order.total_amount} remote=${queryAmount}`);
        return ok({ order_no: order.order_no, local_status: order.status, trade_status: 'AMOUNT_MISMATCH', amount: order.total_amount }, corsHeaders);
      }
      // 幂等补偿入账（与异步通知互斥，重复不二次发放）
      await finalizePaidOrder(supabaseAdmin, order.order_no, tradeNo ?? '', String(queryAmount ?? ''));
      return ok({ order_no: order.order_no, local_status: 'paid', trade_status: tradeStatus, amount: order.total_amount }, corsHeaders);
    }

    // 已关闭交易同步本地状态
    if (mapped === 'CLOSED' && order.status === 'pending') {
      await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('order_no', order.order_no)
        .eq('status', 'pending');
    }

    return ok({ order_no: order.order_no, local_status: mapped === 'CLOSED' ? 'cancelled' : order.status, trade_status: tradeStatus, amount: order.total_amount }, corsHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '服务内部错误';
    console.error('[alipay-trade-query]', msg);
    return err(msg, corsHeaders, 500);
  }
});
