import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { refundReceipt, type CashRefund } from './cash-refunds.ts';
import { bindWechatTrade, queryWechatTrade } from './wechat-transactions.ts';
import { getWechatConfig, wechatCents, wechatRequest, type WechatTrade } from './wechat.ts';

export function wechatRefundEvidence(payload: Record<string, unknown>, row: CashRefund,
  binding: { mchid: string; tradeNo: string; total: unknown }, method: 'refund' | 'query' | 'notify') {
  const amount = payload.amount as { total?: number; refund?: number; currency?: string } | undefined;
  const status = method === 'notify' ? payload.refund_status : payload.status;
  const valid = payload.transaction_id === binding.tradeNo && payload.out_trade_no === row.out_trade_no
    && payload.out_refund_no === row.out_request_no && typeof payload.refund_id === 'string'
    && /^[A-Za-z0-9_-]{1,64}$/.test(payload.refund_id) && (!row.provider_refund_id || payload.refund_id === row.provider_refund_id)
    && amount?.total === wechatCents(binding.total) && amount.refund === wechatCents(row.refund_amount)
    && (method === 'notify' ? payload.mchid === binding.mchid && (!amount.currency || amount.currency === 'CNY') : amount.currency === 'CNY')
    && ['SUCCESS', 'PROCESSING', 'CLOSED', 'ABNORMAL'].includes(String(status));
  if (!valid) throw new Error('微信退款应答与原申请不符');
  return { verified: true, method, mchid: binding.mchid, trade_no: binding.tradeNo,
    out_trade_no: row.out_trade_no, out_request_no: row.out_request_no,
    amount: String(row.refund_amount), total_amount: String(binding.total),
    refund_id: payload.refund_id, refund_status: status,
    outcome: status === 'SUCCESS' ? 'success' : 'unknown', observed_at: new Date().toISOString() };
}

export async function executeWechatRefund(db: SupabaseClient, actor: string | null, orderNo: string, requestNo: string, submit = false) {
  const config = getWechatConfig();
  const claimed = await db.rpc('claim_cash_refund', { p_actor: actor, p_order_no: orderNo, p_request_no: requestNo, p_submit: submit });
  if (claimed.error || !claimed.data) throw new Error('原微信退款领取待核对');
  const { mode, refund: row, trade_no: tradeNo, total_amount: total, mchid, appid } = claimed.data as {
    mode: string; refund: CashRefund; trade_no: string; total_amount: string; mchid: string; appid: string;
  };
  if (row.pay_channel !== 'wechat') throw new Error('退款渠道不匹配');
  if (['wait', 'done'].includes(mode)) return refundReceipt(row);
  let evidence: Record<string, unknown> = { outcome: 'unknown', method: mode, verified: false };
  try {
    if (config.mchid !== mchid || config.appid !== appid || !['refund', 'query'].includes(mode)) throw new Error('原微信商户不匹配');
    if (mode === 'refund') {
      // 原交易仍需由官方签名查单确认；部分退款后REFUND保留同一原支付交易号。
      const trade = await queryWechatTrade(config, orderNo);
      bindWechatTrade(trade.data as WechatTrade, config, orderNo, total);
      if (trade.status !== 200 || !['SUCCESS', 'REFUND'].includes(String(trade.data.trade_state))
        || trade.data.transaction_id !== tradeNo) throw new Error('原支付交易未确认');
    }
    const response = mode === 'refund'
      ? await wechatRequest(config, 'POST', '/v3/refund/domestic/refunds', {
        transaction_id: tradeNo, out_refund_no: row.out_request_no, reason: row.refund_reason.slice(0, 80),
        notify_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/wechat-refund-webhook`,
        amount: { refund: wechatCents(row.refund_amount), total: wechatCents(total), currency: 'CNY' },
      })
      : await wechatRequest(config, 'GET', `/v3/refund/domestic/refunds/${encodeURIComponent(row.out_request_no)}`);
    if (response.status === 200) evidence = wechatRefundEvidence(response.data, row, { mchid, tradeNo, total }, mode as 'refund' | 'query');
    else if (mode === 'query' && response.status === 404 && response.data.code === 'RESOURCE_NOT_EXISTS') {
      // 唯一允许运营按原退款号重试受理的查单证据；后台调度仍只查询。
      evidence = { outcome: 'unknown', verified: true, method: 'query', code: 'RESOURCE_NOT_EXISTS' };
    }
  } catch { evidence = { outcome: 'unknown', method: mode, verified: false }; }
  const finished = await db.rpc('finish_wechat_refund', { p_refund: row.id, p_lease: row.lease_token, p_evidence: evidence });
  if (finished.error || !finished.data) throw new Error('微信退款到账回执待核对，请保留原申请');
  return refundReceipt(finished.data as CashRefund);
}

export async function processWechatRefund(db: SupabaseClient): Promise<boolean> {
  try { getWechatConfig(); } catch { return false; }
  const now = new Date().toISOString();
  const due = await db.from('alipay_refunds').select('out_trade_no,out_request_no')
    .eq('pay_channel', 'wechat').in('status', ['requested', 'unknown']).is('applied_at', null)
    .lte('next_query_at', now).or(`lease_until.is.null,lease_until.lt.${now}`).order('next_query_at').limit(1);
  if (due.error) throw new Error('微信退款核对队列读取失败');
  if (!due.data?.length) return false;
  await executeWechatRefund(db, null, due.data[0].out_trade_no, due.data[0].out_request_no, false);
  return true;
}
