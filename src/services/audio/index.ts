import { supabase } from '@/db/supabase';
import { storedMedia } from '@/api/media';
import { createProductionJob, queryProductionJob, productionRequest, ProductionJobError, type ProductionJob } from '@/api/productionJobs';

export interface TranscriptionOptions {
  file: Blob | File;
  model?: string;
  signal?: AbortSignal;
  language?: string;
}
export interface SpeechOptions {
  input: string;
  voice?: string;
  model?: string;
  response_format?: 'mp3' | 'wav' | 'opus';
  stream?: boolean;
  speed?: number;
  instruction?: string;
}
export function base64ToBlob(data: string, contentType = 'audio/wav'): Blob {
  const bytes = atob(data.replace(/^data:[^,]+,/, ''));
  return new Blob([Uint8Array.from(bytes, character => character.charCodeAt(0))], { type: contentType });
}
async function receiptKey(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('请先登录');
  return `shopro:media-receipt:${data.session.user.id}`;
}
async function audioJob(kind: string, input: Record<string, unknown>): Promise<ProductionJob> {
  const key = await receiptKey();
  const prices = await productionRequest({ action: 'media-prices' });
  const previous = localStorage.getItem(key);
  if (previous) throw new Error('上次媒体提交结果尚未确认，请在数字人工作台恢复原任务');
  input = { ...input, confirmed_credit_cost: prices.costs[kind] };
  const receipt = { kind, request_key: crypto.randomUUID(), input };
  localStorage.setItem(key, JSON.stringify(receipt));
  try {
    const job = await createProductionJob(kind, receipt.request_key, input);
    localStorage.removeItem(key); return job;
  } catch (cause) {
    if (cause instanceof ProductionJobError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) localStorage.removeItem(key);
    throw cause;
  }
}
async function awaitAudioJob(job: ProductionJob, signal?: AbortSignal): Promise<ProductionJob> {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (signal?.aborted) throw new DOMException('已停止等待，后台任务继续保留', 'AbortError');
    if (job.status === 'completed') return job;
    if (['failed', 'unknown', 'cancelled'].includes(job.status)) throw new Error(job.error_message || '任务需要核对');
    await new Promise(resolve => setTimeout(resolve, 2000));
    job = await queryProductionJob(job.id);
  }
  throw new Error('任务仍在后台处理，请到语音工作台查看结果');
}
export async function transcribeAudio(options: TranscriptionOptions): Promise<{ text: string }> {
  if (localStorage.getItem(await receiptKey())) throw new Error('请先到语音工作台恢复上次媒体提交');
  const { data } = await supabase.auth.getSession();
  if (!data.session || !options.file.size || options.file.size > 20 * 1024 * 1024) throw new Error('请上传不超过20MB的音频');
  const filename = options.file instanceof File ? options.file.name : options.file.type === 'audio/webm' ? 'audio.webm' : 'audio.wav';
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || !/^(wav|mp3|m4a|ogg|webm|flac|mp4)$/.test(ext)) throw new Error('音频格式不支持');
  const path = `${data.session.user.id}/media-inputs/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from('materials').upload(path, options.file, { contentType: options.file.type || 'audio/wav' });
  if (upload.error) throw new Error('音频上传失败');
  const job = await awaitAudioJob(await audioJob('asr', { audio_url: storedMedia('materials', path), filename, language: options.language }), options.signal);
  if (!job.result?.text) throw new Error('语音服务未返回识别结果');
  return { text: job.result.text };
}
export async function synthesizeSpeech(options: SpeechOptions): Promise<{ audioUrl: string; blob: Blob }> {
  const job = await awaitAudioJob(await audioJob('tts', { input: options.input, voice: options.voice,
    speed: options.speed || 1, instruction: options.instruction || '', response_format: options.response_format || 'mp3' }));
  if (!job.result?.url) throw new Error('配音任务未返回成片');
  const response = await fetch(job.result.url);
  if (!response.ok) throw new Error('配音下载失败，可在任务中心刷新签名重试');
  const blob = await response.blob();
  return { audioUrl: job.result.url, blob };
}
