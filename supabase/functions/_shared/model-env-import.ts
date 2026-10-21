import { defaultSettings, type ModelSettings } from './model-catalog.ts';

// 仅供管理员显式迁移，业务调用禁止读取这些旧配置。
export function legacyModelConfigs(): Array<{ slot: string; settings: ModelSettings; key: string }> {
  const env = (name: string) => Deno.env.get(name) || '';
  const entries: Array<{ slot: string; settings: ModelSettings; key: string }> = [];
  const add = (slot: string, key: string, patch: Partial<ModelSettings>) => {
    if (key) entries.push({ slot, key, settings: { ...defaultSettings(slot), ...patch } });
  };
  const ark = (env('ARK_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  if (env('ARK_API_KEY')) add('text.primary', env('ARK_API_KEY'), { endpoint: `${ark}/chat/completions`, model: env('ARK_TEXT_MODEL') });
  else if (env('GLM_API_KEY')) add('text.primary', env('GLM_API_KEY'), {
    endpoint: `${(env('GLM_BASE_URL') || 'https://www.sophnet.com/api/open-apis').replace(/\/+$/, '')}/v1/chat/completions`,
    model: env('GLM_MODEL') || 'glm-5.3-flash',
  });
  else add('text.primary', env('DEEPSEEK_API_KEY'), {
    endpoint: `${(env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`,
    model: env('DEEPSEEK_MODEL') || 'deepseek-chat',
  });
  add('text.fallback', env('DEEPSEEK_API_KEY'), {
    endpoint: `${(env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`,
    model: env('DEEPSEEK_MODEL') || 'deepseek-chat',
  });
  add('video.ArkSeedance', env('ARK_API_KEY'), {
    endpoint: `${ark}/contents/generations/tasks`, query_endpoint: `${ark}/contents/generations/tasks`, model: env('ARK_VIDEO_MODEL'),
  });
  const definitions = [
    ['MiniMax', 'OPENAI_NEXT', 'https://api.openai-next.com', '/v1/videos'],
    ['SeedanceMini', 'SEEDANCE_MINI', 'https://tokendance.space', '/gateway/ark/v3/generations/tasks'],
    ['Wan3', 'WAN3', 'https://tokendance.space', '/gateway/alibaba/wan3/v1/video-synthesis'],
    ['HappyHorse', 'HAPPYHORSE', 'https://tokendance.space', '/gateway/alibaba/happyhorse/v1/video-synthesis'],
    ['Seedance', 'CDANCE', 'https://ai.dxkp.com/v1', '/video/generations'],
    ['Kling', 'KLING', '', ''],
  ];
  for (const [provider, prefix, baseDefault, path] of definitions) {
    const base = (env(`${prefix}_BASE_URL`) || baseDefault).replace(/\/+$/, '');
    const endpoint = provider === 'Kling' ? env('KLING_CREATE_URL') : base + path;
    const query = provider === 'Wan3' ? `${base}/gateway/alibaba/wan3/v1/tasks`
      : provider === 'HappyHorse' ? `${base}/gateway/alibaba/happyhorse/v1/tasks`
      : provider === 'Kling' ? env('KLING_QUERY_URL') : endpoint;
    add(`video.${provider}`, env(`${prefix}_API_KEY`) || env(provider === 'Kling' ? 'INTEGRATIONS_API_KEY'
      : provider === 'Seedance' ? 'VECTRUST_API_KEY' : provider === 'MiniMax' ? 'MINIMAX_API_KEY' : 'TOKENDANCE_API_KEY'),
    { endpoint, query_endpoint: query, ...(provider === 'Kling' ? { auth_header: 'X-Gateway-Authorization' } : {}) });
  }
  const sf = (env('SILICONFLOW_BASE_URL') || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  add('audio.tts', env('SILICONFLOW_API_KEY') || env('STEP_API_KEY'), env('SILICONFLOW_API_KEY')
    ? { endpoint: `${sf}/audio/speech`, model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'fnlp/MOSS-TTSD-v0.5:alex' }
    : { protocol: 'step-tts', endpoint: 'https://api.stepfun.com/step_plan/v1/audio/speech', model: 'stepaudio-2.5-tts', voice: 'cixingnansheng' });
  add('audio.asr', env('SILICONFLOW_API_KEY') || env('STEP_API_KEY'), env('SILICONFLOW_API_KEY')
    ? { endpoint: `${sf}/audio/transcriptions`, model: 'TeleAI/TeleSpeechASR' }
    : { protocol: 'step-asr', endpoint: 'https://api.stepfun.com/step_plan/v1/audio/asr/sse', model: 'stepaudio-2.5-asr' });
  add('reader.primary', env('URL_READER_API_KEY'), { endpoint: env('URL_READER_BASE_URL') || 'https://r.jina.ai/' });
  // 原异步图片网关不能当作 OpenAI Images 协议自动导入。
  add('image.primary', env('IMAGE_API_KEY'), { endpoint: env('IMAGE_API_URL'), model: env('IMAGE_MODEL') });
  return entries;
}
