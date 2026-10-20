import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { providerConfig, validateVideoInput } from '../_shared/video-providers.ts';
import { processVideoJob, publicVideoJob, type VideoJob } from '../_shared/video-jobs.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function handleVideoJobs(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return reply({ error: '请求格式非法' }, 400);
    const db = createServiceClient();
    if (body.action === 'create') {
      if (!uuid(body.request_key) || typeof body.provider !== 'string' || !body.input || typeof body.input !== 'object') {
        return reply({ error: '缺少请求标识或视频参数' }, 400);
      }
      let input;
      try {
        input = validateVideoInput(body.provider, body.input);
        providerConfig(body.provider); // 缺少密钥/模型不支持，创建扣费之前拒绝。
      } catch (cause) {
        return reply({ error: cause instanceof Error ? cause.message : '视频参数非法' }, 400);
      }
      const { data, error } = await db.rpc('create_video_job', {
        p_user_id: auth.user.id, p_request_key: body.request_key,
        p_provider: body.provider, p_payload: input,
      });
      if (error) {
        if (error.message.includes('积分不足')) return reply({ error: error.message }, 402);
        if (error.message.includes('同一请求标识')) return reply({ error: error.message }, 409);
        console.error('video job create transaction failed', error.code);
        return reply({ error: '任务创建未确认，请使用相同请求标识重试' }, 503);
      }
      // 创建只负责持久化，后台定时执行与 query 均可领取；响应丢失可用 request_key 找回。
      return reply({ job: publicVideoJob(data as VideoJob) }, 202);
    }
    if (body.action === 'query') {
      if (!uuid(body.job_id) && !uuid(body.request_key)) return reply({ error: '缺少任务标识' }, 400);
      const select = () => db.from('video_jobs').select('*').eq('user_id', auth.user!.id)
        .eq(uuid(body.job_id) ? 'id' : 'request_key', uuid(body.job_id) ? body.job_id : body.request_key);
      const { data, error } = await select().maybeSingle();
      if (error) return reply({ error: '任务读取暂时失败' }, 503);
      if (!data) return reply({ error: '任务不存在' }, 404);
      try { await processVideoJob(db, data.id); } catch {
        console.error('video job processing failed', data.id); // 持久化租约会回收/核对，无客户端退款。
      }
      const current = await select().single();
      if (current.error) return reply({ error: '任务读取暂时失败' }, 503);
      return reply({ job: publicVideoJob(current.data as VideoJob) });
    }
    if (body.action === 'list') {
      const { data, error } = await db.from('video_jobs').select('*').eq('user_id', auth.user.id)
        .not('charge_id', 'is', null).order('created_at', { ascending: false }).limit(30);
      if (error) return reply({ error: '任务读取暂时失败' }, 503);
      return reply({ jobs: (data as VideoJob[]).map(publicVideoJob) });
    }
    return reply({ error: '不支持的任务操作' }, 400);
  } catch {
    return reply({ error: '视频任务服务暂时不可用' }, 503);
  }
}
Deno.serve(handleVideoJobs);
