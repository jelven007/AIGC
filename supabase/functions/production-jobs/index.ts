import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { ConfigError, resolveModel } from '../_shared/model-registry.ts';
import { validateMediaTree } from '../_shared/private-media.ts';
import { publicProductionJob, type ProductionJob } from '../_shared/production-jobs.ts';
import { validateRender } from '../_shared/render-spec.ts';
import { exportRequest, publicRenderExport } from '../_shared/render-exports.ts';
import { createMediaJob, MEDIA_JOB_SLOTS, mediaJobInput } from '../_shared/media-jobs.ts';
import { analysisInput, createAnalysisJob } from '../_shared/video-analysis.ts';
import { KNOWLEDGE_KINDS } from '../_shared/knowledge.ts';
import { INTELLIGENCE_KINDS } from '../_shared/intelligence-provider.ts';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function handleProductionJobs(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const body = await req.json().catch(() => null);
    if (!body) return reply({ error: '任务参数非法' }, 400);
    const auth = await authenticateRequest(req, body.action === 'export' ? 'render:create' : body.action === 'create'
      ? body.kind === 'image' ? 'image:create' : body.kind === 'render' ? 'render:create'
        : body.kind === 'analysis' ? 'video:create'
        : MEDIA_JOB_SLOTS[body.kind] ? ['avatar', 'lipsync'].includes(body.kind) ? 'avatar:create' : 'audio:create' : undefined
      : ['query', 'list', 'exports', 'query-export', 'voices', 'media-prices', 'analysis-price'].includes(body.action) ? 'jobs:read' : undefined);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录' }, auth.status || 401);
    const db = createServiceClient();
    if (body.action === 'analysis-price') {
      const result = await db.from('credit_costs').select('cost').eq('action', 'generate_analysis').maybeSingle();
      if (result.error || !Number.isInteger(result.data?.cost)) throw new Error('分析计费配置缺失');
      return reply({ cost: result.data!.cost });
    }
    if (body.action === 'media-prices') {
      const result = await db.from('credit_costs').select('action,cost').in('action', Object.keys(MEDIA_JOB_SLOTS).map(kind => `generate_${kind}`));
      if (result.error || result.data?.length !== Object.keys(MEDIA_JOB_SLOTS).length) throw new Error('媒体计费配置缺失');
      return reply({ costs: Object.fromEntries(result.data.map(row => [row.action.replace('generate_', ''), row.cost])) });
    }
    if (body.action === 'voices') {
      const result = await db.from('voice_clones').select('id,name,requires_verification,created_at')
        .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
      if (result.error) throw new Error('声纹列表读取失败');
      return reply({ voices: result.data });
    }
    if (body.action === 'export') {
      if (!uuid(body.request_key)) return reply({ error: '缺少有效幂等标识' }, 400);
      let request;
      try { request = exportRequest(body); }
      catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '导出参数非法' }, 400); }
      const prior = await db.from('render_exports').select('*').eq('user_id', auth.user.id).eq('request_key', body.request_key).maybeSingle();
      if (prior.error) throw new Error('导出请求核对失败');
      if (prior.data) {
        if (JSON.stringify(exportRequest(prior.data.request_payload)) !== JSON.stringify(request)) {
          return reply({ error: '同一请求标识不能用于不同导出' }, 409);
        }
        return reply({ export: await publicRenderExport(db, prior.data) }, 202);
      }
      const source = await db.from('video_projects').select('id,title,video_url,duration,status')
        .eq('user_id', auth.user.id).eq('id', request.source_project_id).maybeSingle();
      if (source.error) throw new Error('源作品读取失败');
      if (!source.data || source.data.status !== 'completed' || !source.data.video_url
        || !Number.isFinite(source.data.duration) || source.data.duration < 1 || source.data.duration > 600) {
        return reply({ error: '请选择时长不超过10分钟的已完成作品' }, 400);
      }
      let mediaUrl;
      try { mediaUrl = await validateMediaTree(db, source.data.video_url, auth.user.id); }
      catch { return reply({ error: '源素材不存在或无权访问，请重新选择作品' }, 400); }
      const created = await db.rpc('create_render_export', { p_user_id: auth.user.id, p_request_key: body.request_key,
        p_request: request, p_expected_source_url: source.data.video_url, p_media_url: mediaUrl });
      if (created.error) {
        const message = created.error.message;
        if (message.includes('队列')) return reply({ error: message }, 429);
        if (message.includes('同一请求标识')) return reply({ error: '同一请求标识不能用于不同导出' }, 409);
        if (message.includes('源作品')) return reply({ error: message }, 409);
        throw new Error('导出创建结果待确认，请使用原请求恢复');
      }
      const group = await db.from('render_exports').select('*').eq('id', created.data).eq('user_id', auth.user.id).single();
      if (group.error) throw new Error('导出创建结果待确认，请使用原请求恢复');
      return reply({ export: await publicRenderExport(db, group.data) }, 202);
    }
    if (body.action === 'query-export') {
      if (!uuid(body.export_id) && !uuid(body.request_key)) return reply({ error: '缺少导出标识' }, 400);
      const query = db.from('render_exports').select('*').eq('user_id', auth.user.id);
      const { data, error } = await (body.export_id ? query.eq('id', body.export_id) : query.eq('request_key', body.request_key)).maybeSingle();
      if (error) throw new Error('导出查询失败');
      if (!data) return reply({ error: '导出不存在' }, 404);
      return reply({ export: await publicRenderExport(db, data) });
    }
    if (body.action === 'exports') {
      const { data, error } = await db.from('render_exports').select('*').eq('user_id', auth.user.id)
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw new Error('导出列表查询失败');
      return reply({ exports: await Promise.all(data.map(group => publicRenderExport(db, group))) });
    }
    if (body.action === 'create') {
      if (body.kind === 'analysis') {
        if (!uuid(body.request_key) || body.project_id) return reply({ error: '分析任务需要有效幂等标识' }, 400);
        try { analysisInput(body.input); }
        catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '分析参数非法' }, 400); }
        try { return reply({ job: await createAnalysisJob(db, auth.user.id, body.request_key, body.input) }, 202); }
        catch (cause) {
          const message = cause instanceof Error ? cause.message : '分析任务创建失败';
          return reply({ error: message }, cause instanceof ConfigError || message.includes('Whisper') ? 424
            : message.includes('积分不足') ? 402 : message.includes('队列') ? 429
              : /价格已更新|配置已更新|同一请求标识/.test(message) ? 409 : /素材|无权/.test(message) ? 400 : 503);
        }
      }
      if (MEDIA_JOB_SLOTS[body.kind]) {
        try { mediaJobInput(body.kind, body.input); }
        catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '媒体任务参数非法' }, 400); }
        if (!uuid(body.request_key)) return reply({ error: '缺少有效幂等标识' }, 400);
        try {
          return reply({ job: await createMediaJob(db, auth.user.id, body.kind, body.request_key, body.input, body.project_id) }, 202);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : '任务创建失败';
          return reply({ error: message }, cause instanceof ConfigError ? 424 : message.includes('积分不足') ? 402 : message.includes('队列') ? 429
            : /同一请求标识|价格已更新|配置已更新/.test(message) ? 409 : /素材|无权|声纹|语速|音色|WAV/.test(message) ? 400 : 503);
        }
      }
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
      if (error?.message.includes('渲染队列')) return reply({ error: error.message }, 429);
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
      let query = db.from('production_jobs').select('*').eq('user_id', auth.user.id);
      if (body.kinds !== undefined) {
        if (!Array.isArray(body.kinds) || !body.kinds.length || body.kinds.some((kind: string) =>
          !['image', 'render', 'publish', 'metrics', 'analysis', ...Object.keys(MEDIA_JOB_SLOTS), ...KNOWLEDGE_KINDS, ...INTELLIGENCE_KINDS].includes(kind))) return reply({ error: '任务类型筛选非法' }, 400);
        query = query.in('kind', body.kinds);
      }
      const { data, error } = await query.order('created_at', { ascending: false }).limit(30);
      if (error) throw new Error('任务查询失败');
      return reply({ jobs: await Promise.all((data as ProductionJob[]).map(job => publicProductionJob(db, job))) });
    }
    return reply({ error: '任务操作不支持' }, 400);
  } catch (cause) {
    return reply({ error: cause instanceof Error ? cause.message : '任务服务不可用' }, 503);
  }
}
Deno.serve(handleProductionJobs);
