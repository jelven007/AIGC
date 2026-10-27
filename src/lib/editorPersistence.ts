import { requireAccountSession } from '@/api/accountSession';
import { loadEditorProject } from '@/api/editorProjects';
import { backendAnonKey } from './backendConfig';
import { canonicalMediaTree, hydrateMediaTree } from './privateMedia';
import { readTaskReceipt, writeTaskReceipt } from './taskReceipt';

export interface EditorSnapshot {
  importId: string | null; projectTitle: string; tracks: any[];
  duration: number; [key: string]: any;
}
const draftKey = (userId: string) => `video-editor-draft-${userId}`;
const validDraft = (value: any) => value && Array.isArray(value.tracks) && typeof value.projectTitle === 'string'
  && (value.importId === null || typeof value.importId === 'string')
  && typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration > 0;
export async function restoreEditorSnapshot(userId: string, projectId: string | null, signal?: AbortSignal): Promise<EditorSnapshot | null> {
  const local = readTaskReceipt<EditorSnapshot>(draftKey(userId), validDraft);
  if (local.error) throw new Error('剪辑草稿读取失败，请恢复浏览器存储并重新加载；原草稿已保留');
  if (local.value && (!projectId || local.value.importId === projectId)) {
    const session = await requireAccountSession(userId);
    signal?.throwIfAborted();
    const result = await hydrateMediaTree(local.value, new Headers({ Authorization: `Bearer ${session.access_token}`, apikey: backendAnonKey }));
    await requireAccountSession(userId);
    signal?.throwIfAborted();
    return result;
  }
  if (!projectId) return null;
  const project = await loadEditorProject(userId, projectId, signal);
  const style = project.style_data || {};
  return { ...style, importId: project.id, projectTitle: project.title,
    tracks: Array.isArray(style.tracks) ? style.tracks : project.materials || [],
    duration: style.duration || project.duration || 30, previewVideoUrl: style.previewVideoUrl || project.video_url };
}
export function persistEditorSnapshot(userId: string, snapshot: EditorSnapshot) {
  try { writeTaskReceipt(draftKey(userId), canonicalMediaTree(snapshot)); }
  catch { throw new Error('剪辑草稿无法保存，请恢复浏览器存储；请保留当前页面并重试保存'); }
}
/** Serializes captured snapshots; an unsuccessful write cannot block later recovery. */
export class EditorSaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(save: () => Promise<T>): Promise<T> {
    const result = this.tail.then(save);
    this.tail = result.catch(() => {});
    return result;
  }
}
