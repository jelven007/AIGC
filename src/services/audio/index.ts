import { storedMedia } from '@/api/media';
import { requireAccountSession, uploadAccountObject } from '@/api/accountSession';
import { createProductionJob, queryProductionJob, productionRequest, ProductionJobError, type ProductionJob } from '@/api/productionJobs';

export interface TranscriptionOptions {
  file: Blob | File;
  model?: string;
  signal?: AbortSignal;
  language?: string;
  expectedUserId?: string;
}
export interface SpeechOptions {
  input: string;
  voice?: string;
  model?: string;
  response_format?: 'mp3' | 'wav' | 'opus';
  stream?: boolean;
  speed?: number;
  instruction?: string;
  signal?: AbortSignal;
}
export function base64ToBlob(data: string, contentType = 'audio/wav'): Blob {
  const bytes = atob(data.replace(/^data:[^,]+,/, ''));
  return new Blob([Uint8Array.from(bytes, character => character.charCodeAt(0))], { type: contentType });
}
const receiptKey = (userId: string) => `shopro:media-receipt:${userId}`;
async function audioJob(kind: string, input: Record<string, unknown>, userId: string): Promise<ProductionJob> {
  await requireAccountSession(userId);
  const key = receiptKey(userId);
  const prices = await productionRequest({ action: 'media-prices' }, userId);
  await requireAccountSession(userId);
  const previous = localStorage.getItem(key);
  if (previous) throw new Error('上次媒体提交结果尚未确认，请在数字人工作台恢复原任务');
  input = { ...input, confirmed_credit_cost: prices.costs[kind] };
  const receipt = { kind, request_key: crypto.randomUUID(), input };
  localStorage.setItem(key, JSON.stringify(receipt));
  try {
    const job = await createProductionJob(kind, receipt.request_key, input, undefined, userId);
    await requireAccountSession(userId);
    localStorage.removeItem(key); return job;
  } catch (cause) {
    if (cause instanceof ProductionJobError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) localStorage.removeItem(key);
    throw cause;
  }
}
async function awaitAudioJob(job: ProductionJob, userId: string, signal?: AbortSignal): Promise<ProductionJob> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await requireAccountSession(userId);
    if (signal?.aborted) throw new DOMException('已停止等待，后台任务继续保留', 'AbortError');
    if (job.status === 'completed') return job;
    if (['failed', 'unknown', 'cancelled'].includes(job.status)) throw new Error(job.error_message || '任务需要核对');
    await new Promise(resolve => setTimeout(resolve, 2000));
    job = await queryProductionJob(job.id, userId);
  }
  throw new Error('任务仍在后台处理，请到语音工作台查看结果');
}
export async function transcribeAudio(options: TranscriptionOptions): Promise<{ text: string }> {
  const session = await requireAccountSession(options.expectedUserId);
  const userId = session.user.id;
  options.signal?.throwIfAborted();
  if (localStorage.getItem(receiptKey(userId))) throw new Error('请先到语音工作台恢复上次媒体提交');
  if (!options.file.size || options.file.size > 20 * 1024 * 1024) throw new Error('请上传不超过20MB的音频');
  const filename = options.file instanceof File ? options.file.name : options.file.type === 'audio/webm' ? 'audio.webm' : 'audio.wav';
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || !/^(wav|mp3|m4a|ogg|webm|flac|mp4)$/.test(ext)) throw new Error('音频格式不支持');
  const path = `${userId}/media-inputs/${crypto.randomUUID()}.${ext}`;
  await uploadAccountObject(userId, 'materials', path, options.file);
  options.signal?.throwIfAborted();
  const job = await awaitAudioJob(await audioJob('asr', { audio_url: storedMedia('materials', path), filename, language: options.language }, userId), userId, options.signal);
  if (!job.result?.text) throw new Error('语音服务未返回识别结果');
  return { text: job.result.text };
}
export async function synthesizeSpeech(options: SpeechOptions): Promise<{ audioUrl: string; blob: Blob }> {
  const userId = (await requireAccountSession()).user.id;
  options.signal?.throwIfAborted();
  const job = await awaitAudioJob(await audioJob('tts', { input: options.input, voice: options.voice,
    speed: options.speed || 1, instruction: options.instruction || '', response_format: options.response_format || 'mp3' }, userId), userId, options.signal);
  if (!job.result?.url) throw new Error('配音任务未返回成片');
  const response = await fetch(job.result.url, { signal: options.signal });
  if (!response.ok) throw new Error('配音下载失败，可在任务中心刷新签名重试');
  const blob = await response.blob();
  await requireAccountSession(userId);
  return { audioUrl: job.result.url, blob };
}
