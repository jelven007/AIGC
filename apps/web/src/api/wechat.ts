import { supabase } from '@/db/supabase';
import { CashOperationError } from './alipay';

export type CashTradeParams = {
  action: 'refund' | 'refundQuery' | 'receipt' | 'close' | 'query'; order_no: string;
  request_key?: string; refund_amount?: string; refund_reason?: string; out_request_no?: string;
};
export async function wechatTradeOps(params: CashTradeParams): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('wechat-trade-ops', { body: params, timeout: 55000 });
  if (error) {
    const response = error.context instanceof Response ? error.context : null;
    const details = await response?.json().catch(() => null);
    throw new CashOperationError(details?.message || '微信交易结果待核对，请保留原订单或申请',
      response?.status || 0, details?.outcome || 'unknown');
  }
  if (data?.code !== 0 || !data.data) throw new Error(data?.message || '微信交易回执待核对');
  return data.data;
}
