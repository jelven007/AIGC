import { createServiceClient } from '../_shared/auth.ts';
import { processImageJob, jobEvent, type ProductionJob } from '../_shared/production-jobs.ts';
import { mediaReference, signMediaTree } from '../_shared/private-media.ts';
import { processPublishJob, collectPlatformMetrics } from '../_shared/platform-jobs.ts';
import { processVideoJob } from '../_shared/video-jobs.ts';
import { processMediaDeletions } from '../_shared/media-cleanup.ts';
import { processMediaJob, MEDIA_JOB_SLOTS } from '../_shared/media-jobs.ts';

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
      const ready = !error && !voices.error && !costs.error && costs.data?.length === Object.keys(MEDIA_JOB_SLOTS).length;
      return Response.json({ ready, version: 2, required_migration: '00040' }, { status: ready ? 200 : 503 });
    }
    if (general && body.action === 'run') {
      // 以轮转顺序避免长视频队列使图片或发布饿死。
      const runners = [() => processVideoJob(db), () => processImageJob(db), () => processPublishJob(db),
        ...Object.keys(MEDIA_JOB_SLOTS).map(kind => () => processMediaJob(db, kind))];
      const offset = Math.floor(Date.now() / 1000) % runners.length;
      let processed = false;
      for (let index = 0; index < runners.length && !processed; index++) processed = await runners[(index + offset) % runners.length]();
      const cleaned = await processMediaDeletions(db);
      return Response.json({ processed: processed ? 1 : 0, cleaned });
    }
    if (general && body.action === 'metrics') return Response.json({ collected: await collectPlatformMetrics(db) });
    if (render && body.action === 'claim') {
      const { data, error } = await db.rpc('claim_production_job', { p_kind: 'render', p_job_id: null });
      if (error) throw new Error('领取失败');
      if (!data) return Response.json({ job: null });
      const job = data as ProductionJob;
      if (job.resolution) {
        await jobEvent(db, job, job.resolution.event, job.resolution.data);
        return Response.json({ job: null, recovered: true });
      }
      const basePath = `${job.user_id}/renders/${job.id}/${job.lease_token}`;
      const outputs = [];
      for (const [name, type] of [['output.mp4', 'video/mp4'], ['thumbnail.jpg', 'image/jpeg']]) {
        const path = `${basePath}/${name}`;
        const upload = await db.storage.from('materials').createSignedUploadUrl(path);
        if (upload.error || !upload.data) throw new Error('生成上传凭据失败');
        outputs.push({ path, url: upload.data.signedUrl, type });
      }
      return Response.json({ job: { id: job.id, lease_token: job.lease_token,
        payload: await signMediaTree(db, job.payload, job.user_id, 3600) }, outputs });
    }
    if (render && ['heartbeat', 'completed', 'failed', 'retry'].includes(body.action)) {
      const { data, error } = await db.from('production_jobs').select('*').eq('id', body.job_id).eq('kind', 'render').single();
      if (!error && data?.final_lease_token === body.lease_token && ['completed', 'failed'].includes(data.status)) {
        return Response.json({ ok: true, status: data.status });
      }
      if (error || !data || data.lease_token !== body.lease_token) return Response.json({ error: '租约无效' }, { status: 409 });
      const job = data as ProductionJob;
      const path = `${job.user_id}/renders/${job.id}/${job.lease_token}`;
      let details = body.data || {};
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
