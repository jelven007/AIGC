import { requireAccountSession } from './accountSession';
import { backendAnonKey, backendUrl } from '@/lib/backendConfig';
import { canonicalMediaTree, hydrateMediaTree } from '@/lib/privateMedia';

export interface EditorProject {
  id: string; user_id: string; title: string; duration: number | null;
  video_url: string | null; thumbnail_url: string | null; resolution: string | null;
  style_data: Record<string, any> | null; materials: any[] | null; status: string;
}
async function request(userId: string, query: URLSearchParams, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const session = await requireAccountSession(userId);
  signal?.throwIfAborted();
  const headers = { apikey: backendAnonKey, Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json', Prefer: query.has('on_conflict')
      ? 'resolution=ignore-duplicates,return=representation' : 'return=representation' };
  const response = await fetch(`${backendUrl}/rest/v1/video_projects?${query}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(canonicalMediaTree(body)) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const data = await response.json();
  await requireAccountSession(userId);
  signal?.throwIfAborted();
  if (!response.ok) throw new Error(data?.message || '工程服务读取或保存失败');
  if (!Array.isArray(data) || data.some(row => row.user_id !== userId)) throw new Error('工程回执归属不正确');
  const hydrated = await hydrateMediaTree(data, new Headers(headers));
  await requireAccountSession(userId);
  signal?.throwIfAborted();
  return hydrated as EditorProject[];
}
export async function loadEditorProject(userId: string, id: string, signal?: AbortSignal) {
  const rows = await request(userId, new URLSearchParams({ select: '*', id: `eq.${id}`, user_id: `eq.${userId}`, limit: '1' }), 'GET', undefined, signal);
  if (!rows[0]) throw new Error('工程不存在或无权访问');
  return rows[0];
}
export function listEditorProjects(userId: string, limit = 20, signal?: AbortSignal) {
  return request(userId, new URLSearchParams({ select: '*', user_id: `eq.${userId}`, status: 'eq.completed',
    order: 'created_at.desc', limit: String(limit) }), 'GET', undefined, signal);
}
export async function saveEditorProject(userId: string, id: string, payload: Record<string, unknown>, signal?: AbortSignal) {
  const rows = await request(userId, new URLSearchParams({ select: '*', id: `eq.${id}`, user_id: `eq.${userId}` }),
    'PATCH', payload, signal);
  if (!rows[0] || rows[0].id !== id) throw new Error('工程不存在或无权保存');
  return id;
}
/** Client UUID makes a lost create response recoverable without a duplicate project. */
export async function createEditorProject(userId: string, id: string, payload: Record<string, unknown>, signal?: AbortSignal) {
  const rows = await request(userId, new URLSearchParams({ select: '*', on_conflict: 'id' }), 'POST',
    { ...payload, id, user_id: userId }, signal);
  if (!rows.length) {
    await loadEditorProject(userId, id, signal);
    const editable = Object.fromEntries(Object.entries(payload).filter(([field]) =>
      ['title', 'materials', 'style_data', 'updated_at'].includes(field)));
    return saveEditorProject(userId, id, editable, signal);
  }
  if (!rows[0] || rows[0].id !== id) throw new Error('工程创建回执待确认，请恢复原工程');
  return id;
}
