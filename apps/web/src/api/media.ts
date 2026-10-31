import { backendUrl } from '@/lib/backendConfig';
import { canonicalMedia, hydrateMediaTree } from '@/lib/privateMedia';
import { backendAnonKey } from '@/lib/backendConfig';
import { requireAccountSession, uploadAccountObject } from './accountSession';

export async function mediaPreview(value: string, userId?: string): Promise<string> {
  const session = await requireAccountSession(userId);
  const preview = await hydrateMediaTree(value, new Headers({ Authorization: `Bearer ${session.access_token}`, apikey: backendAnonKey }));
  await requireAccountSession(session.user.id);
  return preview;
}
export function storedMedia(bucket: string, path: string): string {
  return `${backendUrl}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
export async function uploadPrivateMedia(bucket: string, path: string, file: Blob, upsert = false): Promise<{ reference: string; preview: string }> {
  const userId = path.split('/')[0];
  const data = await uploadAccountObject(userId, bucket, path, file, upsert);
  const reference = storedMedia(bucket, data.path);
  return { reference, preview: await mediaPreview(reference, userId) };
}
export async function stableMedia(value: string, userId: string): Promise<string> {
  await requireAccountSession(userId);
  const canonical = canonicalMedia(value);
  if (canonical !== value || canonical.includes('/storage/v1/object/authenticated/')) return canonical;
  if (!value.startsWith('blob:') && !value.startsWith('data:') && !value.startsWith('/')) return value;
  const response = await fetch(value);
  if (!response.ok) throw new Error('素材读取失败');
  const blob = await response.blob();
  if (!/^(image|video|audio)\//.test(blob.type) || blob.size > 100 * 1024 * 1024) throw new Error('请上传不超过100MB的媒体文件');
  return (await uploadPrivateMedia('materials', `${userId}/imports/${crypto.randomUUID()}.${blob.type.split('/')[1]}`, blob)).reference;
}
