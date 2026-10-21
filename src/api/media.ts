import { supabase } from '@/db/supabase';
import { backendUrl } from '@/lib/backendConfig';
import { canonicalMedia, hydrateMediaTree } from '@/lib/privateMedia';
import { backendAnonKey } from '@/lib/backendConfig';

export async function mediaPreview(value: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('请先登录');
  return hydrateMediaTree(value, new Headers({ Authorization: `Bearer ${session.access_token}`, apikey: backendAnonKey }));
}
export function storedMedia(bucket: string, path: string): string {
  return `${backendUrl}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
export async function uploadPrivateMedia(bucket: string, path: string, file: Blob, upsert = false): Promise<{ reference: string; preview: string }> {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert });
  if (error || !data) throw new Error('素材上传失败');
  const reference = storedMedia(bucket, data.path);
  return { reference, preview: await mediaPreview(reference) };
}
export async function stableMedia(value: string, userId: string): Promise<string> {
  const canonical = canonicalMedia(value);
  if (canonical !== value || canonical.includes('/storage/v1/object/authenticated/')) return canonical;
  if (!value.startsWith('blob:') && !value.startsWith('data:') && !value.startsWith('/')) return value;
  const response = await fetch(value);
  if (!response.ok) throw new Error('素材读取失败');
  const blob = await response.blob();
  if (!/^(image|video|audio)\//.test(blob.type) || blob.size > 100 * 1024 * 1024) throw new Error('请上传不超过100MB的媒体文件');
  return (await uploadPrivateMedia('materials', `${userId}/imports/${crypto.randomUUID()}.${blob.type.split('/')[1]}`, blob)).reference;
}
