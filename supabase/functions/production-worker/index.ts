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
      const products = await db.from('products').select('id,currency,source,import_job_id').limit(0);
      const receipts = await db.from('product_mutation_receipts').select('request_key,request_hash').limit(0);
      const cash = await db.from('alipay_refunds').select('request_key,lease_token,applied_at,next_query_at').limit(0);
      const wechat = await db.from('wechat_transactions').select('order_id,mchid,lease_token,next_query_at').limit(0);
      const wechatOrders = await db.from('orders').select('wechat_expires_at,wechat_close_requested_at').limit(0);
      const wechatRefunds = await db.from('alipay_refunds').select('pay_channel,provider_refund_id,submitted_at').limit(0);
      const operators = await db.from('operator_mutations').select('request_key,actor_id').limit(0);
      const notifications = await db.from('notifications').select('event_key,read_at,deleted_at').limit(0);
      const references = await db.from('analysis_intelligence_references').select('job_id,context').limit(0);
      const translations = await db.from('credit_costs').select('cost').eq('action', 'generate_product_translate').maybeSingle();
      const checkout = await db.from('orders').select('id,checkout_request_key').limit(0);
      const retention = await db.from('media_deletions').select('id,lease_token,lease_until').limit(0);
      const mediaReferences = await db.from('media_references').select('bucket,path,source_table').limit(0);
      const revocations = await db.from('voice_deletions').select('id,lease_token').limit(0);
      const revocationReceipts = await db.from('voice_revocation_receipts').select('request_key,clone_id').limit(0);
      const voiceState = await db.from('voice_clones').select('revoked_at,provider_deleted_at').limit(0);
      const erased = await db.from('production_jobs').select('source_erased_at').limit(0);
      const editCosts = await db.from('credit_costs').select('action,cost').in('action', ['generate_edit_beats', 'generate_edit_subtitles']);
      const materialReceipts = await db.from('material_upload_receipts').select('request_key,material_id,rights_confirmed_at').limit(0);
      const pipeline = await db.from('batch_pipeline_stages').select('id,request_key,charge_id,depends_on,publish_group_id').limit(0);
      const support = await db.from('support_tickets').select('id,version,assignee_id,due_at').limit(0);
      const supportMessages = await db.from('support_messages').select('id,ticket_id,internal').limit(0);
      const tenants = await db.from('teams').select('state,ops_version,daily_credit_budget').limit(0);
      const teamBudget = await db.from('team_credit_reservations').select('charge_id,team_id').limit(0);
      const restrictions = await db.from('workload_restrictions').select('user_id,restricted,version').limit(0);
      const supplierCosts = await db.from('supplier_cost_entries').select('job_id,model_version,amount_minor,evidence_sha256').limit(0);
      const alerts = await db.from('operations_alerts').select('id,rule,status,version').limit(0);
      const alertEvents = await db.from('operations_alert_events').select('alert_id,event,version').limit(0);
      const monitor = await db.from('operations_monitor_state').select('last_scan_at,scheduler_healthy').limit(0);
      const profileSchema = await db.rpc('profile_overview_schema_ready');
      const rewardSchema = await db.rpc('reward_schema_ready');
      const ready = !error && !voices.error && !costs.error && costs.data?.length === Object.keys(MEDIA_JOB_SLOTS).length
        && !analysis.error && !!analysis.data && !measurements.error && !experiments.error && !knowledge.error && !chunks.error
        && !knowledgeCosts.error && knowledgeCosts.data?.length === 2 && knowledgeCosts.data.every(row => Number.isInteger(row.cost) && row.cost >= 0)
        && !intelligence.error && !intelligenceCosts.error && intelligenceCosts.data?.length === 2
        && !publishGroups.error && !publishTasks.error && !products.error && !receipts.error && !cash.error && !operators.error
        && !checkout.error && !notifications.error && !references.error && !translations.error && Number.isInteger(translations.data?.cost) && translations.data!.cost >= 0
        && !retention.error && !mediaReferences.error && !revocations.error && !revocationReceipts.error && !voiceState.error && !erased.error
        && !wechat.error && !wechatOrders.error && !wechatRefunds.error && !editCosts.error && !materialReceipts.error && !pipeline.error
        && !support.error && !supportMessages.error && !tenants.error && !teamBudget.error && !restrictions.error && !supplierCosts.error
        && !alerts.error && !alertEvents.error && !monitor.error && !profileSchema.error && profileSchema.data === true
        && !rewardSchema.error && rewardSchema.data === true
        && editCosts.data?.length === 2 && editCosts.data.every(row => Number.isInteger(row.cost) && row.cost >= 0);
      return Response.json({ ready, version: 20, render_version: 4, edit_version: 2, required_migration: '00060' }, { status: ready ? 200 : 503 });
    }
    if (general && body.action === 'monitor') {
      if (typeof body.scheduler_healthy !== 'boolean') return Response.json({ error: '缺少调度健康状态' }, { status: 400 });
      const alerts = await db.rpc('refresh_operations_alerts', { p_scheduler_healthy: body.scheduler_healthy });
      if (alerts.error) return Response.json({ error: '告警采集不可用' }, { status: 503 });
      return Response.json(alerts.data);
    }
    if (general && body.action === 'run') {
      const scheduled = await db.rpc('enqueue_intelligence_schedule');
      if (scheduled.error) throw new Error('情报调度未就绪');
      const pruned = await db.rpc('prune_intelligence_data');
      if (pruned.error) throw new Error('情报留存处理失败');
      const productPruned = await db.rpc('prune_product_imports');
      if (productPruned.error) throw new Error('商品提取留存处理失败');
      const translationPruned = await db.rpc('prune_product_translations');
      const notificationPruned = await db.rpc('prune_notifications');
      if (translationPruned.error || notificationPruned.error) throw new Error('翻译或通知留存处理失败');
      const evidencePruned = await db.rpc('prune_job_evidence');
      const expiredMedia = await db.rpc('enqueue_expired_media');
      if (evidencePruned.error || expiredMedia.error) throw new Error('媒体及任务留存处理失败');
      let voicesDeleted = 0;
      // 以轮转顺序避免长视频队列使图片或发布饿死。
      const runners = [() => processVideoJob(db), () => processImageJob(db), () => processPublishJob(db), () => processAnalysisJob(db),
        () => processEditJob(db), () => processBatchPipeline(db),
        () => processProductImport(db),
        () => processProductTranslation(db),
        () => processCashRefund(db),
        () => processWechatOrder(db), () => processWechatRefund(db),
        async () => { voicesDeleted = await processVoiceDeletions(db); return voicesDeleted > 0; },
        ...KNOWLEDGE_KINDS.map(kind => () => processKnowledgeJob(db, kind)),
        ...INTELLIGENCE_KINDS.map(kind => () => processIntelligenceJob(db, kind)),
        ...Object.keys(MEDIA_JOB_SLOTS).map(kind => () => processMediaJob(db, kind))];
      const offset = Math.floor(Date.now() / 1000) % runners.length;
      let processed = false;
      for (let index = 0; index < runners.length && !processed; index++) processed = await runners[(index + offset) % runners.length]();
      const cleaned = await processMediaDeletions(db);
      return Response.json({ processed: processed ? 1 : 0, cleaned, voices_deleted: voicesDeleted, expired_media: expiredMedia.data, scheduled: scheduled.data });
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
