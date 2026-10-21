// 浏览器与服务端共用的协议目录，不包含凭据或运行时环境读取。
export const MODEL_SLOTS = [
  { id: 'text.primary', name: '主文本模型', category: 'text', protocols: ['openai-chat'], model: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' },
  { id: 'text.fallback', name: '备用文本模型', category: 'text', protocols: ['openai-chat'], model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
  { id: 'embedding.primary', name: '知识库 Embedding', category: 'embedding', protocols: ['openai-embeddings'], model: '', endpoint: '' },
  { id: 'image.primary', name: '图片与封面', category: 'image', protocols: ['openai-images', 'chat-image'], model: '', endpoint: '' },
  { id: 'audio.tts', name: '语音合成', category: 'audio', protocols: ['openai-tts', 'step-tts'], model: '', endpoint: '' },
  { id: 'audio.asr', name: '语音识别', category: 'audio', protocols: ['openai-asr', 'step-asr'], model: '', endpoint: '' },
  { id: 'audio.voice_clone', name: 'ElevenLabs 声纹克隆与配音', category: 'audio', protocols: ['elevenlabs-ivc'], model: 'eleven_multilingual_v2', endpoint: 'https://api.elevenlabs.io/v1' },
  { id: 'avatar.photo', name: '照片数字人口播', category: 'avatar', protocols: ['did-talks'], model: '', endpoint: 'https://api.d-id.com/talks' },
  { id: 'avatar.lipsync', name: '视频口型同步', category: 'avatar', protocols: ['sync-lipsync'], model: 'lipsync-2', endpoint: 'https://api.sync.so/v2/generate' },
  { id: 'reader.primary', name: '商品网页读取', category: 'reader', protocols: ['jina-reader'], model: '', endpoint: 'https://r.jina.ai/' },
  { id: 'video.ArkSeedance', name: '火山方舟 Seedance', category: 'video', protocols: ['ArkSeedance'], model: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks' },
  { id: 'video.MiniMax', name: 'MiniMax 视频', category: 'video', protocols: ['MiniMax'], model: 'MiniMax-H3', endpoint: '' },
  { id: 'video.SeedanceMini', name: 'Seedance Mini', category: 'video', protocols: ['SeedanceMini'], model: 'seedance-2.0-mini', endpoint: '' },
  { id: 'video.Wan3', name: 'Wan3', category: 'video', protocols: ['Wan3'], model: 'wan3.0-video-prime', endpoint: '' },
  { id: 'video.HappyHorse', name: 'HappyHorse', category: 'video', protocols: ['HappyHorse'], model: 'happyhorse-1.1-t2v', endpoint: '' },
  { id: 'video.Kling', name: 'Kling', category: 'video', protocols: ['Kling'], model: '', endpoint: '' },
  { id: 'video.Seedance', name: 'Seedance 网关', category: 'video', protocols: ['Seedance'], model: 'Cdance2.0-A', endpoint: '' },
] as const;

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
  auth_header: 'Authorization' | 'X-Gateway-Authorization' | 'api-key' | 'x-api-key' | 'xi-api-key';
  auth_scheme: 'Bearer' | 'raw' | 'Basic';
  timeout_ms: number;
  voice: string;
  test_endpoint: string;
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
  const definition = MODEL_SLOTS.find(item => item.id === slot);
  if (!definition) throw new Error('不支持的模型配置项');
  return {
    name: definition.name, protocol: definition.protocols[0], endpoint: definition.endpoint,
    query_endpoint: ['video', 'avatar'].includes(definition.category) ? definition.endpoint : '',
    model: definition.model, auth_header: slot === 'avatar.lipsync' ? 'x-api-key' : slot === 'audio.voice_clone' ? 'xi-api-key' : 'Authorization',
    auth_scheme: slot === 'avatar.photo' ? 'Basic' : ['avatar.lipsync', 'audio.voice_clone'].includes(slot) ? 'raw' : 'Bearer',
    timeout_ms: ['video', 'avatar'].includes(definition.category) ? 30_000 : 90_000, voice: '', test_endpoint: '',
  };
}
