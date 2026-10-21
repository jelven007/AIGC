import { supabase } from '@/db/supabase';
import { alipayTradeOps } from './alipay';
import { wechatTradeOps } from './wechat';
export type OperatorDomain = 'orders' | 'refunds' | 'customers' | 'jobs' | 'risk' | 'audit' | 'operators';
export interface OperatorAccess { root: boolean; permissions: string[]; grants: { id: string; role: string; scope_user_id: string | null }[] }
export interface OperatorPage { items: Record<string, unknown>[]; total: number; page: number; page_size: number; observed_at: string }
export type OperatorRequest = { action: 'mutate'; operation: 'budget' | 'grant' | 'revoke'; request_key: string; payload: Record<string, unknown> };
export type PendingOperatorRequest = { kind: 'operator'; body: OperatorRequest } | { kind: 'refund'; body: {
  action: 'refund'; order_no: string; refund_amount: string; refund_reason: string; request_key: string;
}; channel?: 'alipay' | 'wechat' };
export class OperatorRequestError extends Error {
  constructor(message: string, readonly outcome: string) { super(message); }
}
export async function operationsRequest(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('operations', { body, timeout: 25000 });
  if (error) {
    const response = error.context instanceof Response ? error.context : null;
    const details = await response?.json().catch(() => null);
    throw new OperatorRequestError(details?.error || error.message || '运营请求失败，请使用原申请核对', details?.outcome || 'unknown');
  }
  if (!data || data.error) throw new Error(data?.error || '运营服务未返回回执');
  return data;
}
export function operatorAccess(): Promise<OperatorAccess> { return operationsRequest({ action: 'access' }); }
export function operatorPage(domain: OperatorDomain, page: number, keyword: string, userId: string): Promise<OperatorPage> {
  return operationsRequest({ action: 'list', domain, page, keyword, user_id: userId || undefined });
}
export function operatorPendingKey(uid: string) { return `shopro-operator-request-${uid}`; }
export function storeOperatorRequest(uid: string, request: PendingOperatorRequest) {
  localStorage.setItem(operatorPendingKey(uid), JSON.stringify(request));
}
export function loadOperatorRequest(uid: string): PendingOperatorRequest | null {
  const raw = localStorage.getItem(operatorPendingKey(uid)); if (!raw) return null;
  const request = JSON.parse(raw);
  if (!['operator', 'refund'].includes(request.kind) || !request.body || typeof request.body.request_key !== 'string'
    || request.channel !== undefined && !['alipay', 'wechat'].includes(request.channel)) {
    throw new Error('本地原申请格式异常，请联系运营核对后恢复');
  }
  return request;
}
export async function executeOperatorRequest(request: PendingOperatorRequest) {
  return request.kind === 'refund' ? refundTradeOps(request.channel || 'alipay', request.body) : operationsRequest(request.body);
}
export const refundTradeOps = (channel: string, body: Parameters<typeof alipayTradeOps>[0]) =>
  channel === 'wechat' ? wechatTradeOps(body) : alipayTradeOps(body);
