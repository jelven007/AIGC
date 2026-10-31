import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { checkoutReceipt, type CheckoutOrder } from './checkout.ts';
import { finalizePayment } from './payments.ts';
import { getWechatConfig, validateWechatTrade, wechatCents, wechatDescription, wechatRequest, type WechatConfig, type WechatTrade } from './wechat.ts';

export interface WechatOrder extends CheckoutOrder {
  refunded_amount: string | number; wechat_expires_at: string | null; wechat_close_requested_at: string | null;
}
export function wechatOrderReceipt(order: WechatOrder) {
  const payable = order.status === 'pending' && !!order.wechat_expires_at
    && Date.parse(order.wechat_expires_at) > Date.now() && !order.wechat_close_requested_at;
  return { ...checkoutReceipt(order), refunded_amount: order.refunded_amount,
    wechat_expires_at: order.wechat_expires_at, close_requested: !!order.wechat_close_requested_at,
    wechat_pay_url: payable ? order.wechat_pay_url : null };
}
export async function queryWechatTrade(config: WechatConfig, orderNo: string) {
  return await wechatRequest(config, 'GET',
    `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(config.mchid)}`);
}
export function bindWechatTrade(trade: WechatTrade, config: Pick<WechatConfig, 'appid' | 'mchid'>, orderNo: string, total: unknown) {
  const moneyRequired = ['SUCCESS', 'REFUND'].includes(trade.trade_state || '');
  if (trade.appid !== config.appid || trade.mchid !== config.mchid || trade.out_trade_no !== orderNo
    || (moneyRequired || trade.amount) && (trade.amount?.currency !== 'CNY'
      || trade.amount.total !== wechatCents(total))) throw new Error('微信交易与原订单不符');
}
export async function finalizeWechatTrade(db: SupabaseClient, trade: WechatTrade) {
  const found = await db.from('orders').select('id,total_amount,pay_channel').eq('order_no', trade.out_trade_no || '').maybeSingle();
  if (found.error || !found.data || found.data.pay_channel !== 'wechat') throw new Error('原微信订单不存在');
  const state = await db.from('wechat_transactions').select('mchid,appid').eq('order_id', found.data.id).maybeSingle();
  if (state.error) throw new Error('原商户读取失败');
  const current = { mchid: Deno.env.get('MERCHANT_ID') || '', appid: Deno.env.get('MERCHANT_APP_ID') || '' };
  const config = state.data?.mchid && state.data?.appid ? state.data : current;
  bindWechatTrade(trade, config, trade.out_trade_no!, found.data.total_amount);
  const amount = validateWechatTrade(trade, config.appid, config.mchid);
  return await finalizePayment(db, trade.out_trade_no!, 'wechat', trade.transaction_id!, amount);
}

export async function executeWechatOrder(db: SupabaseClient, actor: string | null, orderNo: string, action: 'create' | 'query' | 'close') {
  const config = getWechatConfig();
  const claimed = await db.rpc('claim_wechat_order', {
    p_actor: actor, p_order_no: orderNo, p_mchid: config.mchid, p_appid: config.appid, p_action: action,
  });
  if (claimed.error || !claimed.data) throw new Error('原微信订单或商户待核对');
  const { mode, order, transaction } = claimed.data as {
    mode: string; order: WechatOrder; transaction?: { lease_token: string };
  };
  if (['done', 'wait'].includes(mode)) return { ...wechatOrderReceipt(order), checking: mode === 'wait' };
  if (!transaction || !['create', 'query'].includes(mode)) throw new Error('微信交易租约协议不兼容');
  let evidence: Record<string, unknown> = { verified: false, outcome: 'unknown' };
  let codeUrl: string | null = null;
  let unavailable = false;
  try {
    let create = mode === 'create';
    if (mode === 'query') {
      const response = await queryWechatTrade(config, order.order_no);
      const trade = response.data as WechatTrade;
      const absent = response.status === 404 && response.data.code === 'ORDER_NOT_EXIST';
      if (response.status === 200) {
        bindWechatTrade(trade, config, order.order_no, order.total_amount);
        evidence = { verified: true, trade_state: trade.trade_state, out_trade_no: order.order_no,
          mchid: config.mchid, appid: config.appid };
        if (trade.trade_state === 'SUCCESS') await finalizeWechatTrade(db, trade);
        else if (!['NOTPAY', 'USERPAYING', 'CLOSED', 'REFUND'].includes(trade.trade_state || '')) throw new Error('微信交易状态待核对');
      } else if (!absent) throw new Error('微信查单暂不可用');
      const mustClose = !!order.wechat_close_requested_at
        || !!order.wechat_expires_at && Date.parse(order.wechat_expires_at) <= Date.now();
      if (mustClose && (absent || trade.trade_state === 'NOTPAY')) {
        await wechatRequest(config, 'POST', `/v3/pay/transactions/out-trade-no/${order.order_no}/close`, { mchid: config.mchid });
        // 即便204、ORDER_CLOSED或响应丢失，只有下一次签名查单的CLOSED可以确认关闭。
        const closed = await queryWechatTrade(config, order.order_no);
        if (closed.status !== 200) throw new Error('微信关闭待核对');
        bindWechatTrade(closed.data as WechatTrade, config, order.order_no, order.total_amount);
        const state = closed.data.trade_state;
        if (state === 'SUCCESS') await finalizeWechatTrade(db, closed.data as WechatTrade);
        evidence = { verified: true, trade_state: state, out_trade_no: order.order_no, mchid: config.mchid, appid: config.appid };
      }
      create = action === 'create' && !mustClose && !order.wechat_pay_url
        && (absent || trade.trade_state === 'NOTPAY');
      if (absent && !mustClose) evidence = { verified: true, code: 'ORDER_NOT_EXIST', outcome: 'unknown' };
    }
    if (create) {
      const response = await wechatRequest(config, 'POST', '/v3/pay/transactions/native', {
        mchid: config.mchid, appid: config.appid, out_trade_no: order.order_no,
        description: wechatDescription(`视频生成平台-${order.plan_snapshot.name}`),
        notify_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/wechat-payment-webhook`,
        time_expire: order.wechat_expires_at,
        amount: { total: wechatCents(order.total_amount), currency: 'CNY' },
      });
      if (response.status !== 200 || !response.verified || typeof response.data.code_url !== 'string'
        || !/^weixin:\/\/wxpay\/bizpayurl\?/.test(response.data.code_url)) throw new Error('微信二维码受理待核对');
      codeUrl = response.data.code_url;
      evidence = { verified: true, outcome: 'created' };
    }
  } catch { unavailable = true; evidence = { verified: false, outcome: 'unknown' }; }
  const finished = await db.rpc('finish_wechat_order', {
    p_order: order.id, p_lease: transaction.lease_token, p_evidence: evidence, p_code_url: codeUrl,
  });
  if (finished.error || !finished.data) throw new Error('原微信交易回执待核对');
  const receipt = wechatOrderReceipt(finished.data as WechatOrder);
  if (unavailable && receipt.local_status === 'pending') throw new Error('原微信交易结果待核对');
  return { ...receipt, checking: receipt.local_status === 'pending' && !receipt.wechat_pay_url };
}

export async function processWechatOrder(db: SupabaseClient): Promise<boolean> {
  const config = (() => { try { return getWechatConfig(); } catch { return null; } })();
  if (!config) return false;
  const now = new Date().toISOString();
  const due = await db.from('wechat_transactions').select('orders!inner(order_no,status)')
    .eq('mchid', config.mchid).eq('appid', config.appid).eq('orders.status', 'pending')
    .lte('next_query_at', now).or(`lease_until.is.null,lease_until.lt.${now}`).order('next_query_at').limit(1);
  if (due.error) throw new Error('微信核对队列读取失败');
  if (!due.data?.length) return false;
  const order = due.data[0].orders as unknown as { order_no: string };
  await executeWechatOrder(db, null, order.order_no, 'query');
  return true;
}
