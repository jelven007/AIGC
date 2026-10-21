import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { collectPlatformMetrics } from '../_shared/platform-jobs.ts';
import { creatorInfo } from '../_shared/platforms.ts';
import { publishScope } from '../_shared/api-scopes.ts';
import { capabilityError, groupRequest, uuid } from '../_shared/publish-contract.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

const taskFields = 'id,job_id,group_id,request_key,project_id,connection_id,platform,title,description,tags,status,scheduled_at,created_at,published_at,platform_video_id,platform_url,error_message,metrics_error';

export async function handlePlatformPublish(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => Response.json(body, { headers, status });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await responseBytes(new Response(req.body), 32768))); }
    catch { return reply({ error: '请求正文无效或超过32KB' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: '发布参数无效' }, 400);
    const auth = await authenticateRequest(req, publishScope(body.action));
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录' }, auth.status || 401);
    const db = createServiceClient();
    const readGroup = async (key: string) => {
      const result = await db.from('publish_groups').select('id,request_key,request,created_at')
        .eq('user_id', auth.user!.id).eq('request_key', key).maybeSingle();
      if (result.error) throw new Error('发布组读取失败');
      if (!result.data) return null;
      const tasks = await db.from('publish_tasks').select(taskFields).eq('user_id', auth.user!.id)
        .eq('group_id', result.data.id).order('created_at');
      if (tasks.error) throw new Error('发布组任务读取失败');
      return { ...result.data, tasks: tasks.data };
    };
    if (body.action === 'query_group') {
      if (!uuid(body.request_key)) return reply({ error: '请提供原发布组请求标识' }, 400);
      return reply({ group: await readGroup(body.request_key) });
    }
    if (body.action === 'create_group') {
      let payload;
      try { payload = groupRequest(body); }
      catch (cause) { return reply({ error: (cause as Error).message }, 400); }
      const prior = await readGroup(body.request_key);
      let source = null, duration = null;
      if (!prior) {
        if (payload.scheduled_at && (Date.parse(payload.scheduled_at) <= Date.now()
          || Date.parse(payload.scheduled_at) > Date.now() + 30 * 86400000)) {
          return reply({ error: '定时发布应在未来30天以内' }, 400);
        }
        const project = await db.from('video_projects').select('video_url,duration')
          .eq('id', payload.project_id).eq('user_id', auth.user.id).eq('status', 'completed').maybeSingle();
        if (project.error) throw new Error('成片读取失败');
        if (!project.data?.video_url) return reply({ error: '成片不存在或无权访问' }, 400);
        if (project.data.video_url !== payload.source_url || project.data.duration !== payload.duration) {
          return reply({ error: '成片已变化，请刷新后重新预览' }, 400);
        }
        source = project.data.video_url; duration = project.data.duration;
        const rateWindow = Math.floor(Date.now() / 60000);
        const limited = await db.rpc('upsert_rate_limit', { p_window_key: `publish-group:${auth.user.id}:${rateWindow}`,
          p_client_id: `publish-group:${auth.user.id}`, p_reset_at: new Date((rateWindow + 1) * 60000).toISOString(), p_max_req: 12 });
        if (limited.error) throw new Error('发布限流服务不可用');
        if (!limited.data) return reply({ error: '发布组创建过于频繁，请稍后重试' }, 429);
        for (const target of payload.targets) {
          const info = await creatorInfo(db, target.connection_id, auth.user.id);
          const error = capabilityError(info, target.options, duration);
          if (error) return reply({ error: `${info.display_name}：${error}` }, 400);
        }
      }
      const result = await db.rpc('create_publish_group', { p_user: auth.user.id, p_request: body.request_key,
        p_payload: payload, p_source: source, p_duration: duration });
      if (result.error) {
        if (!/^(P000[12]|22|23)/.test(result.error.code || '')) throw new Error('发布组结果待核对，请按原请求标识查询');
        const known = ['同一请求标识不能用于不同发布', '最多保留24个未结案发布任务', '成片已变化，请重新预览',
          '账号已断开或无权访问', '定时发布应在未来30天以内'];
        return reply({ error: known.find(message => result.error!.message.includes(message))
          || '发布组创建失败，请检查作品和所有账号授权',
          code: prior || result.error.message.includes('同一请求') ? 'publish_group_conflict' : 'publish_group_rejected' }, 409);
      }
      const group = await readGroup(body.request_key);
      if (!group) throw new Error('发布组结果待核对，请按原请求标识查询');
      return reply({ group }, 202);
    }
    if (body.action === 'query') {
      const result = await db.from('publish_tasks').select(taskFields).eq('user_id', auth.user.id).eq('request_key', body.request_key).maybeSingle();
      if (result.error) throw new Error('发布请求核对失败');
      return reply({ task: result.data });
    }
    if (body.action === 'list') {
      const result = await db.from('publish_tasks').select(taskFields).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
      if (result.error) throw new Error('发布任务读取失败');
      const groups = await db.from('publish_groups').select(`id,request_key,request,created_at,tasks:publish_tasks(${taskFields})`)
        .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(20);
      if (groups.error) throw new Error('发布组读取失败');
      return reply({ tasks: result.data, groups: groups.data });
    }
    if (body.action === 'metrics') {
      const result = await db.from('platform_video_metrics').select('*').eq('user_id', auth.user.id).order('collected_at', { ascending: false }).limit(100);
      if (result.error) throw new Error('指标读取失败');
      return reply({ metrics: result.data });
    }
    if (body.action === 'sync') {
      const start = Math.floor(Date.now() / 60000) * 60000;
      const limited = await db.rpc('upsert_rate_limit', {
        p_window_key: `metrics:${auth.user.id}:${start}`, p_client_id: `metrics:${auth.user.id}`,
        p_reset_at: new Date(start + 60000).toISOString(), p_max_req: 2,
      });
      if (limited.error || !limited.data) return reply({ error: '数据同步过于频繁，请稍后重试' }, 429);
      return reply({ collected: await collectPlatformMetrics(db, auth.user.id) });
    }
    if (body.action === 'create') {
      if (!uuid(body.request_key) || !uuid(body.connection_id) || !uuid(body.project_id)
        || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 150
        || typeof body.description !== 'string' || body.description.length > 1000
        || !Array.isArray(body.tags) || body.tags.length > 10 || body.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 30)
        || body.options?.consent !== true || typeof body.options?.privacy_level !== 'string') return reply({ error: '发布参数不完整，请选择账号、内容、可见范围并确认发布' }, 400);
      for (const field of ['disable_comment', 'disable_duet', 'disable_stitch', 'brand_content_toggle', 'brand_organic_toggle', 'is_aigc']) {
        if (typeof body.options[field] !== 'boolean') return reply({ error: '发布选项不完整' }, 400);
      }
      const prior = await db.from('publish_tasks').select('id').eq('user_id', auth.user.id).eq('request_key', body.request_key).maybeSingle();
      if (prior.error) throw new Error('发布请求核对失败');
      if (!prior.data) {
        const info = await creatorInfo(db, body.connection_id, auth.user.id);
        const project = await db.from('video_projects').select('duration')
          .eq('id', body.project_id).eq('user_id', auth.user.id).eq('status', 'completed').maybeSingle();
        if (project.error) throw new Error('成片读取失败');
        const error = capabilityError(info, body.options, project.data?.duration);
        if (error) return reply({ error }, 400);
      }
      const schedule = body.scheduled_at ? new Date(body.scheduled_at) : null;
      if (schedule && (!Number.isFinite(schedule.getTime()) || !prior.data && (schedule.getTime() < Date.now() || schedule.getTime() > Date.now() + 30 * 86400000))) return reply({ error: '定时发布应在未来30天以内' }, 400);
      const { data, error } = await db.rpc('create_platform_publish', {
        p_user_id: auth.user.id, p_request: body.request_key, p_project: body.project_id,
        p_connection: body.connection_id, p_title: body.title, p_description: body.description,
        p_tags: body.tags, p_options: body.options, p_schedule: schedule?.toISOString() || null,
      });
      if (error) return reply({ error: error.message.includes('同一请求') ? '同一请求标识不能用于不同发布' : '发布任务创建失败，请检查作品与授权' }, 409);
      const task = Object.fromEntries(taskFields.split(',').map(field => [field, data[field]]));
      return reply({ task }, 202);
    }
    if (body.action === 'cancel') {
      const result = await db.rpc('cancel_platform_publish', { p_user: auth.user.id, p_task: body.task_id });
      if (result.error) return reply({ error: '只能取消尚未提交的发布任务' }, 409);
      return reply({ ok: true });
    }
    return reply({ error: '操作不支持' }, 400);
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '发布服务不可用' }, 503); }
}
Deno.serve(handlePlatformPublish);
