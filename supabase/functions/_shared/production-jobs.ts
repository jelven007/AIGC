import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { generateImage } from './image-provider.ts';
import { signMediaTree } from './private-media.ts';
import { validateMediaTree } from './private-media.ts';
import { resolveModel } from './model-registry.ts';

export interface ProductionJob {
  id: string; user_id: string; request_key: string; kind: string; project_id: string | null;
  model_config_version_id: string | null; payload: Record<string, any>; phase: string; status: string;
  lease_token: string; evidence: any; result: any; progress: number; error_message: string | null;
  resolution?: { event: 'completed' | 'failed'; data: any };
  source_erased_at?: string | null;
  credit_cost: number; created_at: string;
}
export async function publicProductionJob(db: SupabaseClient, job: ProductionJob) {
  const result = await signMediaTree(db, { id: job.id, request_key: job.request_key, kind: job.kind, project_id: job.project_id,
    ...(job.kind === 'analysis' ? { mode: job.payload.mode } : {}),
    ...(job.kind.startsWith('intelligence_') ? { target_id: job.payload.request.target_id } : {}),
    ...(job.kind === 'product_translate' ? { product_id: job.payload.request.product_id } : {}),
    status: job.status, phase: job.phase, progress: job.progress, result: job.result,
    error_message: job.error_message, credit_cost: job.credit_cost, created_at: job.created_at }, job.user_id);
  // 原请求保留稳定引用；已清理源素材的终态回执仍可读取，不为历史输入续签。
  return job.kind === 'edit_analysis' ? { ...result, edit_mode: job.payload.mode,
    edit_source: job.payload.source, edit_request: job.payload } : result;
}
export async function jobEvent(db: SupabaseClient, job: ProductionJob, event: string, data: unknown = {}) {
  if (['completed', 'failed'].includes(event)) {
    const checkpoint = await db.rpc('update_production_job', { p_job_id: job.id, p_lease: job.lease_token,
      p_event: 'resolution', p_data: { event, data } });
    if (checkpoint.error) throw new Error('任务结案证据保存失败');
  }
  const result = await db.rpc('update_production_job', { p_job_id: job.id, p_lease: job.lease_token, p_event: event, p_data: data });
  if (result.error) throw new Error('任务状态保存失败');
  return result.data;
}
export async function createImageJob(db: SupabaseClient, userId: string, requestKey: string, input: unknown, projectId?: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) throw new Error('请提供有效的 request_key 幂等标识');
  const payload = await validateMediaTree(db, input, userId);
  if (typeof payload?.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > 8000
    || !['1024x1024', '1024x1536', '1536x1024'].includes(payload.size || '1024x1024')
    || !['auto', 'low', 'medium', 'high'].includes(payload.quality || 'auto')) throw new Error('图片参数非法');
  const prior = await db.from('production_jobs').select('id').eq('user_id', userId).eq('request_key', requestKey).maybeSingle();
  if (prior.error) throw new Error('图片任务核对失败');
  const config = prior.data ? null : await resolveModel('image.primary', db);
  if (payload.reference_image && config && config.settings.protocol !== 'chat-image') throw new Error('当前模型不支持参考图');
  const { data, error } = await db.rpc('create_production_job', {
    p_user_id: userId, p_request_key: requestKey, p_kind: 'image', p_payload: payload,
    p_project_id: projectId || null, p_version: config?.version_id || null,
  });
  if (error) throw new Error('图片任务创建失败');
  return publicProductionJob(db, data as ProductionJob);
}
export async function processImageJob(db: SupabaseClient, id?: string): Promise<boolean> {
  const { data, error } = await db.rpc('claim_production_job', { p_kind: 'image', p_job_id: id || null });
  if (error) throw new Error('图片任务领取失败');
  if (!data) return false;
  const job = data as ProductionJob;
  let checkpointed = !!job.evidence;
  let executed = false;
  let leaseFailed = false;
  const heartbeat = setInterval(() => {
    void jobEvent(db, job, 'heartbeat').catch(() => { leaseFailed = true; });
  }, 30000);
  try {
    if (job.resolution) {
      await jobEvent(db, job, job.resolution.event, job.resolution.data);
      return true;
    }
    const result = await generateImage(db, job.user_id, job.payload, {
      version: job.model_config_version_id!, jobId: job.id, evidence: job.evidence,
      executing: async () => {
        if (leaseFailed) throw new Error('图片任务租约已失效');
        await jobEvent(db, job, 'executing'); executed = true;
      },
      checkpoint: async evidence => {
        await jobEvent(db, job, 'checkpoint', evidence);
        checkpointed = true;
      },
    });
    await jobEvent(db, job, 'completed', { url: result.image_url, size: result.size });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '图片任务失败';
    if (/模型返回 HTTP (400|401|402|403|404|405|413|415|422|429)\b/.test(message)) {
      await jobEvent(db, job, 'failed', { error: message });
    } else if (checkpointed || !executed) {
      await jobEvent(db, job, 'retry', { error: message });
    } else {
      await jobEvent(db, job, 'unknown', { error: '模型受理结果未知，请核对供应商账单，避免重复生成' });
    }
  } finally { clearInterval(heartbeat); }
  return true;
}
