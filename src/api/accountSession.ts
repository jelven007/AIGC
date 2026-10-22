import { supabase } from '@/db/supabase';
import { backendUrl, backendAnonKey } from '@/lib/backendConfig';

/** 把敏感写入固定到发起账号的令牌；SDK全局会话切换不能改写请求身份。 */
export async function accountRequest(userId: string, path: string, method: 'POST' | 'PUT', body: unknown, signal?: AbortSignal) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId) throw new Error('会话已变更，请重新登录');
  signal?.throwIfAborted();
  const response = await fetch(`${backendUrl}${path}`, {
    method,
    headers: { apikey: backendAnonKey, Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(typeof failure?.message === 'string' ? failure.message : '请求失败，请重试');
  }
  return response.json();
}
