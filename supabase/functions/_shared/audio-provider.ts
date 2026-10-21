import { modelFetch, validateEndpoint, type ResolvedModel } from './model-registry.ts';

export async function responseBytes(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('接口返回空内容');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > max) throw new Error('接口返回内容超过限制');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!total) throw new Error('接口返回空内容');
  return bytes;
}
export function encodeAudio(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function safeMediaDownload(value: string, max: number): Promise<{ bytes: Uint8Array; type: string }> {
  const url = new URL(value), unsigned = new URL(url); unsigned.search = '';
  await validateEndpoint(unsigned.href);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) }).catch(() => null);
  if (!response?.ok) throw new Error('媒体下载失败');
  return { bytes: await responseBytes(response, max), type: response.headers.get('content-type')?.split(';')[0] || '' };
}
export async function jsonModelResponse(response: Response): Promise<any> {
  return JSON.parse(new TextDecoder().decode(await responseBytes(response, 1_000_000)));
}
export async function ttsModel(config: ResolvedModel, input: Record<string, any>, voiceId?: string): Promise<{ bytes: Uint8Array; type: string }> {
  const format = input.response_format || 'mp3';
  const eleven = config.settings.protocol === 'elevenlabs-ivc';
  if (eleven && format !== 'mp3') throw new Error('克隆声纹配音当前仅支持MP3');
  let selected = config;
  if (eleven) {
    if (!voiceId || !/^[\w-]{1,200}$/.test(voiceId)) throw new Error('声纹标识不正确');
    selected = { ...config, settings: { ...config.settings,
      endpoint: `${config.settings.endpoint.replace(/\/$/, '')}/text-to-speech/${encodeURIComponent(voiceId)}` } };
  }
  const response = await modelFetch(selected, JSON.stringify(eleven
    ? { text: input.input, model_id: config.settings.model, voice_settings: { speed: input.speed || 1 } }
    : { model: config.settings.model, input: input.input, voice: input.voice || config.settings.voice,
      response_format: format, stream: false,
      ...(config.settings.protocol === 'step-tts' ? { instruction: input.instruction || '' } : { speed: input.speed || 1 }) }));
  const bytes = await responseBytes(response, 5 * 1024 * 1024);
  const head = new TextDecoder().decode(bytes.subarray(0, 4));
  const valid = format === 'wav' ? head === 'RIFF'
    : format === 'opus' ? head === 'OggS' : head.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (!valid) throw new Error('模型返回的内容不是所选音频格式');
  return { bytes, type: format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg' };
}
export async function asrModel(config: ResolvedModel, file: File, language?: string): Promise<{ text: string; segments?: unknown[] }> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('音频文件应为1字节–20MB');
  if (config.settings.protocol === 'openai-asr') {
    const form = new FormData(); form.append('file', file); form.append('model', config.settings.model);
    if (language) form.append('language', language);
    if (config.settings.model === 'whisper-1') form.append('response_format', 'verbose_json');
    const data = await jsonModelResponse(await modelFetch(config, form, false));
    if (typeof data?.text !== 'string' || !data.text.trim() || data.text.length > 100000) throw new Error('语音识别未返回有效正文');
    const segments = Array.isArray(data.segments) ? data.segments.filter((item: any) =>
      Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start && typeof item.text === 'string')
      .slice(0, 2000).map((item: any) => ({ start: item.start, end: item.end, text: item.text })) : undefined;
    return { text: data.text, ...(segments ? { segments } : {}) };
  }
  const type = file.name.toLowerCase().endsWith('.wav') ? 'wav' : file.name.toLowerCase().endsWith('.mp3') ? 'mp3' : null;
  if (!type) throw new Error('Step ASR 当前仅接受 WAV/MP3 文件');
  const response = await modelFetch(config, JSON.stringify({ audio: {
    data: encodeAudio(new Uint8Array(await file.arrayBuffer())),
    input: { transcription: { model: config.settings.model, language: language || 'zh', enable_itn: true }, format: { type } },
  } }));
  const raw = new TextDecoder().decode(await responseBytes(response, 1_000_000));
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5).trim(); if (!value || value === '[DONE]') continue;
    const data = JSON.parse(value);
    text += data.choices?.[0]?.delta?.content || data.text || '';
  }
  if (!text.trim() || text.length > 100000) throw new Error('语音识别未返回有效正文');
  return { text };
}
