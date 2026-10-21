import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { encryptKey, validateEndpoint } from '../_shared/model-registry.ts';
import { PLATFORMS, platformApp, creatorInfo, type Platform } from '../_shared/platforms.ts';

export async function stateHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function handlePlatformAccounts(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => Response.json(body, { headers, status });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const db = createServiceClient();
    const body = await req.json();
    if (body.action === 'list') {
      const apps = await db.from('platform_apps').select('platform,enabled');
      const connections = await db.from('platform_connections').select('id,platform,display_name,status,expires_at,scopes')
        .eq('user_id', auth.user.id);
      if (apps.error || connections.error) throw new Error('平台配置读取失败');
      return reply({ platforms: Object.entries(PLATFORMS).map(([id, item]) => ({
        id, name: item.name, enabled: apps.data?.some(app => app.platform === id && app.enabled) || false,
      })), connections: connections.data || [] });
    }
    if (body.action === 'apps') {
      if (auth.user.app_metadata?.role !== 'admin') return reply({ error: '仅管理员可配置应用' }, 403);
      const { data, error } = await db.from('platform_apps').select('platform,client_key,redirect_uri,scopes,enabled,updated_at');
      if (error) throw new Error('平台配置读取失败');
      return reply({ apps: Object.entries(PLATFORMS).map(([id, item]) => {
        const app = data?.find(row => row.platform === id);
        return app ? { ...app, has_secret: true } : { platform: id, client_key: '', redirect_uri: '',
          scopes: item.scopes, enabled: false, updated_at: null, has_secret: false };
      }) });
    }
    if (body.action === 'save_app') {
      if (auth.user.app_metadata?.role !== 'admin') return reply({ error: '仅管理员可配置应用' }, 403);
      const platform = body.platform as Platform;
      if (!PLATFORMS[platform] || typeof body.client_key !== 'string' || !body.client_key.trim()
        || body.client_key.length > 200 || typeof body.enabled !== 'boolean') return reply({ error: '应用配置非法' }, 400);
      const redirect = await validateEndpoint(body.redirect_uri);
      const required = `${Deno.env.get('SUPABASE_URL')}/functions/v1/platform-oauth-callback`;
      if (redirect !== required) return reply({ error: '回调地址必须为当前后端的 platform-oauth-callback 函数地址' }, 400);
      const old = await db.from('platform_apps').select('*').eq('platform', platform).maybeSingle();
      if ((old.data?.updated_at || null) !== (body.updated_at || null)) return reply({ error: '配置已被修改，请刷新' }, 409);
      const cipher = body.client_secret ? await encryptKey(`platform-app:${platform}`, body.client_secret.trim())
        : old.data?.secret_ciphertext;
      if (!cipher) return reply({ error: '请填写应用密钥' }, 400);
      const patch = { client_key: body.client_key.trim(), secret_ciphertext: cipher,
        redirect_uri: redirect, scopes: [...PLATFORMS[platform].scopes], enabled: body.enabled, updated_at: new Date().toISOString() };
      const saved = old.data ? await db.from('platform_apps').update(patch).eq('platform', platform).eq('updated_at', old.data.updated_at).select('platform')
        : await db.from('platform_apps').insert({ platform, ...patch }).select('platform');
      if (saved.error || !saved.data?.length) return reply({ error: '配置保存冲突，请刷新重试' }, 409);
      return reply({ ok: true });
    }
    if (body.action === 'authorize') {
      const app = await platformApp(db, body.platform);
      const state = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const saved = await db.from('platform_oauth_states').insert({
        state_hash: await stateHash(state), user_id: auth.user.id, platform: body.platform, app_snapshot: app,
      });
      if (saved.error) throw new Error('授权状态保存失败');
      const url = new URL(PLATFORMS[app.platform].authorize);
      url.search = new URLSearchParams({ client_key: app.client_key, redirect_uri: app.redirect_uri,
        response_type: 'code', scope: app.scopes.join(','), state }).toString();
      return reply({ url: url.href });
    }
    if (body.action === 'creator') return reply(await creatorInfo(db, body.connection_id, auth.user.id));
    if (body.action === 'disconnect') {
      const saved = await db.from('platform_connections').update({ status: 'revoked', token_ciphertext: '',
        refresh_lease: null, refresh_until: null }).eq('id', body.connection_id).eq('user_id', auth.user.id);
      if (saved.error) throw new Error('断开失败');
      return reply({ ok: true });
    }
    return reply({ error: '操作不支持' }, 400);
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '平台服务不可用' }, 503); }
}
Deno.serve(handlePlatformAccounts);
