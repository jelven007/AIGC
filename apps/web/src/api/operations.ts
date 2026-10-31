import { authenticatedEdgeRequest, EdgeRequestError } from '@/lib/edgeRequest';
import { requireAccountSession } from './accountSession';
import { CashOperationError, type alipayTradeOps } from './alipay';
export type OperatorDomain = 'orders' | 'refunds' | 'customers' | 'jobs' | 'risk' | 'audit' | 'operators' | 'tickets' | 'tenants' | 'costs' | 'cost_missing' | 'model_attempts' | 'alerts';
export interface OperatorAccess { root: boolean; permissions: string[]; grants: { id: string; role: string; scope_user_id: string | null }[] }
export interface OperatorPage { items: Record<string, unknown>[]; total: number; page: number; page_size: number; observed_at: string;
  monitor?: { last_scan_at: string; stale: boolean } }
export type OperatorOperation = 'budget' | 'grant' | 'revoke' | 'ticket_create' | 'ticket_reply' | 'ticket_update'
  | 'tenant_update' | 'tenant_member' | 'risk_review' | 'restriction' | 'cost_record' | 'cost_reverse' | 'alert_ack';
export type OperatorRequest = { action: 'mutate'; operation: OperatorOperation; request_key: string; payload: Record<string, unknown> };
export interface SupportDetail { ticket: Record<string, unknown>; items: Record<string, unknown>[]; total: number; page: number; page_size: number; staff: boolean }
export function supportPage(page: number, uid?: string): Promise<OperatorPage> { return operationsRequest({ action: 'support', page }, uid); }
export function supportDetail(ticketId: string, page = 1, uid?: string): Promise<SupportDetail> { return operationsRequest({ action: 'support', ticket_id: ticketId, page }, uid); }
export interface TenantDetail { tenant: Record<string, unknown>; items: Record<string, unknown>[]; total: number; page: number; page_size: number }
export function tenantDetail(teamId: string, page = 1, uid?: string): Promise<TenantDetail> { return operationsRequest({ action: 'tenant', team_id: teamId, page }, uid); }
export interface CostReport { totals: { currency: string; amount_minor: number; entry_count: number }[]; unrecorded_workloads: number; observed_at: string }
export function costReport(userId: string, uid?: string): Promise<CostReport> { return operationsRequest({ action: 'cost_report', user_id: userId || undefined }, uid); }
export type PendingOperatorRequest = { kind: 'operator'; body: OperatorRequest } | { kind: 'refund'; body: {
  action: 'refund'; order_no: string; refund_amount: string; refund_reason: string; request_key: string;
}; channel?: 'alipay' | 'wechat' };
export class OperatorRequestError extends Error {
  constructor(message: string, readonly outcome: string) { super(message); }
}
async function accountJSON(name: string, body: Record<string, unknown>, timeout: number, uid?: string) {
  const session = await requireAccountSession(uid);
  const response = await authenticatedEdgeRequest(name, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  }, '', session.user.id);
  const data = await response.json().catch(() => null);
  await requireAccountSession(session.user.id);
  return data;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const newer = (value: unknown, expected: unknown) =>
  Number.isSafeInteger(value) && Number(value) > Number(expected);
const ticketStatuses = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
function mutationReceipt(body: Record<string, unknown>, data: Record<string, unknown>) {
  const p = record(body.payload) ? body.payload : {};
  switch (body.operation) {
    case 'budget': return data.user_id === p.user_id && data.daily_credit_budget === p.amount;
    case 'grant': return uuid(data.grant_id);
    case 'revoke': return data.grant_id === p.grant_id && data.revoked === true;
    case 'ticket_create': return uuid(data.id) && newer(data.version, 0) && data.title === String(p.title).trim() && data.status === 'open';
    case 'ticket_reply': return data.id === p.ticket_id && newer(data.version, p.expected) && ticketStatuses.includes(String(data.status));
    case 'ticket_update': return data.id === p.ticket_id && newer(data.version, p.expected) && data.status === p.status;
    case 'tenant_update': return data.id === p.team_id && newer(data.ops_version, p.expected)
      && data.name === String(p.name).trim() && ['state', 'max_members', 'daily_credit_budget'].every(key => data[key] === p[key]);
    case 'tenant_member': return record(data.tenant) && data.tenant.id === p.team_id
      && newer(data.tenant.ops_version, p.expected) && data.member_id === p.member_id;
    case 'restriction': return data.user_id === p.user_id && data.restricted === p.restricted && newer(data.version, p.expected);
    case 'risk_review': return data.id === p.event_id && data.disposition === p.disposition && newer(data.ops_version, p.expected);
    case 'cost_record': return uuid(data.id) && data.job_id === p.job_id && data.job_type === p.job_type
      && data.currency === p.currency && data.amount_minor === p.amount_minor && data.reversal_of === null;
    case 'cost_reverse': return uuid(data.id) && data.reversal_of === p.entry_id && uuid(data.job_id)
      && ['CNY', 'USD', 'EUR'].includes(String(data.currency)) && Number.isSafeInteger(data.amount_minor) && Number(data.amount_minor) <= 0;
    case 'alert_ack': return data.id === p.alert_id && data.status === 'acknowledged' && newer(data.version, p.expected);
    default: return false;
  }
}
function validReceipt(body: Record<string, unknown>, data: unknown): data is Record<string, unknown> {
  if (!record(data)) return false;
  if (body.action === 'mutate') return mutationReceipt(body, data);
  if (body.action === 'access') return typeof data.root === 'boolean' && Array.isArray(data.permissions)
    && data.permissions.every(item => typeof item === 'string') && Array.isArray(data.grants)
    && data.grants.every(item => record(item) && typeof item.role === 'string');
  if (body.action === 'cost_report') return Array.isArray(data.totals)
    && data.totals.every(item => record(item) && typeof item.currency === 'string'
      && Number.isSafeInteger(item.amount_minor) && Number.isSafeInteger(item.entry_count))
    && Number.isSafeInteger(data.unrecorded_workloads) && typeof data.observed_at === 'string';
  if (!Array.isArray(data.items) || !data.items.every(record) || !Number.isSafeInteger(data.total)
    || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1) return false;
  if (body.action === 'tenant') return record(data.tenant) && data.tenant.id === body.team_id;
  if (body.action === 'support' && body.ticket_id) return record(data.ticket) && data.ticket.id === body.ticket_id && typeof data.staff === 'boolean';
  return ['list', 'support'].includes(String(body.action)) && typeof data.observed_at === 'string';
}
export async function operationsRequest(body: Record<string, unknown>, uid?: string): Promise<any> {
  try {
    const data = await accountJSON('operations', body, 25000, uid);
    if (record(data) && data.error) throw new OperatorRequestError(String(data.error), typeof data.outcome === 'string' ? data.outcome : 'unknown');
    if (!validReceipt(body, data)) throw new OperatorRequestError('运营服务未返回有效回执，请保留原申请核对', 'unknown');
    return data;
  } catch (cause) {
    if (cause instanceof EdgeRequestError) throw new OperatorRequestError(cause.message, cause.outcome || 'unknown');
    throw cause;
  }
}
export function operatorAccess(uid?: string): Promise<OperatorAccess> { return operationsRequest({ action: 'access' }, uid); }
export function operatorPage(domain: OperatorDomain, page: number, keyword: string, userId: string, uid?: string): Promise<OperatorPage> {
  return operationsRequest({ action: 'list', domain, page, keyword, user_id: userId || undefined }, uid);
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
export async function executeOperatorRequest(request: PendingOperatorRequest, uid?: string) {
  return request.kind === 'refund' ? refundTradeOps(request.channel || 'alipay', request.body, uid) : operationsRequest(request.body, uid);
}
export async function refundTradeOps(channel: string, body: Parameters<typeof alipayTradeOps>[0], uid?: string): Promise<Record<string, unknown>> {
  if (!['alipay', 'wechat'].includes(channel) || !['refund', 'refundQuery'].includes(body.action)) {
    throw new CashOperationError('退款渠道或操作不正确', 0, 'rejected');
  }
  try {
    const result = await accountJSON(`${channel}-trade-ops`, body, channel === 'wechat' ? 55000 : 25000, uid);
    if (record(result) && result.code !== 0) throw new CashOperationError(String(result.message || '退款结果待核对'),
      200, typeof result.outcome === 'string' ? result.outcome : 'unknown');
    const data = result?.data;
    if (!record(data) || !uuid(data.id) || !uuid(data.order_id) || data.pay_channel !== channel
      || !['init', 'requested', 'success', 'unknown', 'closed'].includes(String(data.refund_status))
      || typeof data.out_request_no !== 'string' || !data.out_request_no
      || body.request_key && data.request_key !== body.request_key
      || body.out_request_no && data.out_request_no !== body.out_request_no
      || typeof data.refund_amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(data.refund_amount)
      || body.refund_amount && Number(data.refund_amount) !== Number(body.refund_amount)
      || typeof data.needs_attention !== 'boolean' || !Number.isSafeInteger(data.revoked_credits)
      || data.refund_status === 'success' && !data.applied_at) {
      throw new CashOperationError('退款服务未返回有效回执，请保留原申请核对', 200, 'unknown');
    }
    return data;
  } catch (cause) {
    if (cause instanceof EdgeRequestError) throw new CashOperationError(cause.message, cause.status, cause.outcome || 'unknown');
    throw cause;
  }
}
