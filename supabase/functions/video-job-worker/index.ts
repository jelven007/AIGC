import { createServiceClient } from '../_shared/auth.ts';
import { processVideoJob } from '../_shared/video-jobs.ts';

export async function handleVideoWorker(req: Request): Promise<Response> {
  const key = Deno.env.get('VIDEO_WORKER_SECRET');
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!key || req.headers.get('authorization') !== `Bearer ${key}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    // 每次有限领取，多个定时请求可并行，数据库 SKIP LOCKED 避免重复提交。
    const processed = await processVideoJob(createServiceClient());
    return Response.json({ processed: processed ? 1 : 0 });
  } catch {
    console.error('video worker failed; persisted lease will recover');
    return Response.json({ error: '任务执行失败，等待租约恢复' }, { status: 503 });
  }
}
Deno.serve(handleVideoWorker);
