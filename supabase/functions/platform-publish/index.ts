import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { collectPlatformMetrics } from '../_shared/platform-jobs.ts';
import { creatorInfo } from '../_shared/platforms.ts';

export async function handlePlatformPublish(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => Response.json(body, { headers, status });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const db = createServiceClient(), body = await req.json();
    if (body.action === 'query') {
      const result = await db.from('publish_tasks').select('*').eq('user_id', auth.user.id).eq('request_key', body.request_key).maybeSingle();
      if (result.error) throw new Error('发布请求核对失败');
      return reply({ task: result.data });
    }
    if (body.action === 'list') {
      const result = await db.from('publish_tasks').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(50);
      if (result.error) throw new Error('发布任务读取失败');
      return reply({ tasks: result.data });
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
      const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
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
        if (!info.privacy_level_options.includes(body.options.privacy_level)) return reply({ error: '可见范围不符合账号权限' }, 400);
      }
      const schedule = body.scheduled_at ? new Date(body.scheduled_at) : null;
      if (schedule && (!Number.isFinite(schedule.getTime()) || !prior.data && (schedule.getTime() < Date.now() || schedule.getTime() > Date.now() + 30 * 86400000))) return reply({ error: '定时发布应在未来30天以内' }, 400);
      const { data, error } = await db.rpc('create_platform_publish', {
        p_user_id: auth.user.id, p_request: body.request_key, p_project: body.project_id,
        p_connection: body.connection_id, p_title: body.title, p_description: body.description,
        p_tags: body.tags, p_options: body.options, p_schedule: schedule?.toISOString() || null,
      });
      if (error) return reply({ error: error.message.includes('同一请求') ? '同一请求标识不能用于不同发布' : '发布任务创建失败，请检查作品与授权' }, 409);
      return reply({ task: data }, 202);
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
