import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { mediaObject, mediaReference, ownsMedia } from './private-media.ts';
import { IntelligenceError } from './intelligence-provider.ts';
import { responseBytes } from './audio-provider.ts';
import { validateEndpoint } from './model-registry.ts';

export function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
export const imageHash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  .map(value => value.toString(16).padStart(2, '0')).join('');
export function privateImageReference(value: string, uid: string): string {
  const backend = Deno.env.get('SUPABASE_URL')!;
  let object;
  try { object = mediaObject(value, backend); } catch { throw new IntelligenceError('私有图片地址非法'); }
  if (!object || object.bucket !== 'materials' || !ownsMedia(object.path, uid)) {
    throw new IntelligenceError('请上传自己的私有图片');
  }
  return mediaReference(backend, object.bucket, object.path);
}
export async function readIntelligenceImage(db: SupabaseClient, value: string, uid: string, expectedHash: string) {
  const reference = privateImageReference(value, uid), object = mediaObject(reference, Deno.env.get('SUPABASE_URL')!)!;
  const access = await db.rpc('can_read_media', { p_uid: uid, p_bucket: object.bucket, p_path: object.path });
  if (access.error) throw new Error('图片归属核对暂时失败');
  if (!access.data) throw new IntelligenceError('图片不存在或无权访问');
  const signed = await db.storage.from(object.bucket).createSignedUrl(object.path, 120);
  if (signed.error || !signed.data?.signedUrl) throw new IntelligenceError('图片读取失败，请重新上传');
  await validateEndpoint(Deno.env.get('SUPABASE_URL')!);
  const response = await fetch(signed.data.signedUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    await response.body?.cancel();
    if ([403,404,410].includes(response.status)) throw new IntelligenceError('图片不存在或无权访问');
    throw new Error('图片暂时无法读取');
  }
  let bytes: Uint8Array;
  try { bytes = await responseBytes(response, 5 * 1024 * 1024); }
  catch (cause) {
    if (cause instanceof Error && /超过限制|空内容/.test(cause.message)) throw new IntelligenceError('图片大小须在5MB以内');
    throw cause;
  }
  const type = imageType(bytes);
  if (!type) throw new IntelligenceError('仅支持JPEG、PNG或WebP图片');
  if (await imageHash(bytes) !== expectedHash) throw new IntelligenceError('图片内容已发生变化，请重新保存搜索对象');
  return { bytes, type, reference };
}
