import { authenticateRequest, createServiceClient } from './auth.ts';
import { getCorsHeaders, handleCorsPreflight } from './cors.ts';
import { requestTextModel } from './text-provider.ts';
import { knowledgeContext, knowledgeMessages } from './knowledge.ts';
import { withModelContext } from './model-context.ts';

export async function handleTextGeneration(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });
  const auth = await authenticateRequest(req, 'script:generate');
  if (auth.error || !auth.user || auth.isServiceRole) {
    return Response.json({ error: auth.error || '请先登录' }, { status: auth.status || 401, headers });
  }
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 30
    || body.messages.some((message: any) => !message || !['system', 'user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string' || message.content.length > 16000)) {
    return Response.json({ error: '文本请求参数非法' }, { status: 400, headers });
  }
  const temperature = Number(body.temperature ?? 0.7);
  const maxTokens = Number(body.max_tokens ?? 4096);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2
    || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
    return Response.json({ error: '文本生成规格非法' }, { status: 400, headers });
  }
  try {
    const db = createServiceClient();
    // 提示词辅助不扣积分，仍限制每用户每分钟请求次数；视频计费由队列事务负责。
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
    const limit = await db.rpc('upsert_rate_limit', {
      p_window_key: `text:${auth.user.id}:${windowStart}`,
      p_client_id: `text:${auth.user.id}`,
      p_reset_at: new Date(windowStart + 60_000).toISOString(),
      p_max_req: 20,
    });
    if (limit.error || typeof limit.data !== 'boolean') throw new Error('文本限流服务暂不可用');
    if (!limit.data) return Response.json({ error: '请求过于频繁，请稍后重试' }, { status: 429, headers });
    const context = body.knowledge_job_id ? await knowledgeContext(db, auth.user.id, body.knowledge_job_id) : null;
    const messages = context ? [...knowledgeMessages(context), ...body.messages] : body.messages;
    const requestId = crypto.randomUUID();
    const upstream = await withModelContext({ db, userId: auth.user.id, requestId, action: 'text-generation',
      versions: { prompt_pipeline: 3, knowledge_job_id: context?.job_id || null } }, () => requestTextModel(messages, {
      stream: body.stream !== false, temperature, max_tokens: maxTokens,
    }));
    return new Response(upstream.body, {
      headers: { ...headers, 'Content-Type': body.stream === false ? 'application/json' : 'text/event-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': requestId,
        ...(context ? { 'X-Knowledge-Job': context.job_id, 'X-Knowledge-Sources': String(context.sources.length) } : {}) },
    });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : '文本服务暂不可用' }, { status: 503, headers });
  }
}
