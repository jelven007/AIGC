// 图片请求及可验证的协议能力；浏览器、API与工作进程共用。
export type ImageMode = 'generate' | 'reference' | 'inpaint' | 'outpaint';
export const GPT_IMAGE_EDIT_MODELS = [
  'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'chatgpt-image-latest',
  'gpt-image-2', 'gpt-image-2-2026-04-21',
  'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08',
  'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08',
] as const;
export function imageCapabilities(settings?: { protocol?: string; model?: string; edit_endpoint?: string }) {
  const mask = settings?.protocol === 'openai-images' && !!settings.edit_endpoint
    && (GPT_IMAGE_EDIT_MODELS as readonly string[]).includes(settings.model || '');
  return { reference: mask || settings?.protocol === 'chat-image', mask };
}
export function validateImageInput(input: Record<string, unknown>): ImageMode {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000
    || !['1024x1024', '1024x1536', '1536x1024'].includes(String(input.size || '1024x1024'))
    || !['auto', 'low', 'medium', 'high'].includes(String(input.quality || 'auto'))) throw new Error('图片描述、尺寸或质量非法');
  const mode = input.mode || (input.reference_image ? 'reference' : 'generate');
  if (!['generate', 'reference', 'inpaint', 'outpaint'].includes(String(mode))) throw new Error('图片编辑模式非法');
  if (mode === 'generate' && (input.reference_image || input.mask_image)) throw new Error('文本绘图不能附带编辑素材');
  if (mode !== 'generate' && (typeof input.reference_image !== 'string' || !input.reference_image)) throw new Error('请先准备编辑原图');
  if (['inpaint', 'outpaint'].includes(String(mode)) && (typeof input.mask_image !== 'string' || !input.mask_image)) throw new Error('请先准备透明掩码');
  if (!['inpaint', 'outpaint'].includes(String(mode)) && input.mask_image) throw new Error('当前模式不能附带掩码');
  if (['inpaint', 'outpaint'].includes(String(mode)) && (!Number.isInteger(input.confirmed_credit_cost)
    || Number(input.confirmed_credit_cost) < 0 || typeof input.confirmed_model_version !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(input.confirmed_model_version))) throw new Error('请确认图片编辑价格和模型版本');
  return mode as ImageMode;
}
export function requireImageCapability(input: Record<string, unknown>, settings: Parameters<typeof imageCapabilities>[0]) {
  const mode = validateImageInput(input), capabilities = imageCapabilities(settings);
  if (mode === 'reference' && !capabilities.reference) throw new Error('当前图片模型不支持参考图');
  if (['inpaint', 'outpaint'].includes(mode) && !capabilities.mask) throw new Error('当前图片模型未配置扩图与掩码编辑能力');
  return mode;
}
