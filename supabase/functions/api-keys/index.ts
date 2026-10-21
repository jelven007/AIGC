import { authenticateRequest, createServiceClient, hashApiKey } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

export const apiScopes = ['video:create', 'video:read', 'image:create', 'render:create', 'jobs:read',
  'script:generate', 'publish:create', 'publish:read', 'metrics:read'];
const fields = 'id,name,key_prefix,scopes,rate_limit,last_used_at,expires_at,is_active,total_calls,created_at';
export async function handleApiKeys(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请使用登录账号管理密钥' }, 401);
    const body = await req.json(), db = createServiceClient();
    if (body.action === 'list') {
      const result = await db.from('api_keys').select(fields).eq('user_id', auth.user.id).order('created_at', { ascending: false });
      if (result.error) throw new Error('密钥列表读取失败');
      return reply({ keys: result.data });
    }
    if (body.action === 'create') {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80
        || !Array.isArray(body.scopes) || !body.scopes.length || body.scopes.some((scope: unknown) => !apiScopes.includes(scope as string))
        || !Number.isInteger(body.expires_in_days) || body.expires_in_days < 1 || body.expires_in_days > 365) return reply({ error: '请输入名称、有效权限和1–365天有效期' }, 400);
      const rate = await db.rpc('upsert_rate_limit', { p_window_key: `key-issue:${auth.user.id}:${Math.floor(Date.now() / 60000)}`,
        p_client_id: `key-issue:${auth.user.id}`, p_reset_at: new Date(Date.now() + 60000).toISOString(), p_max_req: 5 });
      if (rate.error) throw new Error('密钥频控不可用');
      if (!rate.data) return reply({ error: '创建密钥过于频繁' }, 429);
      const raw = `ak_live_${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')}`;
      const result = await db.from('api_keys').insert({ user_id: auth.user.id, name: body.name.trim(),
        key_hash: await hashApiKey(raw), key_prefix: raw.slice(0, 16), scopes: [...new Set(body.scopes)],
        issuance_version: 1, rate_limit: 100, expires_at: new Date(Date.now() + body.expires_in_days * 86400000).toISOString() })
        .select(fields).single();
      if (result.error || !result.data) throw new Error('密钥创建失败');
      return reply({ key: result.data, raw_key: raw }, 201);
    }
    if (body.action === 'revoke') {
      const result = await db.from('api_keys').update({ is_active: false }).eq('id', body.key_id).eq('user_id', auth.user.id).select('id').maybeSingle();
      if (result.error) throw new Error('密钥撤销失败');
      if (!result.data) return reply({ error: '密钥不存在' }, 404);
      return reply({ ok: true });
    }
    return reply({ error: '密钥操作不支持' }, 400);
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '密钥服务不可用' }, 503); }
}
Deno.serve(handleApiKeys);
