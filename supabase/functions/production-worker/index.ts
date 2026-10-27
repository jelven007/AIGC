import { createServiceClient } from '../_shared/auth.ts';
import { processImageJob, jobEvent, type ProductionJob } from '../_shared/production-jobs.ts';
import { mediaReference, signMediaTree } from '../_shared/private-media.ts';
import { processPublishJob, collectPlatformMetrics } from '../_shared/platform-jobs.ts';
import { processVideoJob } from '../_shared/video-jobs.ts';
import { processMediaDeletions, processVoiceDeletions } from '../_shared/media-cleanup.ts';
import { processMediaJob, MEDIA_JOB_SLOTS } from '../_shared/media-jobs.ts';
import { processAnalysisJob } from '../_shared/video-analysis.ts';
import { KNOWLEDGE_KINDS, processKnowledgeJob } from '../_shared/knowledge.ts';
import { INTELLIGENCE_KINDS } from '../_shared/intelligence-provider.ts';
import { processIntelligenceJob } from '../_shared/intelligence-jobs.ts';
import { processProductImport } from '../_shared/product-import.ts';
import { processCashRefund } from '../_shared/cash-refunds.ts';
import { processProductTranslation } from '../_shared/product-translation.ts';
import { processWechatOrder } from '../_shared/wechat-transactions.ts';
import { processWechatRefund } from '../_shared/wechat-refunds.ts';
import { editEvidence, type EditRequest } from '../_shared/edit-contract.ts';
import { processEditJob } from '../_shared/edit-jobs.ts';
import { processBatchPipeline } from '../_shared/batch-pipeline.ts';
import { workerProbe } from '../_shared/worker-probe.ts';

export async function handleProductionWorker(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const token = req.headers.get('authorization');
  const render = !!Deno.env.get('RENDER_WORKER_SECRET') && token === `Bearer ${Deno.env.get('RENDER_WORKER_SECRET')}`;
  const general = !!Deno.env.get('VIDEO_WORKER_SECRET') && token === `Bearer ${Deno.env.get('VIDEO_WORKER_SECRET')}`;
  if (!render && !general) return new Response('Unauthorized', { status: 401 });
  try {
    const db = createServiceClient();
    const body = await req.json();
    if (body.action === 'alive') return Response.json({ alive: true });
    if (['probe', 'capabilities', 'ready'].includes(body.action)) return workerProbe(db, body.action);
    if (body.action === 'alert_claim' || body.action === 'alert_finish') {
      if (!general) return Response.json({ error: '仅通用后台可投递告警' }, { status: 403 });
      if (typeof body.channel !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(body.channel)) {
        return Response.json({ error: '告警渠道非法' }, { status: 400 });
      }
      if (body.action === 'alert_claim') {
        const result = await db.rpc('claim_alert_delivery', { p_channel: body.channel });
        return result.error ? Response.json({ error: '告警投递不可用' }, { status: 503 }) : Response.json(result.data);
      }
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      if (typeof body.event_id !== 'string' || !uuid.test(body.event_id)
          || typeof body.lease_token !== 'string' || !uuid.test(body.lease_token)) {
        return Response.json({ error: '原事件与租约非法' }, { status: 400 });
      }
      const receipt = body.receipt && typeof body.receipt === 'object'
        ? { accepted: body.receipt.accepted === true, event_id: body.receipt.event_id } : null;
      const result = await db.rpc('finish_alert_delivery', {
        p_channel: body.channel, p_event: body.event_id, p_lease: body.lease_token, p_receipt: receipt,
      });
      return result.error ? Response.json({ error: '告警回执待恢复' }, { status: 503 })
        : Response.json({ saved: result.data === true });
    }
    if (general && body.action === 'monitor') {
      if (typeof body.scheduler_healthy !== 'boolean') return Response.json({ error: '缺少调度健康状态' }, { status: 400 });
      const alerts = await db.rpc('refresh_operations_alerts', { p_scheduler_healthy: body.scheduler_healthy });
      if (alerts.error) return Response.json({ error: '告警采集不可用' }, { status: 503 });
      return Response.json(alerts.data);
    }
    if (general && body.action === 'run') {
      const runners: Record<string, () => Promise<boolean>> = {
        video: () => processVideoJob(db), image: () => processImageJob(db), publish: () => processPublishJob(db),
        analysis: () => processAnalysisJob(db), edit_analysis: () => processEditJob(db),
        batch_pipeline: () => processBatchPipeline(db), product_import: () => processProductImport(db),
        product_translate: () => processProductTranslation(db), cash_refund: () => processCashRefund(db),
        wechat_order: () => processWechatOrder(db), wechat_refund: () => processWechatRefund(db),
        ...Object.fromEntries(KNOWLEDGE_KINDS.map(kind => [kind, () => processKnowledgeJob(db, kind)])),
        ...Object.fromEntries(INTELLIGENCE_KINDS.map(kind => [kind, () => processIntelligenceJob(db, kind)])),
        ...Object.fromEntries(Object.keys(MEDIA_JOB_SLOTS).map(kind => [kind, () => processMediaJob(db, kind)])),
      };
      const due = await db.rpc('worker_due_lanes');
      if (due.error || !Array.isArray(due.data)) throw new Error('到期队列不可用');
      const excluded: string[] = Object.keys(runners).filter(lane => !due.data.includes(lane));
      let processed = false;
      for (let index = 0; index < due.data.length && !processed; index++) {
        const claimed = await db.rpc('claim_worker_dispatch', { p_excluded: excluded });
        if (claimed.error) throw new Error('执行配额不可用');
        if (!claimed.data) break;
        const { lane, lease_token: lease } = claimed.data;
        try {
          if (!runners[lane] || !lease) throw new Error('执行队列版本不匹配');
          excluded.push(lane);
          processed = await runners[lane]();
        } finally {
          const released = await db.rpc('finish_worker_dispatch', { p_lease: lease });
          if (released.error || released.data !== true) throw new Error('执行配额回执待恢复');
        }
      }
      return Response.json({ processed: processed ? 1 : 0 });
    }
    if (general && body.action === 'maintenance') {
      const claimed = await db.rpc('claim_worker_maintenance');
      if (claimed.error) throw new Error('维护配额不可用');
      if (!claimed.data) return Response.json({ processed: 0, errors: 0 });
      const { task, lease_token: lease } = claimed.data;
      let success = false;
      try {
        if (task === 'media_deletions') await processMediaDeletions(db);
        else if (task === 'voice_deletions') await processVoiceDeletions(db);
        else if (task === 'metrics') await collectPlatformMetrics(db);
        else if (['enqueue_intelligence_schedule', 'prune_intelligence_data', 'prune_product_imports',
          'prune_product_translations', 'prune_notifications', 'prune_job_evidence', 'enqueue_expired_media'].includes(task)) {
          const result = await db.rpc(task);
          if (result.error) throw new Error('维护未完成');
        } else throw new Error('维护版本不匹配');
        success = true;
      } catch { /* 单项故障保留退避，不扩散到任务执行。 */ }
      const saved = await db.rpc('finish_worker_maintenance', { p_lease: lease, p_success: success });
      if (saved.error || saved.data !== true) throw new Error('维护回执待恢复');
      return Response.json({ processed: success ? 1 : 0, errors: success ? 0 : 1, task });
    }
    if (general && body.action === 'metrics') return Response.json({ collected: await collectPlatformMetrics(db) });
    if (render && body.action === 'claim') {
      const preparing = body.kind === 'analysis_prepare';
      const editing = body.kind === 'edit_prepare';
      if (body.kind && !preparing && !editing) return Response.json({ error: '领取类型不支持' }, { status: 400 });
      if (!preparing && (body.render_version !== 4 || editing && body.edit_version !== 2)) {
        return Response.json({ error: '请更新FFmpeg Worker镜像，当前工程要求render_version=4及edit_version=2' }, { status: 426 });
      }
      const { data, error } = await db.rpc('claim_production_job', { p_kind: preparing ? 'analysis_prepare' : editing ? 'edit_prepare' : 'render', p_job_id: null });
      if (error) throw new Error('领取失败');
      if (!data) return Response.json({ job: null });
      const job = data as ProductionJob;
      if (job.resolution) {
        await jobEvent(db, job, job.resolution.event, job.resolution.data);
        return Response.json({ job: null, recovered: true });
      }
      const basePath = `${job.user_id}/${preparing ? 'analysis' : editing ? 'edits' : 'renders'}/${job.id}/${job.lease_token}`;
      const outputs = [];
      const outputFiles = preparing ? [['audio.wav', 'audio/wav'], ...Array.from({ length: 8 }, (_, index) => [`frame-${index}.jpg`, 'image/jpeg'])]
        : editing ? job.payload.mode === 'subtitles' ? [['audio.wav', 'audio/wav']] : []
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
      const { data, error } = await db.from('production_jobs').select('*').eq('id', body.job_id).in('kind', ['render', 'analysis', 'edit_analysis']).single();
      if (!error && ['analysis', 'edit_analysis'].includes(data?.kind) && data.evidence?.prepare_lease === body.lease_token && body.action === 'prepared') {
        return Response.json({ ok: true });
      }
      if (!error && data?.final_lease_token === body.lease_token && ['completed', 'failed'].includes(data.status)) {
        return Response.json({ ok: true, status: data.status });
      }
      if (error || !data || data.lease_token !== body.lease_token) return Response.json({ error: '租约无效' }, { status: 409 });
      const job = data as ProductionJob;
      const path = `${job.user_id}/renders/${job.id}/${job.lease_token}`;
      let details = body.data || {};
      if (job.kind === 'edit_analysis') {
        if (job.evidence || !['heartbeat', 'failed', 'retry', job.payload.mode === 'beats' ? 'completed' : 'prepared'].includes(body.action)) {
          return Response.json({ error: '字幕模型阶段由后台调度维护' }, { status: 409 });
        }
        if (['prepared', 'completed'].includes(body.action)) {
          const input = job.payload as EditRequest;
          if (job.payload.pipeline_audio && (!Number.isFinite(details.duration) || details.duration < .1
            || details.duration > input.source.duration)) throw new Error('配音长度超过批次时长');
          details = editEvidence(details, job.payload.pipeline_audio
            ? { ...input, source: { ...input.source, duration: details.duration } } : input);
          if (job.payload.mode === 'beats') details = { ...details, mode: 'beats',
            source: { ...input.source, ...(job.payload.pipeline_audio ? { duration: details.duration } : {}) } };
          else {
            const base = `${job.user_id}/edits/${job.id}/${job.lease_token}`;
            const files = await db.storage.from('materials').list(base);
            const audio = files.data?.find(file => file.name === 'audio.wav');
            if (files.error || !audio?.metadata?.size || audio.metadata.size > 20 * 1024 * 1024) throw new Error('字幕音轨尚未上传完成');
            details = { ...details, prepare_lease: job.lease_token,
              audio_url: mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', `${base}/audio.wav`) };
          }
        }
      } else if (job.kind === 'analysis') {
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
      if (body.action === 'completed' && job.kind === 'render') {
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
