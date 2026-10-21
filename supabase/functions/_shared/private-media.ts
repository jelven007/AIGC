import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const buckets = new Set(['materials', 'videos', 'thumbnails']);
export function mediaObject(value: string, backend: string): { bucket: string; path: string } | null {
  const url = new URL(value, backend);
  if (url.origin !== new URL(backend).origin) return null;
  const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
  if (!match || !buckets.has(match[1])) return null;
  const path = decodeURIComponent(match[2]);
  if (path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('素材路径非法');
  return { bucket: match[1], path };
}
export function mediaReference(backend: string, bucket: string, path: string): string {
  if (!buckets.has(bucket) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('素材路径非法');
  return `${backend.replace(/\/+$/, '')}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
export function ownsMedia(path: string, userId: string): boolean {
  const parts = path.split('/');
  return parts[0] === userId || (['generated-videos', 'generated-images'].includes(parts[0]) && parts[1] === userId);
}
export async function signedMedia(db: SupabaseClient, value: string, userId: string, seconds = 900): Promise<string> {
  const backend = Deno.env.get('SUPABASE_URL') || '';
  const object = mediaObject(value, backend);
  if (!object) return value;
  const allowed = await db.rpc('can_read_media', { p_uid: userId, p_bucket: object.bucket, p_path: object.path });
  if (allowed.error || !allowed.data) throw new Error('无权访问此素材');
  const { data, error } = await db.storage.from(object.bucket).createSignedUrl(object.path, seconds);
  if (error || !data?.signedUrl) throw new Error('素材签名失败或素材不存在');
  return data.signedUrl;
}
export async function signMediaTree(db: SupabaseClient, value: unknown, userId: string, seconds = 900): Promise<any> {
  if (typeof value === 'string' && value.includes('/storage/v1/object/')) return signedMedia(db, value, userId, seconds);
  if (Array.isArray(value)) return Promise.all(value.map(item => signMediaTree(db, item, userId, seconds)));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = await signMediaTree(db, item, userId, seconds);
    return result;
  }
  return value;
}
export function canonicalMediaTree(value: unknown, userId: string): any {
  const backend = Deno.env.get('SUPABASE_URL') || '';
  if (typeof value === 'string' && value.includes('/storage/v1/object/')) {
    const object = mediaObject(value, backend);
    if (!object) return value;
    // 非标准旧路径由签名时查 legacy_media_access；新任务规范路径直接隔离用户。
    return mediaReference(backend, object.bucket, object.path);
  }
  if (Array.isArray(value)) return value.map(item => canonicalMediaTree(item, userId));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalMediaTree(item, userId)]));
  return value;
}

/** 创建计费任务前检查所有本站素材归属；数据库只保存不含过期令牌的引用。 */
export async function validateMediaTree(db: SupabaseClient, value: unknown, userId: string): Promise<any> {
  await signMediaTree(db, value, userId);
  return canonicalMediaTree(value, userId);
}
