import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { ConfigError } from '../_shared/model-registry.ts';
import { createKnowledgeJob, KNOWLEDGE_KINDS, knowledgeContext, knowledgeInput } from '../_shared/knowledge.ts';
import { publicProductionJob, type ProductionJob } from '../_shared/production-jobs.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

export async function handleKnowledge(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = getCorsHeaders(req);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    if (Number(req.headers.get('content-length') || 0) > 65536) return reply({ error: '请求过大' }, 413);
    let raw: string;
    try { raw = new TextDecoder().decode(await responseBytes(new Response(req.body), 65536)); }
    catch (cause) { return reply({ error: '请求正文为空、超出限制或连接中断' }, cause instanceof Error && cause.message.includes('超过') ? 413 : 400); }
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: '请求参数非法' }, 400);
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录' }, auth.status || 401);
    const db = createServiceClient(), uid = auth.user.id;
    const limit = await db.rpc('upsert_rate_limit', { p_window_key: `knowledge:${uid}:${Math.floor(Date.now() / 60000)}`,
      p_client_id: `knowledge:${uid}`, p_reset_at: new Date(Date.now() + 60000).toISOString(), p_max_req: 90 });
    if (limit.error) return reply({ error: '知识限流服务暂不可用' }, 503);
    if (!limit.data) return reply({ error: '知识请求过于频繁' }, 429);
    if (body.action === 'catalog') {
      if (body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 500)) return reply({ error: '查询参数非法' }, 400);
      const list = await db.rpc('read_knowledge_catalog', { p_user: uid, p_query: body.query || '' });
      const prices = await db.from('credit_costs').select('action,cost').in('action', KNOWLEDGE_KINDS.map(kind => `generate_${kind}`));
      if (list.error || prices.error || prices.data?.length !== 2) throw new Error('知识库或价格读取失败');
      return reply({ entries: list.data, prices: Object.fromEntries(prices.data.map(row => [row.action.replace('generate_', ''), row.cost])) });
    }
    if (body.action === 'create') {
      try { knowledgeInput(body.kind, body.input); }
      catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '知识任务参数非法' }, 400); }
      return reply({ job: await createKnowledgeJob(db, uid, body.kind, body.request_key, body.input) }, 202);
    }
    if (body.action === 'jobs') {
      const list = await db.from('production_jobs').select('*').eq('user_id', uid).in('kind', KNOWLEDGE_KINDS)
        .order('created_at', { ascending: false }).limit(30);
      if (list.error) throw new Error('知识任务读取失败');
      return reply({ jobs: await Promise.all(list.data.map((job: ProductionJob) => publicProductionJob(db, job))) });
    }
    if (body.action === 'context') return reply({ context: await knowledgeContext(db, uid, body.job_id) });
    return reply({ error: '知识操作不支持' }, 400);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '知识服务暂不可用';
    return reply({ error: cause instanceof SyntaxError ? '请求JSON非法' : message },
      cause instanceof ConfigError ? 424 : cause instanceof SyntaxError ? 400
        : /同一请求标识|价格已更新|条目已更新/.test(message) ? 409 : /队列已满/.test(message) ? 429
          : /积分不足/.test(message) ? 402 : /无权|参数|幂等/.test(message) ? 400 : 503);
  }
}
Deno.serve(handleKnowledge);
