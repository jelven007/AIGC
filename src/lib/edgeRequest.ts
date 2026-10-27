import { backendAnonKey, edgeFunctionUrl } from '@/lib/backendConfig';
import { requireAccountSession } from '@/api/accountSession';

export class EdgeRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly outcome?: string) { super(message); }
}
/** SDK 刷新会话后，以用户 JWT 调用流式/二进制函数，anon key 仅作 apikey。 */
export async function authenticatedEdgeRequest(
  name: string,
  init: RequestInit,
  query = '',
  expectedUserId?: string,
): Promise<Response> {
  const session = await requireAccountSession(expectedUserId);
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  headers.set('apikey', backendAnonKey);
  const response = await fetch(`${edgeFunctionUrl(name)}${query}`, { ...init, headers });
  await requireAccountSession(session.user.id);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    await requireAccountSession(session.user.id);
    throw new EdgeRequestError(data?.error || data?.message || `服务返回 HTTP ${response.status}`, response.status, data?.code, data?.outcome);
  }
  return response;
}

/** 固定身份覆盖网络和正文解析两个await阶段，保持服务端错误状态与回执语义。 */
export async function authenticatedEdgeJSON<T = any>(name: string, init: RequestInit, expectedUserId?: string): Promise<T> {
  const session = await requireAccountSession(expectedUserId);
  const timeout = AbortSignal.timeout(15000);
  const response = await authenticatedEdgeRequest(name, {
    ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  }, '', session.user.id);
  const result = await response.json();
  await requireAccountSession(session.user.id);
  return result;
}
