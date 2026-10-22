import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { mediaObject, signedMedia } from './private-media.ts';
import { validateEndpoint } from './model-registry.ts';

function pngHeader(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)
    || new TextDecoder().decode(bytes.subarray(12, 16)) !== 'IHDR') throw new Error('编辑原图与掩码须为PNG图片');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (![1024, 1536].includes(width) || ![1024, 1536].includes(height) || width * height > 1572864
    || bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] || bytes[27] || bytes[28]) throw new Error('编辑PNG须为标准尺寸、8位RGB/RGBA非交错图片');
  return { width, height, channels: bytes[25] === 6 ? 4 : 3 };
}
async function checkPngPixels(bytes: Uint8Array, mask = true) {
  const header = pngHeader(bytes);
  if (mask && header.channels !== 4) throw new Error('掩码须包含透明通道');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (offset + length + 12 > bytes.length) throw new Error('PNG图片内容损坏');
    if (type === 'IDAT') parts.push(bytes.slice(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += length + 12;
  }
  const stride = header.width * header.channels, expected = (stride + 1) * header.height;
  const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const decoded = new Uint8Array(expected); let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      if (total + chunk.value.length > expected) throw new Error('掩码解压尺寸超出限制');
      decoded.set(chunk.value, total); total += chunk.value.length;
    }
  } catch { throw new Error('透明掩码内容损坏或尺寸超限'); }
  finally { await reader.cancel().catch(() => {}); }
  if (total !== expected) throw new Error('透明掩码内容不完整');
  let previous = new Uint8Array(stride), transparent = 0, opaque = 0;
  for (let y = 0; y < header.height; y++) {
    const start = y * (stride + 1), filter = decoded[start], row = decoded.slice(start + 1, start + stride + 1);
    if (filter > 4) throw new Error('掩码PNG过滤格式非法');
    if (!mask) continue;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0, up = previous[x], upperLeft = x >= 4 ? previous[x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      row[x] = (row[x] + predictor) & 255;
      if (x % 4 === 3) {
        if (row[x] === 0) transparent++;
        else if (row[x] === 255) opaque++;
        else throw new Error('掩码应仅包含全透明编辑区域和不透明保留区域');
      }
    }
    previous = row;
  }
  if (mask && (!transparent || !opaque)) throw new Error('掩码须同时包含编辑区域和保留区域');
  return header;
}
async function privateImage(db: SupabaseClient, userId: string, value: unknown, pngOnly: boolean) {
  if (typeof value !== 'string' || !mediaObject(value, Deno.env.get('SUPABASE_URL') || '')) throw new Error('图片编辑须使用已上传的私有素材');
  const source = await signedMedia(db, value, userId, 900), url = new URL(source), unsigned = new URL(url);
  unsigned.search = ''; await validateEndpoint(unsigned.href);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!response?.ok || !response.body) throw new Error('编辑素材读取失败，请恢复原素材后重试');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.length;
      if (total > 12 * 1024 * 1024) throw new Error('编辑PNG不能超过12MB');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  if (pngOnly) pngHeader(bytes);
  else if (!png && !jpeg && !webp) throw new Error('参考原图须为PNG、JPEG或WebP');
  return { bytes, mime: jpeg ? 'image/jpeg' : webp ? 'image/webp' : 'image/png' };
}
function dataUrl(bytes: Uint8Array, mime = 'image/png') {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,` + btoa(binary);
}
export async function readImageEditInput(db: SupabaseClient, userId: string, input: Record<string, unknown>) {
  const source = await privateImage(db, userId, input.reference_image, !!input.mask_image);
  const mask = input.mask_image ? await privateImage(db, userId, input.mask_image, true) : null;
  if (mask) {
    const original = await checkPngPixels(source.bytes, false), dimensions = await checkPngPixels(mask.bytes);
    if (input.size && `${original.width}x${original.height}` !== input.size) throw new Error('编辑画布须与输出尺寸一致');
    if (dimensions.width !== original.width || dimensions.height !== original.height) throw new Error('透明掩码须与编辑原图尺寸一致');
  }
  return { images: [{ image_url: dataUrl(source.bytes, source.mime) }], ...(mask ? { mask: { image_url: dataUrl(mask.bytes) } } : {}) };
}
