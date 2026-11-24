import { requireAccountSession } from './accountSession';
import { backendAnonKey, backendUrl } from '@/lib/backendConfig';
import { canonicalMedia, canonicalMediaTree, hydrateMediaTree } from '@/lib/privateMedia';
import { validateCanvasDocument, canvasJsonKey } from '@/lib/canvasDocument';
import type { CanvasDocument, CanvasProject } from '@/types/canvas';

export class CanvasServiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export class CanvasConflictError extends CanvasServiceError {
  constructor() { super('画布版本冲突，已保留当前内容；请重载云端或另存画布', 409); }
}
async function request(userId: string, path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const session = await requireAccountSession(userId);
  signal?.throwIfAborted();
  const headers = { apikey: backendAnonKey, Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json', Prefer: 'return=representation' };
  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(canonicalMediaTree(body)) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  } catch (cause) {
    await requireAccountSession(userId); signal?.throwIfAborted();
    throw new CanvasServiceError(cause instanceof Error ? cause.message : '画布请求结果待确认', 0);
  }
  await requireAccountSession(userId); signal?.throwIfAborted();
  const data = await response.json().catch(() => null);
  if (response.status === 409) throw new CanvasConflictError();
  if (!response.ok) throw new CanvasServiceError(data?.message || '画布服务暂时不可用，请重试', response.status);
  const result = await hydrateMediaTree(data, new Headers(headers));
  await requireAccountSession(userId); signal?.throwIfAborted();
  return result;
}
function ownedProject(value: CanvasProject, userId: string, id?: string): CanvasProject {
  if (!value || value.user_id !== userId || id && value.id !== id || !Number.isInteger(value.revision) || value.revision < 1) {
    throw new Error('画布回执归属或版本不正确');
  }
  return { ...value, document: validateCanvasDocument(value.document) };
}
export async function listCanvasProjects(userId: string, signal?: AbortSignal): Promise<CanvasProject[]> {
  const query = new URLSearchParams({ select: '*', user_id: `eq.${userId}`, order: 'updated_at.desc', limit: '100' });
  const rows = await request(userId, `/rest/v1/canvas_projects?${query}`, 'GET', undefined, signal);
  if (!Array.isArray(rows)) throw new Error('画布列表回执无效');
  return rows.map(row => ownedProject(row, userId));
}
export async function loadCanvasProject(userId: string, id: string, signal?: AbortSignal): Promise<CanvasProject> {
  const query = new URLSearchParams({ select: '*', user_id: `eq.${userId}`, id: `eq.${id}`, limit: '1' });
  const rows = await request(userId, `/rest/v1/canvas_projects?${query}`, 'GET', undefined, signal);
  if (!Array.isArray(rows) || !rows[0]) throw new CanvasServiceError('画布不存在或无权访问', 404);
  return ownedProject(rows[0], userId, id);
}
export function assertCanvasMediaOwner(document: CanvasDocument, userId: string) {
  for (const node of document.nodes) {
    if (!node.data.url) continue;
    const url = new URL(canonicalMedia(node.data.url));
    if (url.origin !== new URL(backendUrl).origin || !url.pathname.startsWith('/storage/v1/object/authenticated/')
      || !['materials', 'videos', 'thumbnails'].includes(url.pathname.split('/')[5])
      || decodeURIComponent(url.pathname.split('/')[6] || '') !== userId) throw new Error('工程包含无权使用的媒体，请从当前账号素材库重新选择');
  }
}
export async function verifyCanvasMedia(document: CanvasDocument, userId: string) {
  assertCanvasMediaOwner(document, userId);
  const session = await requireAccountSession(userId);
  const urls = [...new Set(document.nodes.map(n => n.data.url).filter(Boolean) as string[])];
  for (const value of urls) {
    const url = new URL(canonicalMedia(value));
    const response = await fetch(`${backendUrl}${url.pathname.replace('/object/authenticated/', '/object/sign/')}`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: backendAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 300 }), signal: AbortSignal.timeout(15000),
    });
    await requireAccountSession(userId);
    if (!response.ok) throw new Error('工程媒体不存在或访问权限已失效，请重新选择素材');
  }
}
export async function createCanvasProject(userId: string, id: string, title: string, document: CanvasDocument, signal?: AbortSignal) {
  const clean = validateCanvasDocument(document);
  assertCanvasMediaOwner(clean, userId);
  try {
    return ownedProject(await request(userId, '/rest/v1/rpc/create_canvas_project', 'POST',
      { p_id: id, p_title: title, p_document: clean }, signal), userId, id);
  } catch (cause) {
    if (!(cause instanceof CanvasServiceError) || cause.status && cause.status < 500) throw cause;
    try { return await loadCanvasProject(userId, id, signal); } catch { throw cause; }
  }
}
export async function saveCanvasProject(userId: string, id: string, revision: number, title: string, document: CanvasDocument, signal?: AbortSignal) {
  const clean = validateCanvasDocument(document);
  assertCanvasMediaOwner(clean, userId);
  try {
    const result = ownedProject(await request(userId, '/rest/v1/rpc/save_canvas_project', 'POST',
      { p_id: id, p_revision: revision, p_title: title, p_document: clean }, signal), userId, id);
    if (result.revision < revision + 1) throw new Error('画布保存版本尚未确认');
    return result;
  } catch (cause) {
    if (!(cause instanceof CanvasServiceError) || cause.status && cause.status < 500) throw cause;
    try {
      const saved = await loadCanvasProject(userId, id, signal);
      if (saved.revision >= revision + 1 && saved.title === title
        && canvasJsonKey(canonicalMediaTree(saved.document)) === canvasJsonKey(canonicalMediaTree(clean))) return saved;
    } catch { /* Keep the original write error and local recovery document. */ }
    throw cause;
  }
}
export async function deleteCanvasProject(userId: string, id: string) {
  const query = new URLSearchParams({ user_id: `eq.${userId}`, id: `eq.${id}` });
  const rows = await request(userId, `/rest/v1/canvas_projects?${query}`, 'DELETE');
  if (!Array.isArray(rows) || rows.some(row => row.user_id !== userId || row.id !== id)) throw new Error('画布删除回执无效');
}
