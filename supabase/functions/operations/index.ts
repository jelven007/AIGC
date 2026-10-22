import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function handleOperations(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole || auth.apiKeyId) return reply({ error: '请使用个人登录会话' }, 401);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await responseBytes(new Response(req.body), 16384))); }
    catch { return reply({ error: '运营正文非法或超过16KB', outcome: 'rejected' }, 400); }
    if (!body || !['access', 'list', 'mutate', 'support', 'tenant', 'cost_report'].includes(body.action)) return reply({ error: '运营操作非法', outcome: 'rejected' }, 400);
    const db = createServiceClient();
    const rate = await db.rpc('upsert_rate_limit', { p_window_key: `operations:${auth.user.id}:${Math.floor(Date.now() / 60000)}`,
      p_client_id: `operations:${auth.user.id}`, p_reset_at: new Date(Date.now() + 60000).toISOString(), p_max_req: 60 });
    if (rate.error) return reply({ error: '运营限流服务不可用' }, 503);
    if (!rate.data) return reply({ error: '操作过于频繁' }, 429);
    let result;
    if (body.action === 'access') result = await db.rpc('operator_access', { p_actor: auth.user.id });
    else if (body.action === 'list') {
      if (!['orders', 'refunds', 'customers', 'jobs', 'risk', 'audit', 'operators', 'tickets', 'tenants', 'costs', 'cost_missing', 'alerts'].includes(body.domain)
        || body.user_id && !uuid(body.user_id) || body.page !== undefined && (!Number.isInteger(body.page) || body.page < 1 || body.page > 1000)
        || body.keyword !== undefined && (typeof body.keyword !== 'string' || body.keyword.length > 64)) return reply({ error: '列表筛选非法' }, 400);
      result = await db.rpc('operator_list', { p_actor: auth.user.id, p_domain: body.domain,
        p_user: body.user_id || null, p_page: body.page ?? 1, p_keyword: body.keyword || '' });
    } else if (body.action === 'cost_report') {
      if (body.user_id && !uuid(body.user_id)) return reply({ error: '成本范围非法' }, 400);
      result = await db.rpc('supplier_cost_report', { p_actor: auth.user.id, p_user: body.user_id || null });
    } else if (body.action === 'tenant') {
      if (!uuid(body.team_id) || body.page !== undefined && (!Number.isInteger(body.page) || body.page < 1 || body.page > 1000)) return reply({ error: '租户筛选非法' }, 400);
      result = await db.rpc('tenant_read', { p_actor: auth.user.id, p_team: body.team_id, p_page: body.page ?? 1 });
    } else if (body.action === 'support') {
      if (body.ticket_id && !uuid(body.ticket_id) || body.page !== undefined && (!Number.isInteger(body.page) || body.page < 1 || body.page > 1000)) {
        return reply({ error: '工单筛选非法' }, 400);
      }
      result = await db.rpc('support_read', { p_actor: auth.user.id, p_ticket: body.ticket_id || null, p_page: body.page ?? 1 });
    } else {
      if (!uuid(body.request_key) || !['budget', 'grant', 'revoke', 'ticket_create', 'ticket_reply', 'ticket_update',
        'tenant_update', 'tenant_member', 'risk_review', 'restriction', 'cost_record', 'cost_reverse', 'alert_ack'].includes(body.operation)
        || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return reply({ error: '运营申请非法', outcome: 'rejected' }, 400);
      const payload = body.payload;
      if (body.operation === 'budget' && (!uuid(payload.user_id) || !Number.isInteger(payload.amount)
        || payload.amount < 0 || payload.amount > 1000000 || !Number.isInteger(payload.expected) || payload.expected < 0)
        || body.operation === 'grant' && (!uuid(payload.operator_id) || payload.scope_user_id !== null && !uuid(payload.scope_user_id)
          || !['finance', 'operations', 'risk', 'auditor'].includes(payload.role))
        || body.operation === 'revoke' && !uuid(payload.grant_id)) return reply({ error: '运营申请参数非法', outcome: 'rejected' }, 400);
      const boundedText = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
      const expected = Number.isInteger(payload.expected) && payload.expected >= 0;
      if (body.operation === 'ticket_create' && (!boundedText(payload.title, 120) || !boundedText(payload.body, 2000)
        || !['task', 'payment', 'access', 'other'].includes(payload.category) || payload.user_id !== undefined && !uuid(payload.user_id)
        || payload.related_id != null && !uuid(payload.related_id))
        || body.operation === 'ticket_reply' && (!uuid(payload.ticket_id) || !expected || !boundedText(payload.body, 2000)
          || payload.internal !== undefined && typeof payload.internal !== 'boolean')
        || body.operation === 'ticket_update' && (!uuid(payload.ticket_id) || !expected || !boundedText(payload.reason, 2000)
          || !['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'].includes(payload.status)
          || payload.assignee_id != null && !uuid(payload.assignee_id))
        || body.operation === 'tenant_update' && (!uuid(payload.team_id) || !expected || !boundedText(payload.name, 80)
          || !['active', 'suspended'].includes(payload.state) || !Number.isInteger(payload.max_members)
          || payload.max_members < 1 || payload.max_members > 1000 || !Number.isInteger(payload.daily_credit_budget)
          || payload.daily_credit_budget < 0 || payload.daily_credit_budget > 1000000 || !boundedText(payload.reason, 2000)
          || payload.owner_id != null && !uuid(payload.owner_id))
        || body.operation === 'tenant_member' && (!uuid(payload.team_id) || !uuid(payload.member_id) || !expected
          || !['role', 'remove'].includes(payload.member_action) || !boundedText(payload.reason, 2000)
          || payload.member_action === 'role' && !['admin', 'editor', 'viewer'].includes(payload.role))
        || body.operation === 'risk_review' && (!uuid(payload.event_id) || !expected || !boundedText(payload.reason, 2000)
          || !['reviewing', 'dismissed', 'confirmed'].includes(payload.disposition))
        || body.operation === 'restriction' && (!uuid(payload.user_id) || !expected || typeof payload.restricted !== 'boolean' || !boundedText(payload.reason, 2000))
        || body.operation === 'alert_ack' && (!uuid(payload.alert_id) || !expected || !boundedText(payload.reason, 2000))
        || ['cost_record', 'cost_reverse'].includes(body.operation) && (!boundedText(payload.reason, 2000)
          || !boundedText(payload.statement_ref, 120) || !boundedText(payload.line_ref, 120)
          || typeof payload.evidence_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(payload.evidence_sha256)
          || body.operation === 'cost_reverse' && !uuid(payload.entry_id)
          || body.operation === 'cost_record' && (!uuid(payload.job_id) || !['video', 'production', 'model_call'].includes(payload.job_type)
            || !['CNY', 'USD', 'EUR'].includes(payload.currency) || !Number.isSafeInteger(payload.amount_minor)
            || payload.amount_minor < 0 || payload.amount_minor > 1000000000))) {
        return reply({ error: '运营申请参数非法', outcome: 'rejected' }, 400);
      }
      result = await db.rpc('operator_mutate', { p_actor: auth.user.id, p_key: body.request_key, p_action: body.operation, p_payload: payload });
    }
    if (result.error) {
      const message = result.error.message || '';
      if (result.error.code === '42501' || message.includes('无运营权限')) return reply({ error: '无权处理当前申请', outcome: 'rejected' }, 403);
      if (result.error.code === '23503') return reply({ error: '运营账号或客户范围不存在', outcome: 'rejected' }, 409);
      if (result.error.code === '22023') return reply({ error: message, outcome: 'rejected' }, 400);
      if (result.error.code === '23505') return reply({ error: '原账单行或冲销流水已登记，请刷新核对', outcome: 'rejected' }, 409);
      if (result.error.code === 'P0002' || /同一运营申请|版本已变化|已撤销|不存在/.test(message)) return reply({ error: message,
        outcome: message.includes('同一运营申请') ? 'unknown' : 'rejected' }, 409);
      return reply({ error: body.action === 'mutate' ? '操作受理待确认，请保留原申请核对' : '运营数据读取失败',
        ...(body.action === 'mutate' ? { outcome: 'unknown' } : {}) }, 503);
    }
    if (body.action === 'list' && body.domain === 'refunds' && result.data?.items?.length) {
      const ids = result.data.items.map((row: { id: string }) => row.id);
      const channels = await db.from('alipay_refunds').select('id,pay_channel').in('id', ids);
      if (channels.error || channels.data?.length !== ids.length) return reply({ error: '退款渠道读取失败' }, 503);
      const byId = new Map(channels.data.map(row => [row.id, row.pay_channel]));
      result.data.items = result.data.items.map((row: { id: string }) => ({ ...row, pay_channel: byId.get(row.id) }));
    }
    return reply(result.data);
  } catch { return reply({ error: '运营服务暂不可用' }, 503); }
}
Deno.serve(handleOperations);
