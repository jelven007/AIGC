/**
 * 支付宝 AI 网页应用收款 - 前端统一 API
 * 约定：签名、验签、金额校验全部在 Edge Function 服务端完成，前端只负责：
 * 1) 下单获取支付表单 HTML；2) 渲染并提交表单跳转支付宝；3) 回跳后向服务端查询最终支付结果。
 * 严禁前端拼接网关 URL 或信任同步跳转参数判定支付成功。
 */
import { supabase } from '@/db/supabase';

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

/**
 * 渲染 pageExec 生成的表单并自动提交（页面跳转类 API 唯一正确调起方式）。
 * 仅保留服务端签名字段，以 POST 导航到官方支付宝网关。
 */
export function renderAndSubmitAlipayForm(paymentHtml: string): void {
  const doc = new DOMParser().parseFromString(paymentHtml, 'text/html');
  const source = doc.querySelector('form');
  if (!source) throw new Error('支付表单解析失败，请恢复原订单');
  const action = new URL(source.getAttribute('action') || '');
  if (action.protocol !== 'https:' || action.username || action.password
    || !['openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com', 'openapi.alipaydev.com'].includes(action.hostname)
    || action.pathname !== '/gateway.do' || source.method.toUpperCase() !== 'POST') {
    throw new Error('支付网关地址异常，请核对原订单');
  }
  const form = document.createElement('form');
  form.method = 'POST'; form.action = action.href; form.style.display = 'none';
  for (const input of source.querySelectorAll('input[type="hidden"][name]')) {
    const field = document.createElement('input');
    field.type = 'hidden'; field.name = (input as HTMLInputElement).name; field.value = (input as HTMLInputElement).value;
    form.appendChild(field);
  }
  if (!form.querySelector('input[name="sign"]')) throw new Error('支付签名字段缺失，请恢复原订单');
  document.body.appendChild(form);
  HTMLFormElement.prototype.submit.call(form);
  form.remove();
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
