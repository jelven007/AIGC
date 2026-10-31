import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  providerConfig, queryVideo, submitVideo, SubmissionError,
  type VideoInput, type VideoProvider,
} from './video-providers.ts';
import { mediaFetch, validateMediaEndpoint } from './media-endpoint.ts';
import { mediaReference, signMediaTree } from './private-media.ts';

export interface VideoJob {
  id: string;
  user_id: string;
  project_id: string;
  provider: VideoProvider;
  model_config_version_id: string;
  payload: VideoInput;
  status: string;
  submission_state: string;
  billing_state: string;
  credit_cost: number;
  charge_id: string;
  provider_task_id: string | null;
  resolution_event: { event: string; video_url?: string; error?: string } | null;
  lease_token: string;
  progress: number;
  result: { video_url?: string } | null;
  error_message: string | null;
  needs_attention: boolean;
  created_at: string;
}
export function publicVideoJob(job: VideoJob) {
  return {
    id: job.id, project_id: job.project_id, provider: job.provider, status: job.status,
    submission_state: job.submission_state, billing_state: job.billing_state,
    credit_cost: job.credit_cost, progress: job.progress, video_url: job.result?.video_url || null,
    error_message: job.error_message, needs_attention: job.needs_attention, created_at: job.created_at,
  };
}

async function persistVideo(db: SupabaseClient, job: VideoJob, source: string | Response): Promise<string> {
  // 下载地址可带供应商签名，校验时仅去掉查询部分。
  if (typeof source === 'string') {
    const target = new URL(source);
    target.search = '';
    await validateMediaEndpoint(target.href);
  }
  const response = typeof source === 'string'
    ? await mediaFetch(source, { signal: AbortSignal.timeout(35_000), redirect: 'error' }) : source;
  if (!response.ok || !response.body) throw new Error('成片下载暂时失败');
  const mime = response.headers.get('content-type')?.split(';')[0] || '';
  if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(mime)) throw new Error('上游成片格式不支持');
  const maxBytes = 100 * 1024 * 1024;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('成片超过 100MB，需要人工转存');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!total) throw new Error('上游成片为空');
  const extension = mime === 'video/webm' ? 'webm' : 'mp4';
  // 固定本地任务路径，重复查询/转存不会新增副本。
  const path = `generated-videos/${job.user_id}/${job.id}.${extension}`;
  const { error } = await db.storage.from('materials').upload(path, new Blob(chunks, {
    type: extension === 'webm' ? 'video/webm' : 'video/mp4',
  }), { contentType: extension === 'webm' ? 'video/webm' : 'video/mp4', upsert: true });
  if (error) throw new Error('成片转存暂时失败');
  return mediaReference(Deno.env.get('SUPABASE_URL') || '', 'materials', path);
}

export async function processVideoJob(db: SupabaseClient, id?: string): Promise<boolean> {
  const { data, error } = await db.rpc('claim_video_job', { p_job_id: id || null });
  if (error) throw new Error('任务队列领取失败');
  if (!data) return false;
  const job = data as VideoJob;
  const record = async (event: string, values: Record<string, unknown> = {}) => {
    const result = await db.rpc('record_video_job_event', {
      p_job_id: job.id, p_lease_token: job.lease_token, p_event: event, ...values,
    });
    if (result.error) throw new Error(`任务${job.id}状态写入失败`);
  };
  const finish = async (event: string, values: { p_video_url?: string; p_error?: string } = {}) => {
    const evidence = await db.rpc('checkpoint_video_job_result', {
      p_job_id: job.id, p_lease_token: job.lease_token, p_event: event, ...values,
    });
    if (evidence.error) throw new Error(`任务${job.id}结果证据写入失败`);
    await record(event, values);
  };
  if (job.resolution_event) {
    await record(job.resolution_event.event, {
      p_video_url: job.resolution_event.video_url || null,
      p_error: job.resolution_event.error || null,
    });
    return true;
  }
  if (job.submission_state === 'submitting') {
    let config;
    try {
      if (!job.model_config_version_id) throw new Error('旧任务配置尚未核对');
      config = await providerConfig(job.provider, db, job.model_config_version_id);
    } catch {
      // 领取之后尚未发出 POST，配置错误可以确认未受理。
      await finish('submit_rejected', { p_error: '模型服务配置不可用，尚未向上游提交' });
      return true;
    }
    let taskId: string;
    try {
      taskId = await submitVideo(config, await signMediaTree(db, job.payload, job.user_id, 3600));
    } catch (cause) {
      const details = { p_error: cause instanceof Error ? cause.message : '上游受理结果未知' };
      if (cause instanceof SubmissionError && cause.confirmedRejected) await finish('submit_rejected', details);
      else await record('submit_unknown', details);
      return true;
    }
    // 上游已受理后 DB 写入失败只能恢复/核对，不能退积分或重发 POST。
    await record('accepted', { p_task_id: taskId });
    return true;
  }
  let outcome;
  let videoUrl: string | undefined;
  try {
    if (!job.provider_task_id) throw new Error('任务缺少上游标识');
    if (!job.model_config_version_id) throw new Error('旧任务配置尚未核对');
    outcome = await queryVideo(await providerConfig(job.provider, db, job.model_config_version_id), job.provider_task_id);
    if (outcome.state === 'completed') {
      videoUrl = await persistVideo(db, job, outcome.binary || outcome.url!);
    }
  } catch (cause) {
    // GET 错误、成功但转存失败：保留扣费和任务，后续安全重试。
    await record('query_error', { p_error: cause instanceof Error ? cause.message : '上游查询暂时失败' });
    return true;
  }
  const values = {
    ...(videoUrl ? { p_video_url: videoUrl } : {}),
    ...(outcome.error ? { p_error: outcome.error } : {}),
    ...(outcome.progress !== undefined ? { p_progress: Math.floor(outcome.progress) } : {}),
  };
  if (outcome.state === 'pending') await record('pending', values);
  else await finish(outcome.state, values);
  return true;
}
