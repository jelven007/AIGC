/**
 * 支付宝 AI 网页应用收款 - 前端统一 API
 * 约定：签名、验签、金额校验全部在 Edge Function 服务端完成，前端只负责：
 * 1) 下单获取支付表单 HTML；2) 渲染并提交表单跳转支付宝；3) 回跳后向服务端查询最终支付结果。
 * 严禁前端拼接网关 URL 或信任同步跳转参数判定支付成功。
 */
import { supabase } from '@/db/supabase';

export interface AlipayOrderResult {
  order_no: string;
  order_id: string;
  payment_html: string;
  plan_name: string;
  amount: string;
}

export interface AlipayQueryResult {
  order_no: string;
  local_status: string;
  trade_status: string;
  amount: string;
}

async function extractInvokeError(error: any): Promise<Error> {
  try {
    const text = await error?.context?.text?.();
    if (text) {
      const parsed = JSON.parse(text);
      return new Error(parsed.message || text);
    }
  } catch {
    // 非 JSON 响应体，退回原始 message
  }
  return new Error(error?.message || '支付服务请求失败');
}

export interface CashRefundReceipt {
  id: string; order_id: string; out_request_no: string; request_key: string | null;
  refund_amount: string; refund_status: 'init' | 'requested' | 'success' | 'unknown';
  applied_at: string | null; revoked_credits: number; needs_attention: boolean; next_query_at: string | null;
}
export class AlipayOperationError extends Error {
  constructor(message: string, readonly status: number, readonly outcome: string) { super(message); }
}

/** 统一下单：服务端创建订单并返回 alipay.trade.page.pay 表单 HTML */
export async function createAlipayOrder(planId: string): Promise<AlipayOrderResult> {
  const { data, error } = await supabase.functions.invoke('alipay-payment-order', {
    body: { plan_id: planId },
  });
  if (error) throw await extractInvokeError(error);
  if (data?.code !== 0 || !data?.data) throw new Error(data?.message || '下单失败');
  return data.data as AlipayOrderResult;
}

/**
 * 渲染 pageExec 生成的表单并自动提交（页面跳转类 API 唯一正确调起方式）。
 * 必须在用户点击手势的同步调用链中执行，避免浏览器拦截跳转。
 */
export function renderAndSubmitAlipayForm(paymentHtml: string): void {
  const doc = new DOMParser().parseFromString(paymentHtml, 'text/html');
  const form = doc.querySelector('form');
  if (!form) throw new Error('支付表单解析失败，请重试');
  const container = document.createElement('div');
  container.style.display = 'none';
  container.appendChild(form);
  document.body.appendChild(container);
  form.submit();
}

/** 交易查询兜底：GET 参数必须拼接在 URL 上（.rules/supabase-edge-function-get-body） */
export async function queryAlipayOrder(orderNo: string): Promise<AlipayQueryResult> {
  const { data, error } = await supabase.functions.invoke(
    `alipay-trade-query?order_no=${encodeURIComponent(orderNo)}`,
    { method: 'GET' },
  );
  if (error) throw await extractInvokeError(error);
  if (data?.code !== 0 || !data?.data) throw new Error(data?.message || '订单查询失败');
  return data.data as AlipayQueryResult;
}

/** 交易操作：退款 / 原申请查询（运营授权）/ 关闭交易（本人或财务） */
export async function alipayTradeOps(params: {
  action: 'refund' | 'refundQuery' | 'receipt' | 'close';
  order_no: string;
  request_key?: string;
  refund_amount?: string;
  refund_reason?: string;
  out_request_no?: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('alipay-trade-ops', {
    body: params,
    timeout: 25000,
  });
  if (error) {
    const response = error.context instanceof Response ? error.context : null;
    const details = await response?.json().catch(() => null);
    throw new AlipayOperationError(details?.message || error.message, response?.status || 0, details?.outcome || 'unknown');
  }
  if (data?.code !== 0) throw new Error(data?.message || '交易操作失败');
  return (data.data ?? {}) as Record<string, unknown>;
}
