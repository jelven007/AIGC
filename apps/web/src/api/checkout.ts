import { supabase } from '@/db/supabase';
export type CheckoutChannel = 'alipay' | 'wechat';
export interface CheckoutRequest { plan_id: string; request_key: string; expected_amount: string; expected_credits: number }
export interface CheckoutReceipt {
  order_id: string; order_no: string; amount: string; plan_name: string; local_status: string;
  payment_html?: string; wechat_pay_url?: string | null;
}
export class CheckoutError extends Error {
  constructor(message: string, readonly outcome: string, readonly receipt?: CheckoutReceipt) { super(message); }
}
export async function createCheckout(channel: CheckoutChannel, request: CheckoutRequest): Promise<CheckoutReceipt> {
  const { data, error } = await supabase.functions.invoke(
    channel === 'alipay' ? 'alipay-payment-order' : 'create-payment-order',
    { body: request, timeout: 25000 },
  );
  if (error) {
    const details = await (error.context instanceof Response ? error.context.clone().json().catch(() => null) : null);
    throw new CheckoutError(details?.message || '支付请求结果待确认，请恢复原请求',
      details?.outcome || 'unknown', details?.data || undefined);
  }
  if (data?.code !== 0 || !data?.data?.order_id || !data?.data?.order_no) {
    throw new CheckoutError(data?.message || '订单回执待确认', data?.outcome || 'unknown');
  }
  return data.data;
}
export function checkoutStorageKey(uid: string) { return `shopro:checkout:${uid}`; }
export interface PendingCheckout { channel: CheckoutChannel; request: CheckoutRequest; name: string; credits: number }
export function readPendingCheckout(uid: string): PendingCheckout | null {
  try {
    const item = JSON.parse(localStorage.getItem(checkoutStorageKey(uid)) || 'null');
    if (!item || !['alipay', 'wechat'].includes(item.channel) || typeof item.name !== 'string'
      || !Number.isSafeInteger(item.credits) || item.credits < 0
      || !/^[0-9a-f-]{36}$/i.test(item.request?.request_key || '')
      || !/^[0-9a-f-]{36}$/i.test(item.request?.plan_id || '')
      || !/^\d+\.\d{2}$/.test(item.request?.expected_amount || '')
      || item.request.expected_credits !== item.credits) return null;
    return item;
  } catch { return null; }
}
