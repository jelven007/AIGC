import { createServiceClient } from '../_shared/auth.ts';
import { processImageJob, jobEvent, type ProductionJob } from '../_shared/production-jobs.ts';
import { mediaReference, signMediaTree } from '../_shared/private-media.ts';
import { processPublishJob, collectPlatformMetrics } from '../_shared/platform-jobs.ts';
import { processVideoJob } from '../_shared/video-jobs.ts';
import { processMediaDeletions } from '../_shared/media-cleanup.ts';
import { processMediaJob, MEDIA_JOB_SLOTS } from '../_shared/media-jobs.ts';
import { processAnalysisJob } from '../_shared/video-analysis.ts';
import { KNOWLEDGE_KINDS, processKnowledgeJob } from '../_shared/knowledge.ts';
import { INTELLIGENCE_KINDS } from '../_shared/intelligence-provider.ts';
import { processIntelligenceJob } from '../_shared/intelligence-jobs.ts';

export async function handleProductionWorker(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const token = req.headers.get('authorization');
  const render = !!Deno.env.get('RENDER_WORKER_SECRET') && token === `Bearer ${Deno.env.get('RENDER_WORKER_SECRET')}`;
  const general = !!Deno.env.get('VIDEO_WORKER_SECRET') && token === `Bearer ${Deno.env.get('VIDEO_WORKER_SECRET')}`;
  if (!render && !general) return new Response('Unauthorized', { status: 401 });
  try {
    const db = createServiceClient();
    const body = await req.json();
    if (body.action === 'probe') {
      const { error } = await db.from('production_jobs').select('id,kind,lease_token,evidence').limit(0);
      const voices = await db.from('voice_clones').select('id,model_config_version_id').limit(0);
      const costs = await db.from('credit_costs').select('action,cost').in('action', Object.keys(MEDIA_JOB_SLOTS).map(kind => `generate_${kind}`));
      const analysis = await db.from('credit_costs').select('cost').eq('action', 'generate_analysis').maybeSingle();
      const measurements = await db.from('measurement_sources').select('id,key_digest').limit(0);
      const experiments = await db.from('content_experiments').select('id,planned_sample').limit(0);
      const knowledge = await db.from('knowledge_entries').select('id,content_hash').limit(0);
      const chunks = await db.from('knowledge_chunks').select('entry_id,version_id').limit(0);
      const knowledgeCosts = await db.from('credit_costs').select('cost').in('action', KNOWLEDGE_KINDS.map(kind => `generate_${kind}`));
      const intelligence = await db.from('intelligence_targets').select('id,remaining_budget,schedule_version').limit(0);
      const intelligenceCosts = await db.from('credit_costs').select('cost').in('action', INTELLIGENCE_KINDS.map(kind => `generate_${kind}`));
      const publishGroups = await db.from('publish_groups').select('id,request_key').limit(0);
      const publishTasks = await db.from('publish_tasks').select('id,group_id,connection_id').limit(0);
      const ready = !error && !voices.error && !costs.error && costs.data?.length === Object.keys(MEDIA_JOB_SLOTS).length
        && !analysis.error && !!analysis.data && !measurements.error && !experiments.error && !knowledge.error && !chunks.error
        && !knowledgeCosts.error && knowledgeCosts.data?.length === 2 && knowledgeCosts.data.every(row => Number.isInteger(row.cost) && row.cost >= 0)
        && !intelligence.error && !intelligenceCosts.error && intelligenceCosts.data?.length === 2
        && !publishGroups.error && !publishTasks.error;
      return Response.json({ ready, version: 7, render_version: 2, required_migration: '00045' }, { status: ready ? 200 : 503 });
    }
    if (general && body.action === 'run') {
      const scheduled = await db.rpc('enqueue_intelligence_schedule');
      if (scheduled.error) throw new Error('情报调度未就绪');
      const pruned = await db.rpc('prune_intelligence_data');
      if (pruned.error) throw new Error('情报留存处理失败');
      // 以轮转顺序避免长视频队列使图片或发布饿死。
      const runners = [() => processVideoJob(db), () => processImageJob(db), () => processPublishJob(db), () => processAnalysisJob(db),
        ...KNOWLEDGE_KINDS.map(kind => () => processKnowledgeJob(db, kind)),
        ...INTELLIGENCE_KINDS.map(kind => () => processIntelligenceJob(db, kind)),
        ...Object.keys(MEDIA_JOB_SLOTS).map(kind => () => processMediaJob(db, kind))];
      const offset = Math.floor(Date.now() / 1000) % runners.length;
      let processed = false;
      for (let index = 0; index < runners.length && !processed; index++) processed = await runners[(index + offset) % runners.length]();
      const cleaned = await processMediaDeletions(db);
      return Response.json({ processed: processed ? 1 : 0, cleaned, scheduled: scheduled.data });
    }
    if (general && body.action === 'metrics') return Response.json({ collected: await collectPlatformMetrics(db) });
    if (render && body.action === 'claim') {
      const preparing = body.kind === 'analysis_prepare';
      if (body.kind && !preparing) return Response.json({ error: '领取类型不支持' }, { status: 400 });
      if (!preparing && body.render_version !== 2) {
        return Response.json({ error: '请更新FFmpeg Worker镜像，当前工程要求render_version=2' }, { status: 426 });
      }
      const { data, error } = await db.rpc('claim_production_job', { p_kind: preparing ? 'analysis_prepare' : 'render', p_job_id: null });
      if (error) throw new Error('领取失败');
      if (!data) return Response.json({ job: null });
      const job = data as ProductionJob;
      if (job.resolution) {
        await jobEvent(db, job, job.resolution.event, job.resolution.data);
        return Response.json({ job: null, recovered: true });
      }
      const basePath = `${job.user_id}/${preparing ? 'analysis' : 'renders'}/${job.id}/${job.lease_token}`;
      const outputs = [];
      const outputFiles = preparing ? [['audio.wav', 'audio/wav'], ...Array.from({ length: 8 }, (_, index) => [`frame-${index}.jpg`, 'image/jpeg'])]
        : [['output.mp4', 'video/mp4'], ['thumbnail.jpg', 'image/jpeg']];
      for (const [name, type] of outputFiles) {
        const path = `${basePath}/${name}`;
        const upload = await db.storage.from('materials').createSignedUploadUrl(path);
        if (upload.error || !upload.data) throw new Error('生成上传凭据失败');
        outputs.push({ name, path, url: upload.data.signedUrl, type });
      }
      return Response.json({ job: { id: job.id, kind: job.kind, lease_token: job.lease_token,
        payload: await signMediaTree(db, job.payload, job.user_id, 3600) }, outputs });
    }
    if (render && ['heartbeat', 'completed', 'prepared', 'failed', 'retry'].includes(body.action)) {
      const { data, error } = await db.from('production_jobs').select('*').eq('id', body.job_id).in('kind', ['render', 'analysis']).single();
      if (!error && data?.kind === 'analysis' && data.evidence?.prepare_lease === body.lease_token && body.action === 'prepared') {
        return Response.json({ ok: true });
      }
      if (!error && data?.final_lease_token === body.lease_token && ['completed', 'failed'].includes(data.status)) {
        return Response.json({ ok: true, status: data.status });
      }
      if (error || !data || data.lease_token !== body.lease_token) return Response.json({ error: '租约无效' }, { status: 409 });
      const job = data as ProductionJob;
      const path = `${job.user_id}/renders/${job.id}/${job.lease_token}`;
      let details = body.data || {};
      if (job.kind === 'analysis') {
        if (body.action === 'completed' || job.evidence) return Response.json({ error: '分析阶段由模型Worker维护' }, { status: 409 });
        if (body.action === 'prepared') {
          const base = `${job.user_id}/analysis/${job.id}/${job.lease_token}`;
          const files = await db.storage.from('materials').list(base);
          if (files.error || !Array.isArray(details.frame_times) || details.frame_times.length !== 8
            || typeof details.has_audio !== 'boolean' || !Number.isFinite(details.duration) || details.duration < 0.1 || details.duration > 600
            || !/^[a-f0-9]{64}$/.test(details.source_hash)) throw new Error('预处理证据不正确');
          const frames = details.frame_times.map((time: number, index: number) => {
            const file = files.data?.find(item => item.name === `frame-${index}.jpg`);
            if (!Number.isFinite(time) || time < 0 || time >= details.duration || index && time < details.frame_times[index - 1]
              || !file || !file.metadata?.size || file.metadata.size > 1024 * 1024) throw new Error('抽帧尚未上传完成');
            return { time, url: mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', `${base}/frame-${index}.jpg`) };
          });
          const audio = files.data?.find(item => item.name === 'audio.wav');
          if (details.has_audio && (!audio?.metadata?.size || audio.metadata.size > 20 * 1024 * 1024)) throw new Error('音轨尚未上传完成');
          details = { duration: details.duration, source_hash: details.source_hash, has_audio: details.has_audio,
            prepare_lease: job.lease_token, frames, ...(details.has_audio
              ? { audio_url: mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', `${base}/audio.wav`) } : {}) };
        }
      } else if (body.action === 'prepared') return Response.json({ error: '渲染任务不支持预处理结案' }, { status: 400 });
      if (body.action === 'completed') {
        const files = await db.storage.from('materials').list(path);
        const output = files.data?.find(file => file.name === 'output.mp4');
        const thumbnail = files.data?.find(file => file.name === 'thumbnail.jpg');
        if (files.error || !output || !thumbnail || !Number.isFinite(details.duration)
          || typeof details.resolution !== 'string') throw new Error('成片尚未上传完成');
        details = { size: output.metadata?.size, duration: details.duration, resolution: details.resolution,
          url: mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', `${path}/output.mp4`),
          thumbnail_url: mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', `${path}/thumbnail.jpg`) };
      }
      await jobEvent(db, job, body.action, details);
      return Response.json({ ok: true });
    }
    return Response.json({ error: '操作不支持' }, { status: 400 });
  } catch {
    return Response.json({ error: '生产任务执行器暂时不可用' }, { status: 503 });
  }
}
Deno.serve(handleProductionWorker);
