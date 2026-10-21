import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { amountEquals, createAlipaySdk, getAlipayConfig, normalizeAmountText, readResultField } from './alipay.ts';

export interface CashRefund {
  id: string; order_id: string; out_trade_no: string; out_request_no: string; request_key: string | null;
  refund_amount: string | number; refund_reason: string; status: string; lease_token: string;
  applied_at: string | null; revoked_credits: number; needs_attention: boolean; next_query_at: string | null;
  created_at: string; updated_at: string;
  pay_channel: 'alipay' | 'wechat'; provider_refund_id: string | null;
}
export function refundReceipt(row: CashRefund) {
  return {
    id: row.id, order_id: row.order_id, out_request_no: row.out_request_no, request_key: row.request_key,
    refund_amount: normalizeAmountText(row.refund_amount), refund_status: row.status,
    applied_at: row.applied_at, revoked_credits: row.revoked_credits, needs_attention: row.needs_attention,
    next_query_at: row.next_query_at, created_at: row.created_at, updated_at: row.updated_at,
    pay_channel: row.pay_channel,
  };
}

// SDK exec 必须启用响应验签；只存字段白名单，不保留原始响应/签名/买家身份。
export async function executeCashRefund(db: SupabaseClient, actor: string | null, orderNo: string, requestNo: string, submit = false) {
  const claimed = await db.rpc('claim_cash_refund', { p_actor: actor, p_order_no: orderNo, p_request_no: requestNo, p_submit: submit });
  if (claimed.error || !claimed.data) throw new Error('退款领取失败，请保留原请求核对');
  const { mode, refund: row, trade_no: tradeNo } = claimed.data as {
    mode: string; refund: CashRefund; trade_no: string;
  };
  if (row.pay_channel && row.pay_channel !== 'alipay') throw new Error('退款渠道不匹配');
  if (mode === 'wait' || mode === 'done') return refundReceipt(row);
  if (!['refund', 'query'].includes(mode)) throw new Error('退款服务协议不兼容');
  let evidence: Record<string, unknown> = { outcome: 'unknown', method: mode, verified: false };
  try {
    const sdk = createAlipaySdk();
    const response = await sdk.exec(mode === 'refund' ? 'alipay.trade.refund' : 'alipay.trade.fastpay.refund.query', {
      bizContent: {
        out_trade_no: row.out_trade_no, out_request_no: row.out_request_no,
        ...(mode === 'refund' ? { refund_amount: normalizeAmountText(row.refund_amount), refund_reason: row.refund_reason } : {}),
      },
    }, { validateSign: true });
    const field = (name: string) => readResultField(response, name);
    const code = field('code');
    const fundChange = field('fund_change');
    const refundStatus = field('refund_status');
    const amount = field(mode === 'refund' ? 'refund_fee' : 'refund_amount');
    const bound = code === '10000' && field('trade_no') === tradeNo && field('out_trade_no') === row.out_trade_no
      && (mode !== 'query' || field('out_request_no') === row.out_request_no)
      && amountEquals(row.refund_amount, amount);
    const success = bound && (mode === 'refund' ? fundChange === 'Y' : refundStatus === 'REFUND_SUCCESS');
    // 任何失败/缺字段/无资金变化均保留预占；后续只核对同一笔，不生成新编号。
    evidence = {
      outcome: success ? 'success' : 'unknown', method: mode, verified: true,
      code: typeof code === 'string' && /^\d{5}$/.test(code) ? code : null,
      trade_no: bound ? tradeNo : null, out_trade_no: bound ? row.out_trade_no : null,
      out_request_no: bound ? row.out_request_no : null,
      amount: bound ? normalizeAmountText(amount) : null,
      fund_change: ['Y', 'N'].includes(fundChange) ? fundChange : null,
      refund_status: refundStatus === 'REFUND_SUCCESS' ? refundStatus : null,
      observed_at: new Date().toISOString(),
    };
  } catch {
    // 超时或验签失败可能已出账，不能重发新退款；不输出可能含密钥/响应的异常。
    evidence = { ...evidence, observed_at: new Date().toISOString() };
  }
  const applied = await db.rpc('finish_cash_refund', {
    p_refund: row.id, p_lease: row.lease_token, p_evidence: evidence,
  });
  if (applied.error || !applied.data) throw new Error('退款结果入账待确认，请使用原申请核对');
  return refundReceipt(applied.data as CashRefund);
}

export async function processCashRefund(db: SupabaseClient): Promise<boolean> {
  try { getAlipayConfig(); } catch { return false; }
  const now = new Date().toISOString();
  const due = await db.from('alipay_refunds').select('out_trade_no,out_request_no')
    .eq('pay_channel', 'alipay')
    .in('status', ['requested', 'unknown', 'success']).is('applied_at', null).lte('next_query_at', now)
    .lt('attempts', 100).or(`lease_until.is.null,lease_until.lt.${now}`).order('next_query_at').limit(1);
  if (due.error) throw new Error('退款核对队列读取失败');
  if (!due.data?.length) return false;
  // 专用调度永远只查询已经发出的原退款，不发起现金出账。
  await executeCashRefund(db, null, due.data[0].out_trade_no, due.data[0].out_request_no, false);
  return true;
}
