import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { modelFetch, resolveModel, validateEndpoint } from './model-registry.ts';
import { mediaReference, signedMedia } from './private-media.ts';
import { requireImageCapability } from './image-contract.ts';
import { readImageEditInput } from './image-edit-input.ts';

export async function generateImage(db: SupabaseClient, userId: string, input: Record<string, unknown>, options: {
  version?: string; jobId?: string; evidence?: any; checkpoint?: (data: unknown) => Promise<void>;
  executing?: () => Promise<void>;
} = {}): Promise<{ image_url: string; size: number }> {
  const config = await resolveModel('image.primary', db, options.version);
  const mode = requireImageCapability(input, config.settings);
  const size = String(input.size || '1024x1024');
  if (!['1024x1024', '1024x1536', '1536x1024'].includes(size)) throw new Error('图片尺寸不支持');
  const quality = String(input.quality || 'auto');
  if (!['auto', 'low', 'medium', 'high'].includes(quality)) throw new Error('图片质量不支持');
  let reference: string | undefined;
  let editInput: Awaited<ReturnType<typeof readImageEditInput>> | undefined;
  if (!options.evidence && mode !== 'generate' && config.settings.protocol === 'openai-images') {
    editInput = await readImageEditInput(db, userId, input);
  } else if (!options.evidence && input.reference_image) {
    if (typeof input.reference_image !== 'string') throw new Error('参考图应为已上传的公网地址');
    reference = await signedMedia(db, input.reference_image, userId, 3600);
    const checked = new URL(reference); checked.search = '';
    await validateEndpoint(checked.href);
  }
  let data = options.evidence;
  if (!data) {
    await options.executing?.();
    const response = await modelFetch(editInput ? { ...config, settings: { ...config.settings, endpoint: config.settings.edit_endpoint! } } : config,
      JSON.stringify(config.settings.protocol === 'openai-images'
    ? { model: config.settings.model, prompt: String(input.prompt).trim(), n: 1, size, quality,
      ...(editInput ? { ...editInput, output_format: 'png' } : {}) }
    : { model: config.settings.model, stream: false, messages: [{ role: 'user', content: [
      { type: 'text', text: `生成图片，尺寸 ${size}，质量 ${quality}，返回图片 URL：${String(input.prompt).trim()}` },
      ...(reference ? [{ type: 'image_url', image_url: { url: reference } }] : []),
    ] }] }));
    const reader = response.body?.getReader();
    let text = '', total = 0;
    const decoder = new TextDecoder();
    try {
      if (!reader) throw new Error('模型返回格式无效');
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        total += chunk.value.length;
        if (total > 28_000_000) throw new Error('模型返回图片内容过大');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader?.cancel().catch(() => {}); }
    const raw = JSON.parse(text);
    const content = raw?.choices?.[0]?.message?.content;
    const encoded = raw?.data?.[0]?.b64_json;
    const source = raw?.data?.[0]?.url || (typeof content === 'string' ? content.match(/https:\/\/[^\s<>"\])]+/)?.[0] : null);
    data = encoded ? { data: [{ b64_json: encoded }] } : source ? { data: [{ url: source }] } : null;
    if (!data) throw new Error('模型未返回图片，请核对接口协议');
    await options.checkpoint?.(data);
  }
  let imageBytes: Uint8Array;
  let mime = 'image/png';
  const encoded = data?.data?.[0]?.b64_json;
  if (typeof encoded === 'string') {
    if (encoded.length > 28_000_000) throw new Error('生成图片超过 20MB');
    try {
      const binary = atob(encoded);
      imageBytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) imageBytes[index] = binary.charCodeAt(index);
    }
    catch { throw new Error('模型返回的图片编码不正确'); }
  } else {
    const content = data?.choices?.[0]?.message?.content;
    const source = data?.data?.[0]?.url || (typeof content === 'string' ? content.match(/https:\/\/[^\s<>"\])]+/)?.[0] : null);
    if (!source || typeof source !== 'string') throw new Error('模型未返回图片，请核对接口协议');
    const url = new URL(source);
    const unsigned = new URL(url); unsigned.search = '';
    await validateEndpoint(unsigned.href);
    const media = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!media?.ok || !media.body) throw new Error('生成图片下载失败');
    mime = media.headers.get('content-type')?.split(';')[0] || '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('模型返回的文件不是支持的图片');
    const reader = media.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.length;
        if (total > 20 * 1024 * 1024) throw new Error('生成图片超过 20MB');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    imageBytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { imageBytes.set(chunk, offset); offset += chunk.length; }
  }
  if (!imageBytes.length) throw new Error('模型返回空图片');
  const png = imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4e && imageBytes[3] === 0x47;
  const jpeg = imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff;
  const webp = new TextDecoder().decode(imageBytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(imageBytes.subarray(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('模型返回的内容不是有效图片');
  mime = jpeg ? 'image/jpeg' : webp ? 'image/webp' : 'image/png';
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const path = `generated-images/${userId}/${options.jobId || crypto.randomUUID()}.${extension}`;
  const { error } = await db.storage.from('materials').upload(path, new Blob([imageBytes], { type: mime }), { contentType: mime, upsert: true });
  if (error) throw new Error('图片保存失败，请稍后重试');
  return { image_url: mediaReference(Deno.env.get('SUPABASE_URL') || '', 'materials', path), size: imageBytes.length };
}
