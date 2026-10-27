import { supabase } from '@/db/supabase';
import { backendUrl, backendAnonKey } from '@/lib/backendConfig';

/** 账号变更不是原业务请求被服务端拒绝，调用者必须保留原回执。 */
export class AccountChangedError extends Error {
  readonly status = 0;
  readonly code = 'ACCOUNT_CHANGED';
  constructor() { super('账号或会话已切换，请在原账号恢复任务'); }
}
export async function requireAccountSession(expectedUserId?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    if (expectedUserId) throw new AccountChangedError();
    throw new Error('请先登录');
  }
  if (expectedUserId && data.session.user.id !== expectedUserId) throw new AccountChangedError();
  return data.session;
}
export async function uploadAccountObject(userId: string, bucket: string, path: string, file: Blob, upsert = false) {
  const session = await requireAccountSession(userId);
  if (!['materials', 'videos', 'thumbnails'].includes(bucket) || path.split('/')[0] !== userId
    || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('素材上传路径不正确');
  const response = await fetch(`${backendUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', body: file, signal: AbortSignal.timeout(120000),
    headers: { apikey: backendAnonKey, Authorization: `Bearer ${session.access_token}`,
      'Content-Type': file.type || 'application/octet-stream', 'x-upsert': String(upsert) },
  });
  await requireAccountSession(userId);
  if (!response.ok) throw new Error('素材上传结果未确认，请核对原文件');
  return { path };
}

/** 把敏感写入固定到发起账号的令牌；SDK全局会话切换不能改写请求身份。 */
export async function accountRequest(userId: string, path: string, method: 'POST' | 'PUT', body: unknown, signal?: AbortSignal) {
  const session = await requireAccountSession(userId);
  signal?.throwIfAborted();
  const response = await fetch(`${backendUrl}${path}`, {
    method,
    headers: { apikey: backendAnonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  await requireAccountSession(userId);
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(typeof failure?.message === 'string' ? failure.message : '请求失败，请重试');
  }
  const result = await response.json();
  await requireAccountSession(userId);
  return result;
}
