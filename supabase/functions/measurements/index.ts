import { authenticateRequest, createServiceClient, hashApiKey } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { encryptKey } from '../_shared/model-registry.ts';
import { isUuid } from '../_shared/measurement-input.ts';
import { experimentStatistics, reportStatistics } from '../_shared/measurement-statistics.ts';
export async function handleMeasurements(req: Request) {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const body = await req.json();
    const read = ['report', 'experiments', 'sources', 'projects', 'advice-price'].includes(body.action);
    const auth = await authenticateRequest(req, read ? 'metrics:read' : undefined);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录' }, auth.status || 401);
    const db = createServiceClient(), uid = auth.user.id;
    const start = Math.floor(Date.now() / 60000) * 60000;
    const limited = await db.rpc('upsert_rate_limit', { p_window_key: `measurement-read:${uid}:${start}`, p_client_id: `measurement-read:${uid}`,
      p_reset_at: new Date(start + 60000).toISOString(), p_max_req: 90 });
    if (limited.error) return reply({ error: '观测限流服务暂不可用' }, 503);
    if (!limited.data) return reply({ error: '报告请求过于频繁，请稍后重试' }, 429);
    if (body.action === 'advice-price') {
      const result = await db.from('credit_costs').select('cost').eq('action', 'analyze_traffic').maybeSingle();
      if (result.error || !result.data) throw new Error('建议价格读取失败');
      return reply({ cost: result.data.cost });
    }
    if (body.action === 'projects') {
      const result = await db.from('video_projects').select('id,title,status,created_at').eq('user_id', uid)
        .order('created_at', { ascending: false }).limit(100);
      if (result.error) throw new Error('作品读取失败');
      return reply({ projects: result.data });
    }
    if (body.action === 'report') {
      if (![7, 30, 90, 365].includes(body.days) || body.project_id !== null && body.project_id !== undefined && !isUuid(body.project_id)) {
        return reply({ error: '报告时间或作品ID不正确' }, 400);
      }
      const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - body.days + 1);
      const result = await db.rpc('read_measurement_report', { p_user: uid, p_since: since.toISOString(), p_project: body.project_id || null });
      if (result.error) throw new Error('报告读取失败');
      return reply({ report: reportStatistics(result.data), days: body.days, since: since.toISOString(), timezone: 'UTC' });
    }
    if (body.action === 'sources') {
      const result = await db.from('measurement_sources').select('id,name,enabled,authorization_reference,created_at')
        .eq('user_id', uid).order('created_at', { ascending: false });
      if (result.error) throw new Error('数据源读取失败');
      return reply({ sources: result.data, admin: auth.user.app_metadata?.role === 'admin' });
    }
    if (body.action === 'source-create' || body.action === 'source-disable') {
      if (auth.user.app_metadata?.role !== 'admin') return reply({ error: '仅平台管理员可登记授权数据源' }, 403);
      if (body.action === 'source-create' && (!isUuid(body.request_key) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100
        || typeof body.authorization_reference !== 'string' || body.authorization_reference.trim().length < 10 || body.authorization_reference.length > 1000
        || typeof body.secret !== 'string' || body.secret.length < 32 || body.secret.length > 256)) return reply({ error: '填写数据源名称、授权依据及至少32字符的签名密钥' }, 400);
      if (body.user_id && !isUuid(body.user_id) || body.action === 'source-disable' && !isUuid(body.id)) return reply({ error: '账户或数据源ID不正确' }, 400);
      const id = body.action === 'source-create' ? body.request_key : body.id;
      const result = await db.rpc('manage_measurement_source', { p_actor: uid, p_user: body.user_id || uid,
        p_data: body.action === 'source-create' ? { action: 'create', id, name: body.name.trim(),
          authorization_reference: body.authorization_reference.trim(), key_ciphertext: await encryptKey(`measurement:${id}`, body.secret),
          key_digest: await hashApiKey(body.secret) }
          : { action: 'disable', id } });
      if (result.error) return reply({ error: '数据源保存失败，请核对管理员权限和目标账户' }, 409);
      return reply({ source: result.data });
    }
    if (body.action === 'experiments') {
      const result = await db.rpc('read_content_experiments', { p_user: uid });
      if (result.error) throw new Error('实验读取失败');
      return reply({ experiments: result.data.map(experimentStatistics) });
    }
    if (body.action === 'experiment-create') {
      const spec = body.specification;
      if (!spec || !isUuid(spec.request_key) || !isUuid(spec.source_id) || typeof spec.title !== 'string' || !spec.title.trim() || spec.title.length > 150
        || !['ctr', 'conversion_per_exposure'].includes(spec.primary_metric) || !Number.isInteger(spec.planned_sample)
        || spec.planned_sample < 100 || spec.planned_sample > 1000000 || typeof spec.ends_at !== 'string' || !Number.isFinite(Date.parse(spec.ends_at))
        || !Array.isArray(spec.variants) || spec.variants.length < 2 || spec.variants.length > 8
        || spec.variants.some((v: any) => !isUuid(v?.project_id) || typeof v.title !== 'string' || !v.title.trim() || v.title.length > 150)) {
        return reply({ error: '实验需2到8个已完成作品、固定请求、主指标、样本量和结束时间' }, 400);
      }
      const result = await db.rpc('manage_content_experiment', { p_user: uid, p_action: 'create', p_data: spec });
      if (result.error) return reply({ error: '实验创建冲突，请核对授权数据源、作品和实验窗口；重试须使用原请求' }, 409);
      return reply({ experiment: result.data }, 201);
    }
    if (['experiment-start', 'experiment-close'].includes(body.action)) {
      if (!isUuid(body.id)) return reply({ error: '实验ID不正确' }, 400);
      const result = await db.rpc('manage_content_experiment', { p_user: uid, p_action: body.action.split('-')[1], p_data: { id: body.id } });
      if (result.error) return reply({ error: '状态变更未确认：启动需有效窗口；结案需窗口结束及24小时回流' }, 409);
      return reply({ experiment: result.data });
    }
    return reply({ error: '观测操作不支持' }, 400);
  } catch { return reply({ error: '观测服务暂不可用，请检查数据库与函数版本' }, 503); }
}
Deno.serve(handleMeasurements);
