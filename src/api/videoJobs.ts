import { storedMedia } from './media';
import { canonicalMedia } from '@/lib/privateMedia';
import { authenticatedEdgeRequest, EdgeRequestError } from '@/lib/edgeRequest';
import { requireAccountSession, uploadAccountObject } from './accountSession';

export interface ServerVideoJob {
  id: string;
  project_id: string;
  provider: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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
async function invoke(body: Record<string, unknown>, userId?: string, signal?: AbortSignal) {
  try {
    const session = await requireAccountSession(userId);
    signal?.throwIfAborted();
    const response = await authenticatedEdgeRequest('video-jobs', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }, '', session.user.id);
    const data = await response.json();
    await requireAccountSession(session.user.id);
    if (data?.error) throw new VideoJobError(data.error, 400);
    return data;
  } catch (cause) {
    if (cause instanceof VideoJobError) throw cause;
    throw new VideoJobError(cause instanceof Error ? cause.message : '任务服务暂时不可用',
      cause instanceof EdgeRequestError ? cause.status : 0);
  }
}
export async function createServerVideoJob(provider: string, requestKey: string, input: VideoJobInput, userId?: string, signal?: AbortSignal): Promise<ServerVideoJob> {
  const data = await invoke({ action: 'create', provider, request_key: requestKey, input }, userId, signal);
  window.dispatchEvent(new CustomEvent('credits_changed'));
  return data.job;
}
export async function queryServerVideoJob(reference: { job_id: string } | { request_key: string }, userId?: string, signal?: AbortSignal): Promise<ServerVideoJob> {
  return (await invoke({ action: 'query', ...reference }, userId, signal)).job;
}
export async function listServerVideoJobs(userId?: string, signal?: AbortSignal): Promise<ServerVideoJob[]> {
  return (await invoke({ action: 'list' }, userId, signal)).jobs;
}

// 表单导入的 data URL / 本地站内素材先入 Storage，模型只接收 HTTPS 链接。
export async function uploadVideoReference(value: string | null, userId: string): Promise<string | undefined> {
  if (!value) return undefined;
  await requireAccountSession(userId);
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
  await uploadAccountObject(userId, 'materials', path, blob);
  return storedMedia('materials', path);
}
