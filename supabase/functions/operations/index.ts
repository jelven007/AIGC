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
    try { body = JSON.parse(new TextDecoder().decode(await responseBytes(new Response(req.body), 8192))); }
    catch { return reply({ error: '运营正文非法或超过8KB' }, 400); }
    if (!body || !['access', 'list', 'mutate'].includes(body.action)) return reply({ error: '运营操作非法' }, 400);
    const db = createServiceClient();
    const rate = await db.rpc('upsert_rate_limit', { p_window_key: `operations:${auth.user.id}:${Math.floor(Date.now() / 60000)}`,
      p_client_id: `operations:${auth.user.id}`, p_reset_at: new Date(Date.now() + 60000).toISOString(), p_max_req: 60 });
    if (rate.error) return reply({ error: '运营限流服务不可用' }, 503);
    if (!rate.data) return reply({ error: '操作过于频繁' }, 429);
    let result;
    if (body.action === 'access') result = await db.rpc('operator_access', { p_actor: auth.user.id });
    else if (body.action === 'list') {
      if (!['orders', 'refunds', 'customers', 'jobs', 'risk', 'audit', 'operators'].includes(body.domain)
        || body.user_id && !uuid(body.user_id) || body.page !== undefined && (!Number.isInteger(body.page) || body.page < 1 || body.page > 1000)
        || body.keyword !== undefined && (typeof body.keyword !== 'string' || body.keyword.length > 64)) return reply({ error: '列表筛选非法' }, 400);
      result = await db.rpc('operator_list', { p_actor: auth.user.id, p_domain: body.domain,
        p_user: body.user_id || null, p_page: body.page ?? 1, p_keyword: body.keyword || '' });
    } else {
      if (!uuid(body.request_key) || !['budget', 'grant', 'revoke'].includes(body.operation)
        || !body.payload || typeof body.payload !== 'object') return reply({ error: '运营申请非法' }, 400);
      const payload = body.payload;
      if (body.operation === 'budget' && (!uuid(payload.user_id) || !Number.isInteger(payload.amount)
        || payload.amount < 0 || payload.amount > 1000000 || !Number.isInteger(payload.expected) || payload.expected < 0)
        || body.operation === 'grant' && (!uuid(payload.operator_id) || payload.scope_user_id !== null && !uuid(payload.scope_user_id)
          || !['finance', 'operations', 'risk', 'auditor'].includes(payload.role))
        || body.operation === 'revoke' && !uuid(payload.grant_id)) return reply({ error: '运营申请参数非法' }, 400);
      result = await db.rpc('operator_mutate', { p_actor: auth.user.id, p_key: body.request_key, p_action: body.operation, p_payload: payload });
    }
    if (result.error) {
      const message = result.error.message || '';
      if (result.error.code === '42501' || message.includes('无运营权限')) return reply({ error: '无运营权限' }, 403);
      if (result.error.code === '23503') return reply({ error: '运营账号或客户范围不存在', outcome: 'rejected' }, 409);
      if (/同一运营申请|预算版本|已撤销|不存在/.test(message)) return reply({ error: message,
        outcome: message.includes('同一运营申请') ? 'unknown' : 'rejected' }, 409);
      return reply({ error: body.action === 'mutate' ? '操作受理待确认，请保留原申请核对' : '运营数据读取失败',
        ...(body.action === 'mutate' ? { outcome: 'unknown' } : {}) }, 503);
    }
    return reply(result.data);
  } catch { return reply({ error: '运营服务暂不可用' }, 503); }
}
Deno.serve(handleOperations);
