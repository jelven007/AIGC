import { supabase } from '@/db/supabase';
import { backendAnonKey, edgeFunctionUrl } from '@/lib/backendConfig';

export class EdgeRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
/** SDK 刷新会话后，以用户 JWT 调用流式/二进制函数，anon key 仅作 apikey。 */
export async function authenticatedEdgeRequest(
  name: string,
  init: RequestInit,
  query = '',
): Promise<Response> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('请先登录后使用 AI 功能');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  headers.set('apikey', backendAnonKey);
  const response = await fetch(`${edgeFunctionUrl(name)}${query}`, { ...init, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new EdgeRequestError(data?.error || data?.message || `服务返回 HTTP ${response.status}`, response.status, data?.code);
  }
  return response;
}
