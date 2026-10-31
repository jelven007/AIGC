import { accessRequest } from './accessControl';
import { mediaPreview } from './media';
import { EdgeRequestError } from '@/lib/edgeRequest';
import type { Material } from '@/types/types';
import { requireAccountSession, uploadAccountObject } from './accountSession';

export type EditorMaterial = Pick<Material, 'id' | 'name' | 'url' | 'type'> & Partial<Pick<Material, 'duration_sec' | 'tags' | 'user_id'>>;
interface UploadReceipt { request_key: string; input: Record<string, unknown> }
const receiptKey = (userId: string) => `shopro:material-uploads:${userId}`;
function receipts(userId: string): UploadReceipt[] {
  try { return JSON.parse(localStorage.getItem(receiptKey(userId)) || '[]'); } catch { return []; }
}
function forget(userId: string, key: string) {
  localStorage.setItem(receiptKey(userId), JSON.stringify(receipts(userId).filter(item => item.request_key !== key)));
}
function checkRegistration(saved: any) {
  if (saved?.deleted !== true && (!saved?.material?.id || typeof saved.material.url !== 'string')) throw new Error('原素材登记结果待确认，请恢复原上传');
}
async function requireUploadOwner(userId: string) {
  await requireAccountSession(userId);
}
export function pendingMaterialUploads(userId: string): number { return receipts(userId).length; }
export async function listMaterialAssets(offset = 0, limit = 30, type?: string, search = '', userId?: string): Promise<{ materials: Material[]; total: number }> {
  const data = await accessRequest('material-assets', { action: 'list', offset, limit, search, ...(type ? { type } : {}) }, userId);
  if (!Array.isArray(data.materials) || !Number.isInteger(data.total) || data.total < 0) throw new Error('素材列表格式异常，请重试读取');
  return data;
}
export async function readMediaDuration(url: string, type: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(type);
    const finish = (duration?: number) => {
      clearTimeout(timer); element.onloadedmetadata = null; element.ontimeupdate = null; element.onerror = null;
      element.removeAttribute('src'); element.load();
      if (duration && Number.isFinite(duration) && duration >= .1 && duration <= 36000) resolve(duration);
      else reject(new Error('无法读取有效媒体时长，请使用可播放的音频或视频'));
    };
    const timer = setTimeout(() => finish(), 12000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      if (Number.isFinite(element.duration)) finish(element.duration);
      else {
        element.ontimeupdate = () => finish(Number.isFinite(element.duration) ? element.duration : element.currentTime);
        element.currentTime = 1e10;
      }
    };
    element.onerror = () => finish();
    element.src = url;
  });
}
export async function materialDuration(material: EditorMaterial): Promise<number> {
  if (material.type === 'image') return 5;
  if (typeof material.duration_sec === 'number' && Number.isFinite(material.duration_sec) && material.duration_sec >= .1) return material.duration_sec;
  return readMediaDuration(await mediaPreview(material.url), material.type === 'audio' ? 'audio' : 'video');
}
export async function recoverMaterialUploads(userId: string): Promise<{ restored: number; deleted: number; pending: number; errors: string[] }> {
  await requireUploadOwner(userId);
  const result = { restored: 0, deleted: 0, pending: 0, errors: [] as string[] };
  for (const receipt of receipts(userId)) {
    try {
      await requireUploadOwner(userId);
      const saved = await accessRequest('material-assets', { action: 'register', ...receipt }, userId);
      await requireUploadOwner(userId);
      checkRegistration(saved);
      forget(userId, receipt.request_key);
      if (saved.deleted) result.deleted++; else result.restored++;
    } catch (cause) {
      result.pending++;
      result.errors.push(cause instanceof Error ? cause.message : '原素材登记恢复失败');
    }
  }
  return result;
}
export async function uploadMaterialAsset(file: File, userId: string, rightsConfirmed: boolean,
  source: 'upload' | 'recording' = 'upload'): Promise<Material> {
  await requireUploadOwner(userId);
  if (!rightsConfirmed) throw new Error('请确认素材使用权');
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('请上传1字节至50MB的媒体文件');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'm4a', 'opus'].includes(extension)
    || !/^(image|video|audio)\//.test(file.type)) throw new Error('请使用支持的图片、视频或音频格式');
  const type = file.type.split('/')[0] as 'image' | 'video' | 'audio';
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    byte => byte.toString(16).padStart(2, '0')).join('');
  await requireUploadOwner(userId);
  const original = receipts(userId).find(item => item.input.content_hash === hash && item.input.name === file.name
    && item.input.source === source && item.input.mime === file.type);
  const localUrl = URL.createObjectURL(file);
  let receipt: UploadReceipt;
  try {
    receipt = original || { request_key: crypto.randomUUID(), input: { name: file.name.slice(0, 200),
      type, extension, content_hash: hash, size: file.size, mime: file.type, source, rights_confirmed: true,
      duration_sec: type === 'image' ? null : await readMediaDuration(localUrl, type) } };
  } finally { URL.revokeObjectURL(localUrl); }
  if (!original) {
    const pending = receipts(userId);
    if (pending.length >= 20) throw new Error('请先恢复尚未确认的素材上传');
    localStorage.setItem(receiptKey(userId), JSON.stringify([...pending, receipt]));
  }
  const register = async () => {
    await requireUploadOwner(userId);
    const saved = await accessRequest('material-assets', { action: 'register', ...receipt }, userId);
    await requireUploadOwner(userId);
    checkRegistration(saved);
    forget(userId, receipt.request_key);
    if (saved.deleted) throw new Error('原素材已经删除，请重新选择文件上传');
    return saved.material as Material;
  };
  // 重选原文件先核对登记，避免对已上传对象发起覆盖写入。
  if (original) {
    try { return await register(); }
    catch (cause) { if (!(cause instanceof EdgeRequestError) || cause.status !== 404) throw cause; }
  }
  const path = `${userId}/uploads/${receipt.request_key}.${extension}`;
  await requireUploadOwner(userId);
  let uploadError: unknown;
  try { await uploadAccountObject(userId, 'materials', path, file); }
  catch (cause) { uploadError = cause; }
  // 包括响应丢失和已存在：只核对原对象，不生成新路径或覆盖。
  try { return await register(); }
  catch (cause) {
    if (uploadError && cause instanceof EdgeRequestError && cause.status === 404) throw new Error('原文件上传未确认，请重新选择相同文件重试');
    throw cause;
  }
}
