import { createServiceClient } from '../_shared/auth.ts';
import { processVideoJob } from '../_shared/video-jobs.ts';

export async function handleVideoWorker(req: Request): Promise<Response> {
  const key = Deno.env.get('VIDEO_WORKER_SECRET');
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!key || req.headers.get('authorization') !== `Bearer ${key}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !['run', 'probe', undefined].includes(body.action)) {
    return Response.json({ error: '不支持的执行器操作' }, { status: 400 });
  }
  try {
    const db = createServiceClient();
    if (body.action === 'probe') {
      // 部署与调度预检仅验证队列结构，不领取任务或调用模型。
      const { error } = await db.from('video_jobs')
        .select('id,charge_id,submission_state,next_poll_at,resolution_event,model_config_version_id').limit(0);
      if (error) return Response.json({ ready: false, error: '视频任务迁移尚未就绪' }, { status: 503 });
      return Response.json({ ready: true, version: 1 });
    }
    // 每次有限领取，多个定时请求可并行，数据库 SKIP LOCKED 避免重复提交。
    const processed = await processVideoJob(db);
    return Response.json({ processed: processed ? 1 : 0 });
  } catch {
    console.error('video worker failed; persisted lease will recover');
    return Response.json({ error: '任务执行失败，等待租约恢复' }, { status: 503 });
  }
}
Deno.serve(handleVideoWorker);
