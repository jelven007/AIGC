import { authenticateRequest, createServiceClient } from './auth.ts';
import { getCorsHeaders, handleCorsPreflight } from './cors.ts';
import { AlipayConfigError, amountEquals, createAlipaySdk, getAlipayConfig, normalizeAmountText, readResultField } from './alipay.ts';
import { executeCashRefund, refundReceipt, type CashRefund } from './cash-refunds.ts';
import { responseBytes } from './audio-provider.ts';
import { executeWechatOrder } from './wechat-transactions.ts';
import { executeWechatRefund } from './wechat-refunds.ts';
import { WechatConfigError } from './wechat.ts';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function handleCashTradeOps(req: Request, channel: 'alipay' | 'wechat'): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const ok = (data: unknown, status = 200) => Response.json({ code: 0, message: 'success', data }, { status, headers });
  const fail = (message: string, status = 400, unknown = false) =>
    Response.json({ code: 1, message, data: null, ...(unknown ? { outcome: 'unknown' }
      : status === 400 ? { outcome: 'rejected' } : {}) }, { status, headers });
  if (req.method !== 'POST') return fail('仅支持 POST', 405);
  let started = false;
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole || auth.apiKeyId) return fail('请使用个人登录会话', 401);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await responseBytes(new Response(req.body), 8192))); }
    catch { return fail('交易正文非法或超过8KB'); }
    if (!body || !['refund', 'refundQuery', 'receipt', 'close', ...(channel === 'wechat' ? ['query'] : [])].includes(body.action)
      || typeof body.order_no !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.order_no)
      || channel === 'wechat' && body.order_no.length > 32) return fail('交易操作或订单编号非法');
    const db = createServiceClient();
    const limited = await db.rpc('upsert_rate_limit', { p_window_key: `cash:${auth.user.id}:${Math.floor(Date.now() / 60000)}`,
      p_client_id: `cash:${auth.user.id}`, p_reset_at: new Date(Date.now() + 60000).toISOString(), p_max_req: 30 });
    if (limited.error) return fail('交易限流服务不可用', 503);
    if (!limited.data) return fail('交易操作过于频繁', 429);
    const found = await db.from('orders').select('id,order_no,user_id,pay_channel,status,provider_trade_no')
      .eq('order_no', body.order_no).maybeSingle();
    if (found.error) return fail('订单读取失败', 503);
    const order = found.data;
    if (!order) return fail('订单不存在', 404);
    const permission = await db.rpc('operator_can', { p_actor: auth.user.id, p_permission: 'refunds:write', p_scope: order.user_id });
    if (permission.error) return fail('运营权限服务不可用', 503);
    const canRefund = permission.data === true;
    if (!['close', 'query'].includes(body.action) && !canRefund) return fail('无退款运营权限', 403);
    if (['close', 'query'].includes(body.action) && order.user_id !== auth.user.id && !canRefund) return fail('订单不存在', 404);
    if (order.pay_channel !== channel) return fail('订单渠道不匹配');
    if (channel === 'wechat' && ['close', 'query'].includes(body.action)) {
      started = true;
      const receipt = await executeWechatOrder(db, auth.user.id, order.order_no, body.action);
      return ok(receipt, receipt.checking ? 202 : 200);
    }
    let row: CashRefund | null = null;
    if (body.action !== 'close') {
      if (body.out_request_no !== undefined && (typeof body.out_request_no !== 'string'
        || !/^[A-Za-z0-9_-]{1,64}$/.test(body.out_request_no))) return fail('退款编号非法');
      if (body.out_request_no || body.action !== 'refund') {
        if (!body.out_request_no && !uuid(body.request_key)) return fail('缺少原退款标识');
        let query = db.from('alipay_refunds').select('*').eq('order_id', order.id);
        query = body.out_request_no ? query.eq('out_request_no', body.out_request_no) : query.eq('request_key', body.request_key);
        const result = await query.maybeSingle();
        if (result.error) return fail('原申请核对失败', 503);
        if (!result.data) return fail('退款记录不存在', 404);
        row = result.data as CashRefund;
        if (body.refund_amount !== undefined && !amountEquals(body.refund_amount, row.refund_amount)
          || body.refund_reason !== undefined && body.refund_reason !== row.refund_reason) return fail('重试不能修改原退款金额或原因', 409);
        if (body.request_key && body.request_key !== row.request_key) return fail('原退款标识不匹配', 409);
        if (body.action === 'receipt') return ok(refundReceipt(row));
      } else {
        if (body.action !== 'refund' || !uuid(body.request_key)) return fail('新退款必须提供有效的原请求 UUID');
        const amount = normalizeAmountText(body.refund_amount);
        if (!amount || amount === '0.00' || amount.length > 13 || typeof body.refund_reason !== 'string'
          || !body.refund_reason.trim() || body.refund_reason.length > 200) return fail('退款金额或原因非法');
        const reserved = await db.rpc('reserve_cash_refund', {
          p_actor: auth.user.id, p_order_no: order.order_no, p_request_key: body.request_key,
          p_amount: amount, p_reason: body.refund_reason.trim(),
        });
        if (reserved.error || !reserved.data) {
          const message = reserved.error?.message || '';
          if (/同一请求标识/.test(message)) return fail(message, 409, true);
          if (/累计退款|历史累计|仅可信|微信原商户/.test(message)) return Response.json({
            code: 1, message, data: null, outcome: 'rejected',
          }, { status: 409, headers });
          if (/无运营权限/.test(message)) return fail('无退款运营权限', 403);
          return fail('退款申请受理待确认，请保留原请求 UUID 核对', 503, true);
        }
        row = reserved.data as CashRefund;
      }
      if (row.status === 'closed' || row.status === 'success' && row.applied_at) return ok(refundReceipt(row));
      if (channel === 'alipay') getAlipayConfig();
      started = true;
      const execute = channel === 'wechat' ? executeWechatRefund : executeCashRefund;
      const receipt = await execute(db, auth.user.id, order.order_no, row.out_request_no, body.action === 'refund');
      return ok(receipt, ['success', 'closed'].includes(receipt.refund_status) ? 200 : 202);
    }
    if (order.status === 'cancelled') return ok({ order_no: order.order_no, local_status: 'cancelled', closed: true });
    if (order.status !== 'pending') return fail('仅待支付订单可关闭', 409);
    getAlipayConfig();
    const response = await createAlipaySdk().exec('alipay.trade.close', {
      bizContent: { out_trade_no: order.order_no },
    }, { validateSign: true });
    const confirmed = readResultField(response, 'code') === '10000'
      && readResultField(response, 'out_trade_no') === order.order_no;
    // 未找到交易并不证明网关中没有并发支付，保持本地 pending，交由查单核对。
    if (!confirmed) return fail('交易关闭未确认，请查询原订单', 502);
    const closed = await db.rpc('close_paid_order_guarded', { p_actor: auth.user.id, p_order_no: order.order_no });
    if (closed.error) return fail('本地关闭结果待确认，请查询原订单', 503, true);
    return ok({ order_no: order.order_no, local_status: closed.data, closed: closed.data === 'cancelled' });
  } catch (cause) {
    if (cause instanceof AlipayConfigError) return fail('支付宝支付配置未完成', 503);
    if (cause instanceof WechatConfigError) return fail('微信支付配置未完成', 503);
    return fail(started ? '交易结果待确认，请使用原申请或原订单核对' : '交易服务暂不可用', 503, started);
  }
}
