import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface PaidFinalizeResult {
  outcome: 'granted' | 'already_processed';
  userId: string;
}

/** 调用数据库事务：订单、积分、套餐和流水一起提交，任一步失败即全部回滚。 */
export async function finalizePayment(
  admin: SupabaseClient,
  orderNo: string,
  channel: 'alipay' | 'wechat',
  tradeNo: string,
  amount: string,
): Promise<PaidFinalizeResult> {
  const { data, error } = await admin.rpc('finalize_paid_order', {
    p_order_no: orderNo,
    p_pay_channel: channel,
    p_trade_no: tradeNo,
    p_amount: amount,
  });
  if (error) throw new Error(`支付入账失败：${error.message}`);
  if (!data?.user_id || !['granted', 'already_processed'].includes(data.outcome)) {
    throw new Error('支付入账结果非法');
  }
  return { outcome: data.outcome, userId: data.user_id };
}
