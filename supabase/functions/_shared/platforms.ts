import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decryptKey, encryptKey } from './model-registry.ts';
export const PLATFORMS = {
  tiktok: { name: 'TikTok', authorize: 'https://www.tiktok.com/v2/auth/authorize/',
    token: 'https://open.tiktokapis.com/v2/oauth/token/', refresh: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.publish', 'video.list'] },
  douyin: { name: '抖音', authorize: 'https://open.douyin.com/platform/oauth/connect/',
    token: 'https://open.douyin.com/oauth/access_token/', refresh: 'https://open.douyin.com/oauth/refresh_token/',
    scopes: ['user_info', 'video.create.bind', 'video.data.bind'] },
} as const;
export type Platform = keyof typeof PLATFORMS;
export interface PlatformApp {
  platform: Platform; client_key: string; secret_ciphertext: string; redirect_uri: string;
  scopes: string[]; enabled: boolean; updated_at: string;
}
export async function platformApp(db: SupabaseClient, platform: Platform): Promise<PlatformApp> {
  if (!PLATFORMS[platform]) throw new Error('平台尚未接入');
  const { data, error } = await db.from('platform_apps').select('*').eq('platform', platform).single();
  if (error || !data?.enabled) throw new Error('平台应用未配置或未启用');
  return data as PlatformApp;
}
export async function tokenExchange(app: PlatformApp, values: Record<string, string>, refresh = false): Promise<any> {
  const secret = await decryptKey(`platform-app:${app.platform}`, app.secret_ciphertext);
  const response = await fetch(refresh ? PLATFORMS[app.platform].refresh : PLATFORMS[app.platform].token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: app.client_key, client_secret: secret, ...values }),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  const raw = await response?.json().catch(() => null);
  const data = app.platform === 'douyin' ? raw?.data : raw;
  if (!response?.ok || !data?.access_token || data.error || data.error_code) throw new Error('平台授权或令牌刷新失败，请重新授权');
  return data;
}
export async function saveConnection(db: SupabaseClient, state: { platform: Platform; user_id: string }, app: PlatformApp, token: any) {
  if (typeof token.open_id !== 'string' || !token.open_id || !Number.isFinite(token.expires_in)) throw new Error('平台未返回有效账号');
  let name = token.open_id;
  const headers: Record<string, string> = state.platform === 'tiktok' ? { Authorization: `Bearer ${token.access_token}` }
    : { 'access-token': token.access_token };
  const url = state.platform === 'tiktok' ? 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name'
    : `https://open.douyin.com/oauth/userinfo/?open_id=${encodeURIComponent(token.open_id)}`;
  const profile = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
    .then(result => result.json()).catch(() => null);
  name = profile?.data?.user?.display_name || profile?.data?.nickname || name;
  const cipher = await encryptKey(`platform-connection:${state.user_id}:${state.platform}:${token.open_id}`, JSON.stringify({
    access_token: token.access_token, refresh_token: token.refresh_token,
  }));
  const { error } = await db.from('platform_connections').upsert({
    user_id: state.user_id, platform: state.platform, open_id: token.open_id, display_name: name,
    token_ciphertext: cipher, app_snapshot: app, scopes: String(token.scope || '').split(',').filter(Boolean),
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refresh_expires_at: token.refresh_expires_in ? new Date(Date.now() + token.refresh_expires_in * 1000).toISOString() : null,
    status: 'active', updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,platform,open_id' });
  if (error) throw new Error('平台授权保存失败，请重新授权');
}
export async function connectionToken(db: SupabaseClient, id: string, userId: string) {
  const { data, error } = await db.from('platform_connections').select('*').eq('id', id).eq('user_id', userId).single();
  if (error || !data || data.status !== 'active') throw new Error('平台账号未授权或已断开');
  const context = `platform-connection:${userId}:${data.platform}:${data.open_id}`;
  let token = JSON.parse(await decryptKey(context, data.token_ciphertext));
  if (new Date(data.expires_at).getTime() < Date.now() + 60000) {
    if (!token.refresh_token || data.refresh_expires_at && new Date(data.refresh_expires_at).getTime() < Date.now()) throw new Error('平台授权已过期，请重新授权');
    const lease = await db.rpc('claim_platform_refresh', { p_connection: id });
    if (lease.error || !lease.data) throw new Error('平台令牌正在刷新，请稍后重试');
    try {
      // 领取锁后重新读取，避免并发请求使用已轮换的旧 refresh_token。
      const current = await db.from('platform_connections').select('*').eq('id', id).eq('refresh_lease', lease.data).eq('status', 'active').single();
      if (current.error || !current.data) throw new Error('平台账号已经断开');
      token = JSON.parse(await decryptKey(context, current.data.token_ciphertext));
      if (new Date(current.data.expires_at).getTime() >= Date.now() + 60000) {
        await db.from('platform_connections').update({ refresh_lease: null, refresh_until: null }).eq('id', id).eq('refresh_lease', lease.data);
        return { connection: current.data, token: token.access_token as string };
      }
      const refreshed = await tokenExchange(current.data.app_snapshot, { grant_type: 'refresh_token', refresh_token: token.refresh_token }, true);
      if (refreshed.open_id && refreshed.open_id !== data.open_id) throw new Error('平台刷新账号不一致');
      token = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || token.refresh_token };
      const saved = await db.from('platform_connections').update({
        token_ciphertext: await encryptKey(context, JSON.stringify(token)),
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        ...(refreshed.refresh_expires_in ? { refresh_expires_at: new Date(Date.now() + refreshed.refresh_expires_in * 1000).toISOString() } : {}),
        refresh_lease: null, refresh_until: null,
      }).eq('id', id).eq('refresh_lease', lease.data).eq('status', 'active').select('id');
      if (saved.error || !saved.data?.length) throw new Error('平台令牌保存失败或账号已断开');
    } catch (cause) {
      await db.from('platform_connections').update({ refresh_lease: null, refresh_until: null }).eq('id', id).eq('refresh_lease', lease.data);
      throw cause;
    }
  }
  return { connection: data, token: token.access_token as string };
}
export class PlatformError extends Error {
  constructor(message: string, readonly rejected: boolean) { super(message); }
}
export async function officialJson(platform: Platform, url: string, token: string, body?: unknown) {
  const allowed = platform === 'tiktok' ? 'open.tiktokapis.com' : 'open.douyin.com';
  if (new URL(url).hostname !== allowed) throw new Error('平台地址非法');
  const headers: Record<string, string> = platform === 'tiktok' ? { Authorization: `Bearer ${token}` } : { 'access-token': token };
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || (platform === 'tiktok' ? data.error?.code !== 'ok' : data.data?.error_code !== 0)) {
    const code = platform === 'tiktok' ? data?.error?.code : data?.data?.error_code;
    const rejected = response.status >= 400 && response.status < 500
      || response.ok && code != null && !['internal_error', 28001005, 28001006].includes(code);
    throw new PlatformError(`平台请求失败 HTTP ${response.status} / ${String(code || 'unknown').replace(/[^a-z0-9_]/gi, '').slice(0, 80)}`, rejected);
  }
  return data.data;
}
export async function creatorInfo(db: SupabaseClient, id: string, userId: string) {
  const { connection, token } = await connectionToken(db, id, userId);
  if (connection.platform === 'tiktok') {
    const info = await officialJson('tiktok', 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/', token, {});
    return { ...info, platform: 'tiktok', display_name: info.creator_nickname || connection.display_name };
  }
  return { platform: 'douyin', display_name: connection.display_name, privacy_level_options: ['0', '1', '2'],
    max_video_post_duration_sec: 900, comment_disabled: false, duet_disabled: true, stitch_disabled: true };
}
