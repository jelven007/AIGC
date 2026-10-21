import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { resolveModel } from '../_shared/model-registry.ts';
import { validateMediaTree } from '../_shared/private-media.ts';
import { publicProductionJob, type ProductionJob } from '../_shared/production-jobs.ts';
import { validateRender } from '../_shared/render-spec.ts';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function handleProductionJobs(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const db = createServiceClient();
    const body = await req.json().catch(() => null);
    if (!body) return reply({ error: '任务参数非法' }, 400);
    if (body.action === 'create') {
      if (!uuid(body.request_key) || !['image', 'render'].includes(body.kind) || !body.input) return reply({ error: '缺少任务类型与幂等标识' }, 400);
      let input;
      try { input = await validateMediaTree(db, body.input, auth.user.id); }
      catch { return reply({ error: '素材不存在或无权访问，请重新选择自己的素材' }, 400); }
      if (body.kind === 'image') {
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000
          || !['1024x1024', '1024x1536', '1536x1024'].includes(input.size || '1024x1024')
          || !['auto', 'low', 'medium', 'high'].includes(input.quality || 'auto')) return reply({ error: '图片描述、尺寸或质量非法' }, 400);
      } else {
        try { validateRender(input); }
        catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '工程参数非法' }, 400); }
      }
      const projectId = body.project_id || null;
      if (projectId && !uuid(projectId)) return reply({ error: '作品标识非法' }, 400);
      const prior = await db.from('production_jobs').select('*').eq('user_id', auth.user.id).eq('request_key', body.request_key).maybeSingle();
      if (prior.error) throw new Error('任务查询失败');
      let version = null;
      if (!prior.data && body.kind === 'image') {
        const config = await resolveModel('image.primary', db);
        if (input.reference_image && config.settings.protocol !== 'chat-image') return reply({ error: '当前图片模型不支持参考图' }, 400);
        version = config.version_id;
      }
      const { data, error } = await db.rpc('create_production_job', {
        p_user_id: auth.user.id, p_request_key: body.request_key, p_kind: body.kind,
        p_payload: input, p_project_id: projectId, p_version: version,
      });
      if (error) return reply({ error: error.message.includes('积分不足') ? '积分不足'
        : error.message.includes('同一请求标识') ? '同一请求标识不能用于不同任务' : '任务创建失败，请保留原请求标识重试' },
      error.message.includes('积分不足') ? 402 : error.message.includes('同一请求标识') ? 409 : 503);
      return reply({ job: await publicProductionJob(db, data as ProductionJob) }, 202);
    }
    if (body.action === 'query') {
      if (!uuid(body.job_id) && !uuid(body.request_key)) return reply({ error: '缺少任务标识' }, 400);
      const query = db.from('production_jobs').select('*').eq('user_id', auth.user.id);
      const { data, error } = await (body.job_id ? query.eq('id', body.job_id) : query.eq('request_key', body.request_key)).maybeSingle();
      if (error) throw new Error('任务查询失败');
      if (!data) return reply({ error: '任务不存在' }, 404);
      return reply({ job: await publicProductionJob(db, data as ProductionJob) });
    }
    if (body.action === 'list') {
      const { data, error } = await db.from('production_jobs').select('*').eq('user_id', auth.user.id)
        .order('created_at', { ascending: false }).limit(30);
      if (error) throw new Error('任务查询失败');
      return reply({ jobs: await Promise.all((data as ProductionJob[]).map(job => publicProductionJob(db, job))) });
    }
    return reply({ error: '任务操作不支持' }, 400);
  } catch (cause) {
    return reply({ error: cause instanceof Error ? cause.message : '任务服务不可用' }, 503);
  }
}
Deno.serve(handleProductionJobs);
