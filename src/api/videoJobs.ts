import { supabase } from '@/db/supabase';
import { storedMedia } from './media';
import { canonicalMedia } from '@/lib/privateMedia';

export interface ServerVideoJob {
  id: string;
  project_id: string;
  provider: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  submission_state: 'queued' | 'submitting' | 'submitted' | 'unknown';
  billing_state: 'reserved' | 'settled' | 'refunded';
  credit_cost: number;
  progress: number;
  video_url: string | null;
  error_message: string | null;
  needs_attention: boolean;
  created_at: string;
}
export interface VideoJobInput {
  prompt: string;
  title: string;
  duration: number;
  resolution: string;
  ratio: string;
  first_frame?: string;
  last_frame?: string;
  reference_images?: string[];
  reference_videos?: string[];
}
export class VideoJobError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('video-jobs', { body });
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null;
    const payload = await response?.json().catch(() => null);
    throw new VideoJobError(payload?.error || error.message || '任务服务暂时不可用', response?.status || 0);
  }
  if (data?.error) throw new VideoJobError(data.error, 400);
  return data;
}
export async function createServerVideoJob(provider: string, requestKey: string, input: VideoJobInput): Promise<ServerVideoJob> {
  const data = await invoke({ action: 'create', provider, request_key: requestKey, input });
  window.dispatchEvent(new CustomEvent('credits_changed'));
  return data.job;
}
export async function queryServerVideoJob(reference: { job_id: string } | { request_key: string }): Promise<ServerVideoJob> {
  return (await invoke({ action: 'query', ...reference })).job;
}
export async function listServerVideoJobs(): Promise<ServerVideoJob[]> {
  return (await invoke({ action: 'list' })).jobs;
}

// 表单导入的 data URL / 本地站内素材先入 Storage，模型只接收 HTTPS 链接。
export async function uploadVideoReference(value: string | null, userId: string): Promise<string | undefined> {
  if (!value) return undefined;
  if (value.startsWith('https://')) return canonicalMedia(value);
  if (!value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('/')) {
    throw new Error('参考素材地址不支持');
  }
  const response = await fetch(value);
  if (!response.ok) throw new Error('参考素材读取失败');
  const blob = await response.blob();
  if (!/^(image|video)\//.test(blob.type) || blob.size > 30 * 1024 * 1024) {
    throw new Error('参考素材须为图片或视频，且不超过 30MB');
  }
  const extension = blob.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  // Storage RLS 要求路径第一段为 auth.uid()。
  const path = `${userId}/video-inputs/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('materials').upload(path, blob, { contentType: blob.type });
  if (error) throw new Error('参考素材上传失败，请重试');
  return storedMedia('materials', path);
}
