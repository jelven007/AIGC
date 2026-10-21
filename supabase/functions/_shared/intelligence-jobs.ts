import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveModel } from './model-registry.ts';
import { collectIntelligence, IntelligenceError } from './intelligence-provider.ts';
import { jobEvent, publicProductionJob, type ProductionJob } from './production-jobs.ts';
import { readIntelligenceImage } from './intelligence-image.ts';
export const intelligenceUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export async function createIntelligenceJob(db: SupabaseClient, uid: string, key: unknown, target: unknown, cost: unknown) {
  if (!intelligenceUuid(key) || !intelligenceUuid(target) || !Number.isInteger(cost) || Number(cost)<0) throw new IntelligenceError('采集标识与价格参数非法');
  const prior = await db.from('production_jobs').select('id').eq('user_id', uid).eq('request_key', key).maybeSingle();
  if (prior.error) throw new Error('采集原请求核对失败');
  let version: string | null = null;
  if (!prior.data) {
    const read = await db.from('intelligence_targets').select('source_slot').eq('id', target).eq('user_id', uid).maybeSingle();
    if (read.error) throw new Error('采集对象查询失败');
    if (!read.data) throw new IntelligenceError('采集对象不存在或无权访问');
    version = (await resolveModel(read.data.source_slot, db)).version_id;
  }
  const result = await db.rpc('create_intelligence_job', { p_user: uid, p_key: key, p_target: target, p_cost: cost, p_version: version });
  if (result.error) throw new Error(result.error.message);
  return publicProductionJob(db, result.data as ProductionJob);
}
export async function processIntelligenceJob(db: SupabaseClient, kind: string): Promise<boolean> {
  const claim = await db.rpc('claim_production_job', { p_kind: kind, p_job_id: null });
  if (claim.error) throw new Error('采集任务领取失败');
  if (!claim.data) return false;
  const job = claim.data as ProductionJob & { attempts: number };
  let saved = !!job.evidence, lost = false;
  const timer = setInterval(() => { void jobEvent(db, job, 'heartbeat').catch(() => { lost = true; }); }, 30000);
  try {
    if (job.resolution) { await jobEvent(db, job, job.resolution.event, job.resolution.data); return true; }
    if (!saved && job.attempts>3) {
      await jobEvent(db, job, 'failed', { error: '采集Worker多次中断，已达到三次读取上限' }); return true;
    }
    if (!saved) {
      const config = await resolveModel(job.payload.source_slot, db, job.model_config_version_id!);
      if (lost) throw new Error('采集租约已失效');
      const image = job.payload.params.search_mode === 'image' ? await readIntelligenceImage(db,
        job.payload.params.image_url, job.user_id, job.payload.params.image_hash) : null;
      // 图片搜索POST同样只读取商品；有限重试不会创建订单或发布作品。
      const data = await collectIntelligence(config, job.kind, job.payload.params, image?.bytes);
      if (lost) throw new Error('采集租约已失效');
      await jobEvent(db, job, 'checkpoint', data); saved = true; job.evidence = data;
    }
    await jobEvent(db, job, 'completed', job.evidence);
  } catch (cause) {
    if (cause instanceof IntelligenceError && !saved) await jobEvent(db, job, 'failed', { error: cause.message });
    else await jobEvent(db, job, 'retry', { error: '采集或保存暂时失败，后台按原请求恢复' });
  } finally { clearInterval(timer); }
  return true;
}
