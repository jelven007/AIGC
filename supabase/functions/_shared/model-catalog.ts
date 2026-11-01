// 浏览器与服务端共用的协议目录，不包含凭据或运行时环境读取。
export const MODEL_SLOTS = [
  { id: 'text.primary', name: '主模型', category: 'text', protocols: ['openai-chat'], model: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' },
  { id: 'text.fallback', name: '备用文本模型', category: 'text', protocols: ['openai-chat'], model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
  { id: 'embedding.primary', name: '主模型', category: 'embedding', protocols: ['openai-embeddings'], model: '', endpoint: '' },
  { id: 'intelligence.youtube', name: 'YouTube公开频道统计', category: 'intelligence', protocols: ['youtube-data-v3'], model: '', endpoint: 'https://www.googleapis.com/youtube/v3' },
  { id: 'intelligence.ebay', name: 'eBay多市场商品搜索', category: 'intelligence', protocols: ['ebay-browse'], model: '', endpoint: 'https://api.ebay.com/buy/browse/v1' },
  { id: 'intelligence.licensed', name: '授权市场情报数据商', category: 'intelligence', protocols: ['intelligence-v1'], model: '', endpoint: '' },
  { id: 'image.primary', name: 'Seedream5.0flash', category: 'image', protocols: ['openai-images', 'chat-image'], model: '', endpoint: '' },
  { id: 'audio.tts', name: '语音合成', category: 'audio', protocols: ['openai-tts', 'step-tts'], model: '', endpoint: '' },
  { id: 'audio.asr', name: '语音识别', category: 'audio', protocols: ['openai-asr', 'step-asr'], model: '', endpoint: '' },
  { id: 'audio.voice_clone', name: '声音复刻', category: 'audio', protocols: ['elevenlabs-ivc'], model: 'eleven_multilingual_v2', endpoint: 'https://api.elevenlabs.io/v1' },
  { id: 'avatar.photo', name: '照片口播', category: 'avatar', protocols: ['did-talks'], model: '', endpoint: 'https://api.d-id.com/talks' },
  { id: 'avatar.lipsync', name: '视频口型', category: 'avatar', protocols: ['sync-lipsync'], model: 'lipsync-2', endpoint: 'https://api.sync.so/v2/generate' },
  { id: 'reader.primary', name: '商品网页读取', category: 'reader', protocols: ['jina-reader'], model: '', endpoint: 'https://r.jina.ai/' },
  { id: 'video.ArkSeedance', name: 'Seedance2.5', category: 'video', protocols: ['ArkSeedance'], model: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks' },
  { id: 'video.MiniMax', name: 'MiniMax 视频', category: 'video', protocols: ['MiniMax'], model: 'MiniMax-H3', endpoint: '' },
  { id: 'video.SeedanceMini', name: 'Seedance2.0mini', category: 'video', protocols: ['SeedanceMini'], model: 'seedance-2.0-mini', endpoint: '' },
  { id: 'video.Wan3', name: 'Wan3', category: 'video', protocols: ['Wan3'], model: 'wan3.0-video-prime', endpoint: '' },
  { id: 'video.HappyHorse', name: 'HappyHorse', category: 'video', protocols: ['HappyHorse'], model: 'happyhorse-1.1-t2v', endpoint: '' },
  { id: 'video.Kling', name: 'Kling', category: 'video', protocols: ['Kling'], model: '', endpoint: '' },
  { id: 'video.Seedance', name: 'Seedance 网关', category: 'video', protocols: ['Seedance'], model: 'Cdance2.0-A', endpoint: '' },
] as const;

export type ConfigurationScope = 'models' | 'integrations';
export const CUSTOM_MODEL_TYPES = [
  { id: 'text', label: '文本', protocols: ['openai-chat'] },
  { id: 'video', label: '视频', protocols: ['ArkSeedance', 'SeedanceMini', 'Wan3', 'HappyHorse', 'Kling', 'MiniMax', 'Seedance'] },
  { id: 'image', label: '图片', protocols: ['openai-images', 'chat-image'] },
  { id: 'audio', label: '音频', protocols: ['openai-tts', 'step-tts', 'openai-asr', 'step-asr', 'elevenlabs-ivc'] },
  { id: '3d', label: '3D', protocols: ['json-api'] },
  { id: 'embedding', label: '向量', protocols: ['openai-embeddings'] },
] as const;
export type CustomModelType = typeof CUSTOM_MODEL_TYPES[number]['id'];
export interface ModelSlotDefinition {
  id: string; name: string; category: string; protocols: readonly string[]; model: string; endpoint: string;
}
export function modelSlotDefinition(slot: unknown): ModelSlotDefinition | undefined {
  const builtin = MODEL_SLOTS.find(item => item.id === slot);
  if (builtin) return builtin;
  if (typeof slot !== 'string') return undefined;
  const match = /^custom\.(text|video|image|audio|3d|embedding)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(slot);
  const type = CUSTOM_MODEL_TYPES.find(item => item.id === match?.[1]);
  return type ? { id: slot, name: `新建${type.label}模型`, category: type.id,
    protocols: type.protocols, model: '', endpoint: '' } : undefined;
}
export function configurationSlots(scope?: ConfigurationScope, customSlots: string[] = []): ModelSlotDefinition[] {
  const builtin = MODEL_SLOTS.filter(item => scope === undefined || (scope === 'integrations'
    ? ['intelligence', 'reader'].includes(item.category)
    : !['intelligence', 'reader'].includes(item.category)
      && !['text.fallback', 'video.MiniMax', 'video.Seedance'].includes(item.id)));
  // 无scope目录仍供原业务路由使用；自建项只进入显式模型设置目录。
  return [...builtin, ...(scope === 'models' ? [...new Set(customSlots)].flatMap(slot => {
    const definition = modelSlotDefinition(slot);
    return typeof slot === 'string' && slot.startsWith('custom.') && definition ? [definition] : [];
  }) : [])];
}

// 退役信息独立于可配置目录，不能被启用或用于创建计费任务。
export const RETIRED_MODELS = [
  { id: 'Sora', name: 'Sora', retired_on: '2026-09-24',
    reason: 'OpenAI 官方 Sora API 已关闭，请选择已开通的视频供应商。',
    source: 'https://developers.openai.com/api/reference/resources/videos/methods/create' },
] as const;

export interface ModelSettings {
  name: string;
  protocol: string;
  endpoint: string;
  query_endpoint: string;
  model: string;
  auth_header: 'Authorization' | 'X-Gateway-Authorization' | 'api-key' | 'x-api-key' | 'xi-api-key' | 'x-goog-api-key';
  auth_scheme: 'Bearer' | 'raw' | 'Basic';
  timeout_ms: number;
  voice: string;
  test_endpoint: string;
  edit_endpoint?: string;
  supports_vision?: boolean;
}
export interface ModelConfigView {
  slot: string;
  enabled: boolean;
  version_id: string | null;
  has_key: boolean;
  settings: ModelSettings;
  updated_at?: string;
}
export function defaultSettings(slot: string): ModelSettings {
  const definition = modelSlotDefinition(slot);
  if (!definition) throw new Error('不支持的模型配置项');
  return {
    name: definition.name, protocol: definition.protocols[0], endpoint: definition.endpoint,
    query_endpoint: ['video', 'avatar'].includes(definition.category) ? definition.endpoint : '',
    model: definition.model, auth_header: slot === 'intelligence.youtube' ? 'x-goog-api-key' : slot === 'avatar.lipsync' ? 'x-api-key' : slot === 'audio.voice_clone' ? 'xi-api-key' : 'Authorization',
    auth_scheme: ['avatar.photo', 'intelligence.ebay'].includes(slot) ? 'Basic' : ['avatar.lipsync', 'audio.voice_clone', 'intelligence.youtube'].includes(slot) ? 'raw' : 'Bearer',
    timeout_ms: ['video', 'avatar', 'intelligence'].includes(definition.category) ? 30_000 : 90_000, voice: '', test_endpoint: '',
    ...(slot === 'image.primary' ? { edit_endpoint: '' } : {}),
  };
}
