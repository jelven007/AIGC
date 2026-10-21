import { createServiceClient } from '../_shared/auth.ts';
import { saveConnection, tokenExchange, type PlatformApp } from '../_shared/platforms.ts';

export async function handlePlatformCallback(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  try {
    const url = new URL(req.url);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !/^[a-f0-9]{64}$/.test(state) || !code || code.length > 4096) throw new Error('授权参数无效');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state)));
    const hash = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const db = createServiceClient();
    const consumed = await db.rpc('consume_platform_state', { p_hash: hash });
    if (consumed.error || !consumed.data) throw new Error('授权状态已失效');
    const app = consumed.data.app_snapshot as PlatformApp;
    const token = await tokenExchange(app, { code, grant_type: 'authorization_code', redirect_uri: app.redirect_uri });
    await saveConnection(db, consumed.data, app, token);
    const site = Deno.env.get('PLATFORM_SITE_URL');
    if (!site) return new Response('平台授权已保存，请返回应用的发布页面。', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const target = new URL('/publish?connected=1', site);
    if (target.protocol !== 'https:') throw new Error('站点地址配置错误');
    return Response.redirect(target.href, 303);
  } catch {
    return new Response('平台授权未完成或状态已过期，请返回应用重新发起授权。', {
      status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
Deno.serve(handlePlatformCallback);
