import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export class CheckoutError extends Error {
  constructor(message: string, readonly status: number, readonly outcome = 'rejected') { super(message); }
}
export interface CheckoutOrder {
  id: string; order_no: string; user_id: string; plan_id: string; status: string;
  total_amount: string | number; wechat_pay_url: string | null;
  plan_snapshot: { name: string; credits: number; level: number };
}
export function checkoutInput(body: unknown) {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof input.plan_id !== 'string' || !uuid.test(input.plan_id)
    || typeof input.request_key !== 'string' || !uuid.test(input.request_key)
    || typeof input.expected_amount !== 'string' || !/^(0|[1-9]\d{0,7})\.\d{2}$/.test(input.expected_amount)
    || Number(input.expected_amount) <= 0 || typeof input.expected_credits !== 'number'
    || !Number.isSafeInteger(input.expected_credits) || input.expected_credits < 0 || input.expected_credits > 2147483647) {
    throw new CheckoutError('请确认套餐、金额、积分和支付请求编号', 400);
  }
  return { planId: input.plan_id, requestKey: input.request_key, amount: input.expected_amount, credits: input.expected_credits };
}
export async function beginCheckout(admin: SupabaseClient, actor: string, channel: 'alipay' | 'wechat', body: unknown) {
  const input = checkoutInput(body);
  const { data, error } = await admin.rpc('begin_checkout_order', {
    p_actor: actor, p_request_key: input.requestKey, p_channel: channel,
    p_plan_id: input.planId, p_expected_amount: input.amount,
    p_expected_credits: input.credits,
  });
  if (error) {
    if (error.code === '22023') throw new CheckoutError(error.message, 409);
    if (error.code === '54000') throw new CheckoutError(error.message, 429);
    if (error.code === '42501') throw new CheckoutError('账号不可用', 403);
    throw new CheckoutError('订单创建回执待核对，请恢复原支付请求', 503, 'unknown');
  }
  if (!data?.id || !data?.order_no || !data?.plan_snapshot) {
    throw new CheckoutError('订单创建回执待核对，请恢复原支付请求', 503, 'unknown');
  }
  return data as CheckoutOrder;
}
export function checkoutReceipt(order: CheckoutOrder) {
  return { order_id: order.id, order_no: order.order_no, local_status: order.status,
    plan_name: order.plan_snapshot.name, amount: Number(order.total_amount).toFixed(2) };
}
