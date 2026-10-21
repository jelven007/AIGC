import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { ConfigError, resolveModel } from '../_shared/model-registry.ts';
import { responseBytes } from '../_shared/audio-provider.ts';
import { INTELLIGENCE_KINDS, INTELLIGENCE_SLOTS, intelligenceParams, IntelligenceError } from '../_shared/intelligence-provider.ts';
import { createIntelligenceJob, intelligenceUuid } from '../_shared/intelligence-jobs.ts';
import { publicProductionJob, type ProductionJob } from '../_shared/production-jobs.ts';
import { intelligenceScope } from '../_shared/api-scopes.ts';
export async function handleIntelligence(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = getCorsHeaders(req), reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    let raw: string;
    try { raw = new TextDecoder().decode(await responseBytes(new Response(req.body), 16384)); }
    catch { return reply({ error: '请求正文为空、超过16KB或连接中断' }, 400); }
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IntelligenceError('请求参数非法');
    const auth = await authenticateRequest(req, intelligenceScope(body.action));
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录' }, auth.status || 401);
    const uid = auth.user.id, db = createServiceClient();
    const limited = await db.rpc('upsert_rate_limit', { p_window_key: `intelligence:${uid}:${Math.floor(Date.now()/60000)}`,
      p_client_id: `intelligence:${uid}`, p_reset_at: new Date(Date.now()+60000).toISOString(), p_max_req: 60 });
    if (limited.error) return reply({ error: '情报限流服务不可用' }, 503);
    if (!limited.data) return reply({ error: '请求过于频繁' }, 429);
    if (body.action === 'catalog') {
      if (!INTELLIGENCE_KINDS.includes(body.kind)) throw new IntelligenceError('查询类型非法');
      const list = await db.rpc('read_intelligence_catalog', { p_user: uid, p_kind: body.kind });
      const prices = await db.from('credit_costs').select('action,cost').in('action', INTELLIGENCE_KINDS.map(kind => `generate_${kind}`));
      const sources = await db.from('model_configs').select('slot,enabled').in('slot', INTELLIGENCE_SLOTS);
      const jobs = await db.from('production_jobs').select('*').eq('user_id', uid).eq('kind', body.kind).order('created_at', { ascending: false }).limit(30);
      if (list.error || prices.error || prices.data?.length !== 2 || sources.error || jobs.error) throw new Error('情报记录、数据源或价格读取失败');
      return reply({ targets: list.data, sources: sources.data, prices: Object.fromEntries(prices.data.map(row => [row.action.replace('generate_', ''),row.cost])),
        jobs: await Promise.all(jobs.data.map((job: ProductionJob) => publicProductionJob(db, job))) });
    }
    if (body.action === 'save_target') {
      if (!intelligenceUuid(body.request_key) || typeof body.name !== 'string' || !body.name.trim() || body.name.length>200) throw new IntelligenceError('对象名称与标识非法');
      const params = intelligenceParams(body.kind, body.source_slot, body.params);
      const saved = await db.rpc('save_intelligence_target', { p_user: uid, p_key: body.request_key, p_name: body.name,
        p_kind: body.kind, p_slot: body.source_slot, p_params: params });
      if (saved.error) throw new Error(saved.error.message);
      return reply({ target: saved.data }, 201);
    }
    if (body.action === 'collect') return reply({ job: await createIntelligenceJob(db, uid, body.request_key, body.target_id, body.confirmed_credit_cost) }, 202);
    if (body.action === 'schedule') {
      if (!intelligenceUuid(body.request_key) || !intelligenceUuid(body.target_id) || !Number.isInteger(body.runs) || body.runs<0 || body.runs>30
        || !Number.isInteger(body.confirmed_credit_cost) || body.confirmed_credit_cost<0
        || !Number.isInteger(body.budget) || body.budget<0) throw new IntelligenceError('监控次数、预算或标识非法');
      const target = await db.from('intelligence_targets').select('source_slot').eq('id', body.target_id).eq('user_id', uid).maybeSingle();
      if (target.error) throw new Error('监控对象查询失败');
      if (!target.data) throw new IntelligenceError('监控对象不存在或无权访问');
      const prior = await db.from('intelligence_schedule_receipts').select('request_key').eq('user_id', uid).eq('request_key', body.request_key).maybeSingle();
      if (prior.error) throw new Error('监控计划原请求核对失败');
      const config = body.runs && !prior.data ? await resolveModel(target.data.source_slot, db) : null;
      const saved = await db.rpc('schedule_intelligence_target', { p_user: uid, p_target: body.target_id, p_key: body.request_key, p_runs: body.runs,
        p_budget: body.budget, p_cost: body.confirmed_credit_cost, p_version: config?.version_id || null });
      if (saved.error) throw new Error(saved.error.message);
      return reply({ target: saved.data });
    }
    if (body.action === 'delete') {
      if (!intelligenceUuid(body.target_id)) throw new IntelligenceError('对象标识非法');
      const removed = await db.rpc('delete_intelligence_target', { p_user: uid, p_target: body.target_id });
      if (removed.error) throw new Error(removed.error.message);
      return reply({ deleted: true });
    }
    if (body.action === 'import_product') {
      if (!intelligenceUuid(body.sample_id) || typeof body.item_id !== 'string' || !body.item_id || body.item_id.length>100) throw new IntelligenceError('商品来源标识非法');
      const imported = await db.rpc('import_intelligence_product', { p_user: uid, p_sample: body.sample_id, p_item: body.item_id });
      if (imported.error) throw new Error(imported.error.message);
      return reply({ product_id: imported.data });
    }
    throw new IntelligenceError('操作不支持');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '情报服务不可用';
    return reply({ error: cause instanceof SyntaxError ? 'JSON请求非法' : message }, cause instanceof ConfigError ? 424
      : cause instanceof SyntaxError || cause instanceof IntelligenceError ? 400
        : /同一请求标识|已有采集任务|已更新|活跃采集/.test(message) ? 409
          : /队列已满|最多50/.test(message) ? 429 : /积分不足/.test(message) ? 402 : 503);
  }
}
Deno.serve(handleIntelligence);
