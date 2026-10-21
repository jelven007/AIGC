// ai-assistant Edge Function — 统一入口，所有 AI action 经此处理
// v2: +积分扣费中间件 +内容审核 +情绪NLP +多语言翻译 +封面生成 +LLM缓存 +持久化限流
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { generateText } from '../_shared/text-provider.ts';
import { resolveModel, validateEndpoint } from '../_shared/model-registry.ts';
import { createImageJob } from '../_shared/production-jobs.ts';
import { boundedText, emotionSegments, structuredText, textList } from '../_shared/structured-analysis.ts';
import { responseBytes } from '../_shared/audio-provider.ts';
import { knowledgeContext, knowledgeMessages } from '../_shared/knowledge.ts';

// 避免 createClient 的泛型 ReturnType 推导为空 schema。
function businessClient(url: string, key: string): SupabaseClient {
  return createClient(url, key);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── 标准化响应 ───────────────────────────────────────────────────────────────
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: 0, message: 'success', data }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function err(message: string, code = 1000, status = 400) {
  return new Response(JSON.stringify({ code, message, data: null }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ─── EF-03: 简易内存速率限制 ─────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(clientId: string, maxReq = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(clientId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxReq) return false;
  entry.count++;
  return true;
}

// ─── P2-M06: 持久化限流（DB-backed，多实例安全）──────────────────────────────
async function checkRateLimitDB(
  supabase: ReturnType<typeof businessClient>,
  clientId: string,
  maxReq = 30,
  windowMs = 60_000,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowKey = `${clientId}:${windowStart}`;
  const resetAt = new Date(windowStart + windowMs).toISOString();

  try {
    // upsert: 若存在则 count++，否则新建
    const { data, error } = await supabase.rpc('upsert_rate_limit', {
      p_window_key: windowKey,
      p_client_id: clientId,
      p_reset_at: resetAt,
      p_max_req: maxReq,
    });
    if (error) return checkRateLimit(clientId, maxReq, windowMs); // 降级到内存
    return Boolean(data);
  } catch {
    return checkRateLimit(clientId, maxReq, windowMs);
  }
}

// ─── P2-N06: LLM 响应缓存（24h TTL + SHA-256 + 命中自增 RPC）────────────────
async function getCachedResponse(
  supabase: ReturnType<typeof businessClient>,
  cacheKey: string,
): Promise<unknown | null> {
  try {
    const { data } = await supabase
      .from('llm_cache')
      .select('response, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (!data) return null;
    if (new Date(data.expires_at) < new Date()) return null;

    // 命中：调用原子自增 RPC increment_llm_cache_hit（安全异步累加）
    supabase.rpc('increment_llm_cache_hit', { p_cache_key: cacheKey }).then(() => {/* noop */});
    return data.response;
  } catch {
    return null;
  }
}

async function setCachedResponse(
  supabase: ReturnType<typeof businessClient>,
  cacheKey: string,
  action: string,
  response: unknown,
  ttlHours = 24,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    await supabase.from('llm_cache').upsert({
      cache_key: cacheKey,
      action,
      response,
      expires_at: expiresAt,
      hit_count: 0,
    }, { onConflict: 'cache_key' });
  } catch { /* 缓存写入失败不影响主流程 */ }
}

async function makeCacheKey(action: string, params: Record<string, unknown>): Promise<string> {
  try {
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonicalize(child)]));
      }
      return value;
    };
    const stable = JSON.stringify(canonicalize(params));
    const encoder = new TextEncoder();
    const data = encoder.encode(`${action}:${stable}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `${action}:${hashHex.slice(0, 32)}`;
  } catch {
    return `${action}:${Date.now().toString(36)}`;
  }
}

// ─── P1-M04: 积分扣费中间件（fail-close 安全审计模型）───────────────────────────
const CACHEABLE_ACTIONS = new Set([
  'generate_selling_points', 'analyze_style', 'analyze_traffic',
  'generate_ab_variants', 'emotion_analysis', 'extract_url_selling_points'
]);

async function deductCredits(
  supabase: ReturnType<typeof businessClient>,
  userId: string,
  action: string,
  confirmedCost?: number,
): Promise<{ allowed: boolean; cost: number; remaining: number; chargeId?: string; error?: string }> {
  if (!userId) return { allowed: false, cost: 0, remaining: 0, error: '缺少认证用户上下文' };

  try {
    // 1. 查询该 action 的基准积分成本
    const { data: costRow, error: costError } = await supabase
      .from('credit_costs')
      .select('cost')
      .eq('action', action)
      .maybeSingle();
    if (costError || !costRow) return { allowed: false, cost: 0, remaining: 0, error: '计费配置暂不可用' };
    const cost = costRow.cost;
    if (confirmedCost !== undefined && confirmedCost !== cost) return { allowed: false, cost, remaining: 0, error: '价格已变化，请刷新后确认' };
    if (cost === 0) return { allowed: true, cost: 0, remaining: 0 };

    // 2. 查询用户套餐与积分状态
    const { data: plan, error: planErr } = await supabase
      .from('user_plans')
      .select('credits_total, credits_used')
      .eq('user_id', userId)
      .maybeSingle();

    if (planErr || !plan) {
      // 商业安全防御：未绑定套餐或查询失败时严格 fail-close
      return { allowed: false, cost, remaining: 0, error: '用户未激活有效套餐或积分查询受阻' };
    }

    const total = plan.credits_total ?? 0;
    const used = plan.credits_used ?? 0;
    const remaining = Math.max(0, total - used);

    if (remaining < cost) {
      return { allowed: false, cost, remaining, error: `积分余额不足（需消耗 ${cost} 积分，当前剩余 ${remaining} 积分）` };
    }

    // 3. 执行原子扣减 RPC (00013 / 00022)
    const { data: charge, error: rpcErr } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: cost,
      p_action: action,
    });

    if (rpcErr || !charge?.ok || !charge?.charge_id) {
      // RPC 报错严格拦截并审计落库，杜绝放行漏洞
      const message = rpcErr?.message || '请先部署资金安全迁移 00028';
      await logError(supabase, action, `扣费 RPC 失败: ${message}`, userId, { cost, remaining });
      return { allowed: false, cost, remaining, error: `积分扣除失败: ${message}` };
    }

    return { allowed: true, cost, remaining: Number(charge.credits_left), chargeId: charge.charge_id };
  } catch (err: any) {
    await logError(supabase, action, `扣费系统异常: ${err?.message}`, userId);
    return { allowed: false, cost: 0, remaining: 0, error: '计费服务暂时异常，请稍后重试' };
  }
}
// 文本生成统一使用服务端方舟/兼容接口配置。
async function callLLM(
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
): Promise<string> {
  const fullMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  return generateText(fullMessages);
}

// ─── AI-02: 平台级系统 Prompt ────────────────────────────────────────────────
const PLATFORM_SYSTEM_PROMPT = `你是「AIGC带货视频平台」的专属AI助手，专门服务于抖音/TikTok电商带货视频的策划、生产与优化。
核心能力：电商文案、视频脚本、分镜策划、流量分析、风格复刻、Prompt工程。
工作原则：
1. 所有输出紧扣「带货转化」目标，以实际效果为导向
2. 熟悉平台算法规则（完播率、互动率、转化率三角模型）
3. 文案简洁有力，字幕友好，适合竖屏移动端观看
4. 优先返回结构化数据（JSON格式），便于前端解析
5. 仅依据资料分析；未读取素材时说明证据缺失，禁止编造指标或产品功效`;

// ─── EF-06: 错误日志写入 ─────────────────────────────────────────────────────
async function logError(
  supabase: ReturnType<typeof businessClient>,
  action: string,
  errorMsg: string,
  userId?: string,
  meta?: Record<string, unknown>,
) {
  try {
    await supabase.from('error_logs').insert({
      user_id: userId ?? null,
      source: 'ai-assistant',
      action,
      error_msg: errorMsg,
      meta: meta ?? {},
    });
  } catch { /* 日志写入失败不影响主流程 */ }
}

// ─── Row 10: 模型调用台账 + 日算力预算护栏 ─────────────────────────────────
async function getActionCost(
  supabase: ReturnType<typeof businessClient>,
  action: string,
): Promise<number> {
  try {
    const { data } = await supabase.from('credit_costs').select('cost').eq('action', action).maybeSingle();
    return data?.cost ?? 0;
  } catch { return 0; }
}

// 返回 { ok, used, budget }；budget<=0 表示不限额。查询异常时不阻断主链路（真实资金门禁由 deductCredits 兜底）
async function checkDailyBudget(
  supabase: ReturnType<typeof businessClient>,
  userId: string,
  cost: number,
): Promise<{ ok: boolean; used: number; budget: number }> {
  if (!userId) return { ok: true, used: 0, budget: 0 };
  try {
    const { data: plan } = await supabase
      .from('user_plans').select('daily_credit_budget').eq('user_id', userId).maybeSingle();
    const budget = plan?.daily_credit_budget ?? 0;
    if (!budget || budget <= 0) return { ok: true, used: 0, budget: 0 };
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data: rows } = await supabase
      .from('model_calls').select('credits_cost')
      .eq('user_id', userId).gte('created_at', startOfDay.toISOString());
    const used = Array.isArray(rows) ? rows.reduce((s, r) => s + (r.credits_cost || 0), 0) : 0;
    return { ok: used + cost <= budget, used, budget };
  } catch {
    return { ok: true, used: 0, budget: 0 };
  }
}

// 写台账（走 SECURITY DEFINER RPC，原子返回当日累计成本）；失败不影响主流程
async function recordModelCall(
  supabase: ReturnType<typeof businessClient>,
  params: {
    userId?: string; action: string; provider?: string; model?: string;
    status: string; latencyMs: number; creditsCost: number; cacheKey?: string; errorMsg?: string;
  },
): Promise<void> {
  try {
    await supabase.rpc('record_model_call', {
      p_user_id: params.userId || null,
      p_action: params.action,
      p_provider: params.provider ?? null,
      p_model: params.model ?? null,
      p_status: params.status,
      p_latency_ms: params.latencyMs,
      p_credits_cost: params.creditsCost,
      p_cache_key: params.cacheKey ?? null,
      p_error_msg: params.errorMsg ?? null,
    });
  } catch { /* 台账写入失败不影响主流程 */ }
}

// ────────────────────────────────────────────────────────────────────────────
// 单一 Deno.serve 入口
// ────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let action = '';
  let userId = '';
  let billedCost = 0;
  let billedChargeId: string | undefined;
  const start = Date.now();

  try {
    // 1. 安全提取与校验 Authorization JWT
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    let authenticatedUserId: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      );
      const { data: authData } = await anonClient.auth.getUser(token);
      if (authData?.user?.id) {
        authenticatedUserId = authData.user.id;
      }
    }

    if (req.method !== 'POST') return err('仅支持POST', 4050, 405);
    const body = await req.json();
    action = body.action ?? '';
    const claimedUserId = body.user_id ?? '';
    // 防伪造审计：强制以真实认证身份为准，严禁无 JWT 时信任 body 传来的 claimedUserId 操纵他人积分或数据
    if (authenticatedUserId) {
      if (claimedUserId && claimedUserId !== authenticatedUserId) {
        await logError(supabase, action, '越权身份伪造警告: body.user_id 与 JWT 不符', authenticatedUserId, { claimedUserId });
        return err('身份标识与认证凭证不符，拒绝访问', 4030, 403);
      }
      userId = authenticatedUserId;
    } else {
      // 未携带有效 JWT 时，不能借由 claimedUserId 冒充他人
      userId = '';
    }

    if (!action) return err('缺少 action 参数', 1001);
    if (!userId) return err('该 AI 能力需要登录授权', 4010, 401);
    body.user_id = userId;
    for (const [field, table] of [['project_id', 'video_projects'], ['product_id', 'products']] as const) {
      if (!body[field]) continue;
      const owned = await supabase.from(table).select('id').eq('id', body[field]).eq('user_id', userId).maybeSingle();
      if (owned.error || !owned.data) return err('关联对象不存在或无权访问', 4031, 403);
    }
    if (['analyze_style', 'extract_highlights'].includes(action)) {
      return err('视频分析已迁移至production-jobs analysis，请上传视频创建后台任务', 4100, 410);
    }
    if (action === 'knowledge_rag_search' && !body.knowledge_job_id) {
      return err('语义检索已迁移至knowledge-base后台任务，请提供完成的knowledge_job_id', 4100, 410);
    }
    if (action === 'analyze_traffic') {
      if (!body.project_id || typeof body.creative_brief !== 'string' || !body.creative_brief.trim() || body.creative_brief.length > 3000
        || !Number.isSafeInteger(body.confirmed_credit_cost) || body.confirmed_credit_cost < 0) return err('请填写创意背景并确认当前积分价格', 4000, 400);
      // 提示词只接收已确认的背景和服务端观测，忽略客户端提交的经营指标。
      const measured = await supabase.rpc('read_measurement_report', { p_user: userId,
        p_since: new Date(Date.now() - 30 * 86400000).toISOString(), p_project: body.project_id });
      if (measured.error) return err('观测服务不可用，暂未发起模型调用', 5030, 503);
      body.observed_metrics = { natural: measured.data.natural_totals, video_count: measured.data.natural_count,
        delivery: measured.data.delivery.slice(0, 20), note: '累计自然视频指标与分源投放分别观察，不能直接推导因果' };
    }
    if (action === 'generate_video' || action === 'retry_video_job') {
      // 旧处理器按客户端 project_id 操作 service_role，且无持久化任务补偿。
      return err('旧视频入口已停用，请使用 video-jobs；确定失败任务由服务端自动退积分', 5031, 503);
    }

    // P1-M04: 计费 action 严格门禁
    const billedActions = new Set([
      'generate_selling_points','optimize_prompt','generate_storyboard',
      'generate_video','analyze_traffic','analyze_style','generate_ab_variants',
      'generate_script_four_layer','extract_highlights','content_moderation',
      'emotion_analysis','translate_script','generate_cover','extract_url_selling_points'
    ]);
    // 封面任务自行以幂等事务预占积分，外层不重复扣费。
    if (action === 'generate_cover') {
      if (!userId) return err('请先登录', 4010, 401);
      if (typeof body.request_key !== 'string') return err('封面后台任务需要 request_key 幂等标识', 4000, 400);
      const requestKey = body.request_key;
      const job = await createImageJob(supabase, userId, requestKey, {
        prompt: body.prompt || `电商带货视频封面：${body.product_name || ''}`, size: '1024x1536', quality: 'auto',
      }, body.project_id);
      return ok({ job, task_id: job.id, status: job.status }, 202);
    }

    // 若属于计费 action，强制必须登录授权
    if (billedActions.has(action)) {
      if (!userId) {
        return err('该 AI 能力需要登录授权，请携带有效的 Authorization 令牌', 4010, 401);
      }
    }

    // P2-M06: 持久化限流（以安全身份为 key，防止伪造）
    const clientId = userId || req.headers.get('x-forwarded-for') || 'anonymous';
    const rateOk = await checkRateLimitDB(supabase, clientId);
    if (!rateOk) return err('请求过于频繁，请稍后再试', 4290, 429);

    // P2-N06: 缓存命中检查（异步高强度 SHA-256）
    let cacheKey = '';
    if (CACHEABLE_ACTIONS.has(action) && userId) {
      const cacheParams = { ...body, user_id: userId, pipeline_version: 2 };
      cacheKey = await makeCacheKey(action, cacheParams);
      const cached = await getCachedResponse(supabase, cacheKey);
      if (cached) {
        await recordModelCall(supabase, { userId, action, status: 'cached', latencyMs: Date.now() - start, creditsCost: 0, cacheKey });
        return ok(cached);
      }
    }

    // 只有通过限流且未命中缓存的请求才扣费。
    if (billedActions.has(action)) {
      const estCost = await getActionCost(supabase, action);
      const budget = await checkDailyBudget(supabase, userId, estCost);
      if (!budget.ok) {
        await recordModelCall(supabase, { userId, action, status: 'blocked', latencyMs: Date.now() - start, creditsCost: 0 });
        return err(`今日 AI 算力预算已达上限（${budget.budget} 积分），请明日再试或联系管理员调整额度`, 4002, 429);
      }
      const charge = await deductCredits(supabase, userId, action, action === 'analyze_traffic' ? body.confirmed_credit_cost : undefined);
      if (!charge.allowed) {
        return err(charge.error || `积分不足（需 ${charge.cost} 积分，当前剩余 ${charge.remaining} 积分）`, 4001, 402);
      }
      billedCost = charge.cost;
      billedChargeId = charge.chargeId;
    }

    let result: unknown;

    switch (action) {
      case 'generate_selling_points':
        result = await generateSellingPoints(body); break;
      case 'optimize_prompt':
        result = await optimizePrompt(body); break;
      case 'generate_storyboard':
        result = await generateStoryboard(body); break;
      case 'analyze_traffic':
        result = await analyzeTraffic(body); break;
      case 'generate_ab_variants':
        result = await generateABVariants(body); break;
      case 'generate_script_four_layer':
        result = await generateScriptFourLayer(body, supabase, userId); break;
      case 'knowledge_rag_search':
        result = await knowledgeRagSearch(body, supabase); break;
      case 'analyze_style_deep':
        result = await analyzeStyleDeep(body); break;
      // ── Phase 1/2 新 actions ────────────────────────────────────────────
      case 'extract_url_selling_points':
        result = await extractUrlSellingPoints(body); break;
      case 'content_moderation':
        result = await contentModeration(body, supabase, userId); break;
      case 'emotion_analysis':
        result = await emotionAnalysis(body, supabase, userId); break;
      case 'translate_script':
        result = await translateScript(body, supabase); break;
      case 'generate_cover':
        throw new Error('封面已迁移到后台任务');
      case 'query_cover_task':
        result = await queryCoverTask(body, supabase); break;
      case 'refund_generation_credits':
        // 视频生成失败退款：仅允许为本账户退款（JWT 强制），非计费 action 不走扣费链
        if (!userId) {
          return err('退款操作需要登录授权，请携带有效的 Authorization 令牌', 4010, 401);
        }
        // 浏览器提供的失败状态/金额无法证明实际失败，统一交由可信任务处理器补偿。
        return err('自动退款需由服务端确认任务失败，当前请联系客服核对', 4091, 409);
      default:
        return err(`未知操作: ${action}`, 1002);
    }

    // 写缓存
    if (cacheKey && result) {
      await setCachedResponse(supabase, cacheKey, action, result);
    }

    await recordModelCall(supabase, { userId, action, status: 'success', latencyMs: Date.now() - start, creditsCost: billedCost, cacheKey: cacheKey || undefined });
    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '服务内部错误';
    console.error(`[ai-assistant][${action}]`, msg);
    if (billedChargeId) {
      const { error: refundError } = await supabase.rpc('refund_credit_charge', {
        p_user_id: userId, p_charge_id: billedChargeId, p_reason: `AI 请求失败：${msg.slice(0, 160)}`,
      });
      if (refundError) {
        console.error('[ai-assistant] 逐笔补偿失败:', refundError.message);
      } else {
        billedCost = 0;
      }
    }
    await logError(supabase, action, msg, userId || undefined);
    await recordModelCall(supabase, { userId, action, status: 'error', latencyMs: Date.now() - start, creditsCost: billedCost, errorMsg: msg });
    return err(msg, 5000, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// action 实现
// ────────────────────────────────────────────────────────────────────────────
async function extractUrlSellingPoints(body: Record<string, string>) {
  const { url } = body;
  if (!url) throw new Error('Missing URL');

  const target = new URL(url);
  const checkedTarget = new URL(target); checkedTarget.search = '';
  await validateEndpoint(checkedTarget.href);
  const config = await resolveModel('reader.primary');
  const readerEndpoint = `${config.settings.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(url)}`;
  
  const readerRes = await fetch(readerEndpoint, {
    method: 'GET',
    headers: {
      ...config.headers,
      'X-Return-Format': 'markdown',
      'X-Timeout': '15',
    },
    redirect: 'error', signal: AbortSignal.timeout(config.settings.timeout_ms),
  });

  if (!readerRes.ok) {
    throw new Error(`Failed to read URL: ${readerRes.status}`);
  }
  const content = new TextDecoder().decode(await responseBytes(readerRes, 2 * 1024 * 1024));
  const truncatedContent = content.slice(0, 15000);
  if (truncatedContent.trim().length < 40) throw new Error('网页正文为空或被限制，请手动提供商品资料');

  // 2. 提取卖点
  const userPrompt = `以下是从商品网页中提取的内容，请你分析并生成3条核心商品卖点：
${truncatedContent}

要求：
1. 每条突出一个独特价值维度（功能/情感/场景/价格）
2. 语言简洁有力，每条15字以内，适合视频字幕
3. 针对抖音/TikTok用户心理，具有情感共鸣
4. 仅输出 JSON，不要其他多余解释。

直接输出JSON，格式：{"selling_points": ["卖点1", "卖点2", "卖点3"]}`;

  const parsed = await structuredText(userPrompt, { content: truncatedContent });
  return { selling_points: textList(parsed.selling_points, 3), source_url: url, read_at: new Date().toISOString() };
}

// ─── 卖点生成 ────────────────────────────────────────────────────────────────
async function generateSellingPoints(body: Record<string, string>) {
  const { product_name, category, description } = body;
  const userPrompt = `商品名称：${product_name}
商品类目：${category}
商品描述：${description ?? '无'}

请生成3条核心卖点，要求：
1. 每条突出一个独特价值维度（功能/情感/场景/价格）
2. 语言简洁有力，每条15字以内，适合视频字幕
3. 针对抖音用户心理，具有情感共鸣
4. 避免"高品质""多功能"等通用词语

直接输出JSON，格式：{"selling_points": ["卖点1", "卖点2", "卖点3"]}`;

  const parsed = await structuredText(userPrompt, { product_name, category, description });
  return { selling_points: textList(parsed.selling_points, 3) };
}

// ─── Prompt 优化 ─────────────────────────────────────────────────────────────
async function optimizePrompt(body: Record<string, string>) {
  const { prompt, product_name, platform, style } = body;
  const userPrompt = `请优化以下AI视频生成 Prompt：

原始Prompt：${prompt}
商品：${product_name}
风格：${style ?? '活力青春'}
平台：${platform === 'tiktok' ? 'TikTok' : '抖音'}（9:16竖屏）

增强：光线/色彩/构图/镜头运动的具体描述；加入平台节奏、字幕样式、转场建议；输出英文Prompt（适合AI视频模型）。
直接输出优化后的英文Prompt：`;

  const optimized = await callLLM([{ role: 'user', content: userPrompt }], PLATFORM_SYSTEM_PROMPT);
  return { optimized_prompt: boundedText(optimized, 12000) };
}

// ─── 分镜生成 ────────────────────────────────────────────────────────────────
async function generateStoryboard(body: Record<string, unknown>) {
  const { product_name, selling_points } = body as Record<string, string | string[]>;
  const pts = Array.isArray(selling_points) ? selling_points : [];
  boundedText(product_name, 200);
  const parsed = await structuredText('依据商品资料创作2–12镜带货分镜，仅使用已有卖点，不编造优惠和功效。返回'
    + '{"shots":[{"type":"镜头用途","description":"画面描述","duration":3,"text_overlay":"字幕","transition":"none|fade"}]}',
    { product_name, selling_points: pts, script: body.script, duration: body.duration });
  if (!Array.isArray(parsed.shots) || parsed.shots.length < 2 || parsed.shots.length > 12) throw new Error('模型未返回有效分镜');
  return { shots: parsed.shots.map((shot: any, index: number) => {
    if (!Number.isFinite(shot.duration) || shot.duration < 1 || shot.duration > 60 || !['none', 'fade'].includes(shot.transition)) throw new Error('分镜时长或转场不正确');
    return { id: crypto.randomUUID(), order: index + 1, type: boundedText(shot.type, 80), description: boundedText(shot.description),
      duration: shot.duration, text_overlay: boundedText(shot.text_overlay, 500), transition: shot.transition };
  }) };
}



// ─── 流量分析预测 ─────────────────────────────────────────────────────────────
async function analyzeTraffic(body: Record<string, unknown>) {
  const parsed = await structuredText('依据创意背景和服务端观测提供1–8条内容优化建议，缺少媒体证据不能断言镜头节奏或字幕已被检测。'
    + '不输出未经实测的点击或完播概率，不保证因果或优化提升。返回'
    + '{"suggestions":[{"type":"duration|subtitle|pacing|bgm|cta","title":"建议","description":"依据参数说明原因","priority":"high|medium|low"}]}',
    { creative_brief: body.creative_brief, observed_metrics: body.observed_metrics });
  if (!Array.isArray(parsed.suggestions) || !parsed.suggestions.length || parsed.suggestions.length > 8) throw new Error('模型未返回优化建议');
  const suggestions = parsed.suggestions.map((item: any) => {
    if (!['duration', 'subtitle', 'pacing', 'bgm', 'cta'].includes(item.type) || !['high', 'medium', 'low'].includes(item.priority)) throw new Error('优化建议类型不正确');
    return { type: item.type, title: boundedText(item.title, 100), description: boundedText(item.description, 1000), priority: item.priority };
  });
  return { completion_rate: null, click_rate: null, suggestions, source: 'content_advice', metrics_available: false };
}

// ─── 风格深度分析（LLM 文字解读，配合 StyleCopyPage）────────────────────────
async function analyzeStyleDeep(body: Record<string, unknown>) {
  const { rhythm, pacing, bgm_type, bgm_mood, subtitle_style, transitions, color_tone, virality_score, dna_fingerprint } = body as Record<string, unknown>;
  const userPrompt = `作为短视频内容分析师，请对以下视频风格数据进行深度解读，给出专业分析和复刻建议（200字以内，自然段落，不要列表）：

DNA指纹：${dna_fingerprint}
节奏：${rhythm} / ${pacing}
BGM：${bgm_type}（${bgm_mood}）
字幕：${subtitle_style}
转场：${Array.isArray(transitions) ? transitions.join('、') : transitions}
色调：${color_tone}
爆款指数：${virality_score}分`;

  const analysis = await callLLM([{ role: 'user', content: userPrompt }], PLATFORM_SYSTEM_PROMPT);
  return { analysis: boundedText(analysis, 5000), source: 'provided_report' };
}

// ─── A/B 变体生成 ────────────────────────────────────────────────────────────
async function generateABVariants(body: Record<string, unknown>) {
  const { product_name, variant_count } = body as Record<string, string | number>;
  const count = Math.min(4, Math.max(2, Number(variant_count) || 2));
  boundedText(product_name, 200);
  const raw = await structuredText(`创作${count}个只改变一个实验变量的电商视频脚本变体，禁止编造产品事实或预测转化数据。返回`
    + '{"variants":[{"name":"版本名称","description":"实验假设","changed_variable":"改变的因素","script":"完整口播脚本","prompt":"英文视频画面提示"}]}', body);
  if (!Array.isArray(raw.variants) || raw.variants.length !== count) throw new Error('模型返回的变体数量不正确');
  return { variants: raw.variants.map((item: any) => ({ id: crypto.randomUUID(), name: boundedText(item.name, 100),
    description: boundedText(item.description, 1000), changed_variable: boundedText(item.changed_variable, 200),
    script: boundedText(item.script, 8000), prompt: boundedText(item.prompt, 8000),
    predicted_cr: null, predicted_ctr: null, product_name, status: 'pending' })) };
}

// ─── EF-04: 四层脚本生成（ScriptPage 后端版本，写入 DB）─────────────────────
async function generateScriptFourLayer(
  body: Record<string, unknown>,
  supabase: ReturnType<typeof businessClient>,
  userId: string,
) {
  const {
    user_id, product_name, category, price_range,
    selling_points, audience, pain_points,
    platform, video_length, product_id,
  } = body as Record<string, string | string[]>;

  const pts = Array.isArray(selling_points) ? selling_points : [String(selling_points)];
  const pains = Array.isArray(pain_points) ? pain_points : [];
  const references = body.knowledge_job_id ? await knowledgeContext(supabase, userId, body.knowledge_job_id) : null;

  // Row 2: 读取启用版本 Prompt 模板，按 userId 稳定哈希分流做 A/B（无模板则降级内置四层 Prompt）
  let templateUsed: { id: string; version: number; variant: string } | null = null;
  let templateExtra = '';
  try {
    const { data: tplRows } = await supabase
      .from('prompt_templates')
      .select('id, content, version, variant')
      .eq('action_key', 'generate_script_four_layer')
      .eq('is_active', true)
      .order('version', { ascending: false })
      .order('variant', { ascending: true });
    if (Array.isArray(tplRows) && tplRows.length > 0) {
      let chosen = tplRows[0];
      if (tplRows.length > 1 && userId) {
        const enc = new TextEncoder().encode(userId);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc));
        chosen = tplRows[digest[0] % tplRows.length];
      }
      templateUsed = { id: chosen.id, version: chosen.version ?? 1, variant: chosen.variant ?? 'A' };
      templateExtra = `\n【当前生效模板 v${chosen.version ?? 1}-${chosen.variant ?? 'A'}】${chosen.content}`;
    }
  } catch { /* 模板读取失败降级为内置四层 Prompt */ }

  const systemPrompt = `你是专业的电商带货视频脚本策划师，精通抖音/TikTok短视频「四层结构」创作：
①卖点层：深度理解商品核心差异化价值
②痛点层：匹配目标用户真实痛点与情感共鸣
③钩子层：设计平台专属的开场钩子与悬念结构（前3秒留存）
④CTA层：构建紧迫感与高转化行动召唤${templateExtra}`;

  const userPrompt = `请基于「四层Prompt工程」为以下商品生成完整带货视频脚本：

【商品信息】
- 名称：${product_name}
- 品类：${category || '未指定'}
- 价格：${price_range || '未指定'}
- 核心卖点：${pts.join('、')}

【用户信息】
- 目标用户：${audience}
- 核心痛点：${pains.length > 0 ? pains.join('、') : '待AI分析'}

【创作要求】
- 目标平台：${platform === 'tiktok' ? 'TikTok（需英文口播）' : '抖音（中文）'}
- 建议时长：${video_length}秒

请输出以下内容：

## 分镜脚本
5个场景的JSON数组（放在 \`\`\`json 代码块中）：
[{"order":1,"scene":"场景名称（含四层标注）","visual":"画面描述（15-30字）","dialogue":"口播台词（20-40字，${platform === 'tiktok' ? '英文' : '中文'}）","duration":3,"prompt":"英文AI生成Prompt（50-80词）","layer":"selling_point|pain_point|hook|cta"}]

## AIGC Prompt
整体视频的详细英文Prompt（150-200词），放在 \`\`\`prompt 代码块中。`;

  try {
    const content = await callLLM(
      [...(references ? knowledgeMessages(references) : []), { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    );

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    const promptMatch = content.match(/```prompt\s*([\s\S]*?)```/);

    let scenes: unknown[] = [];
    let promptText = '';

    if (jsonMatch) {
      try { scenes = JSON.parse(jsonMatch[1].trim()); } catch { /* keep empty */ }
    }
    if (promptMatch) {
      promptText = promptMatch[1].trim();
    } else {
      const section = content.split('## AIGC Prompt')[1];
      if (section) promptText = section.replace(/```.*?```/gs, '').trim();
    }

    // 写入 DB（以认证身份为准，降级用 body.user_id）
    const uid = userId || String(user_id || '');
    if (uid) {
      await supabase.from('scripts').insert({
        user_id: uid,
        product_id: product_id || null,
        title: `${product_name} 四层脚本`,
        platform: platform === 'tiktok' ? 'tiktok' : 'douyin',
        product_name,
        selling_points: pts,
        target_audience: String(audience),
        pain_points: pains,
        scenes,
        prompt_text: promptText,
        full_content: content,
        status: 'draft',
      });
    }

    return { scenes, prompt_text: promptText, full_content: content, prompt_template: templateUsed, knowledge_references: references };
  } catch (e) {
    console.error('generate_script_four_layer failed:', e);
    throw e;
  }
}

// 旧入口只读取已完成任务；Embedding调用和计费均在后台任务中执行。
async function knowledgeRagSearch(
  body: Record<string, unknown>,
  supabase: ReturnType<typeof businessClient>,
) {
  const context = await knowledgeContext(supabase, String(body.user_id), body.knowledge_job_id);
  return { results: context.sources, context };
}



// ─── P1-M05: 内容安全审核（违禁词初筛 + LLM 复核 + fail-close 防御）────────────
const SENSITIVE_KEYWORDS = [
  '博彩', '赌博', '兼职刷单', '六合彩', '毒品', '大麻', '枪支', '弹药',
  '迷药', '催情', '代开发票', '洗钱', '成人色情', '裸聊', '翻墙梯子'
];

// Row 8: 风控命中事件落库（供后台联动审计），写入失败不影响审核主流程
async function writeRiskEvent(
  supabase: ReturnType<typeof businessClient>,
  e: { userId?: string; action: string; decision: string; category?: string | null; matched_kw?: string | null; confidence?: number; snippet?: string; reason?: string },
): Promise<void> {
  try {
    await supabase.from('risk_events').insert({
      user_id: e.userId || null,
      source: 'content_moderation',
      action: e.action,
      decision: e.decision,
      category: e.category ?? null,
      matched_kw: e.matched_kw ?? null,
      confidence: e.confidence ?? null,
      snippet: (e.snippet ?? '').slice(0, 200),
      reason: e.reason ?? '',
    });
  } catch { /* 风控落库失败不影响主流程 */ }
}

async function contentModeration(
  body: Record<string, unknown>,
  supabase: ReturnType<typeof businessClient>,
  userId: string,
) {
  const { text, image_url } = body as { text?: string; image_url?: string };
  const snippet = (text || image_url || '');
  if (!text && !image_url) return { pass: true, result: 'pass', reason: '无待审核内容' };

  // 1. 本地违禁词库毫秒级前置初筛
  if (text) {
    for (const kw of SENSITIVE_KEYWORDS) {
      if (text.includes(kw)) {
        const reason = `内容命中高危违禁关键词「${kw}」`;
        await writeRiskEvent(supabase, { userId, action: 'content_moderation', decision: 'reject', category: 'forbidden_goods', matched_kw: kw, confidence: 1.0, snippet, reason });
        return {
          pass: false,
          result: 'reject',
          confidence: 1.0,
          reason,
          category: 'forbidden_goods'
        };
      }
    }
  }

  // 2. LLM 智能风控语义审核
  const moderationPrompt = `你是内容安全审核员。请审核以下内容是否违规。
违规类型：色情/暴力/赌博/毒品/政治敏感/诈骗/违禁商品/侮辱性言论。
${text ? `\n文本内容：${text}` : ''}${image_url ? `\n图片URL：${image_url}（请根据URL路径描述判断）` : ''}

直接输出JSON（仅JSON）：
{"pass":true,"result":"pass","confidence":0.98,"reason":"内容合规"}
或
{"pass":false,"result":"reject","confidence":0.95,"reason":"包含[违规类型]，具体说明","category":"porn|violence|gambling|drug|political|fraud|forbidden_goods|abuse"}`;

  try {
    const content = await callLLM([{ role: 'user', content: moderationPrompt }]);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const pass = Boolean(parsed.pass);
      const verdict = {
        pass,
        result: parsed.result ?? (pass ? 'pass' : 'reject'),
        confidence: parsed.confidence ?? 0.9,
        reason: parsed.reason ?? '',
        category: parsed.category ?? null
      };
      if (!pass) {
        await writeRiskEvent(supabase, { userId, action: 'content_moderation', decision: 'reject', category: verdict.category, confidence: verdict.confidence, snippet, reason: verdict.reason });
      }
      return verdict;
    }
  } catch (e) {
    console.error('[content_moderation] LLM 审核调用失败:', e);
  }

  // 3. 商业级 fail-close：审核服务异常绝不放行违禁内容
  const reviewReason = '安全审核服务暂时超时或响应异常，为保障平台合规安全，内容已自动拦截并转入人工复核队列';
  await writeRiskEvent(supabase, { userId, action: 'content_moderation', decision: 'review_pending', category: 'system_error', confidence: 0, snippet, reason: reviewReason });
  return {
    pass: false,
    result: 'review_pending',
    confidence: 0.0,
    reason: reviewReason,
    category: 'system_error'
  };
}

// ─── P2-N02: 情绪 NLP 分析 ────────────────────────────────────────────────────
async function emotionAnalysis(
  body: Record<string, unknown>,
  supabase: ReturnType<typeof businessClient>,
  userId: string,
) {
  const { text, sentences, project_id } = body as { text?: string; sentences?: string[]; project_id?: string };
  if (text !== undefined) boundedText(text, 12000);
  const inputSentences: string[] = sentences ?? (text ? text.split(/[\n。！？.!?]/).map(line => line.trim()).filter(Boolean) : []);
  if (!inputSentences.length || inputSentences.length > 200 || inputSentences.some(line => typeof line !== 'string' || !line.trim() || line.length > 2000)) {
    throw new Error('请输入最多12000字、200句的口播文本');
  }

  // Row 4: 结果落库供后续复用（按输入指纹缓存），失败不影响返回
  const persist = async (segments: unknown) => {
    try {
      const enc = new TextEncoder().encode(inputSentences.join('|'));
      const hashHex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc))).map(b => b.toString(16).padStart(2, '0')).join('');
      await supabase.from('emotion_analyses').insert({
        user_id: userId || null, project_id: project_id ?? null,
        source_hash: hashHex.slice(0, 64), segments,
      });
    } catch { /* 落库失败不影响返回 */ }
  };

  const emotionPrompt = `你是专业情绪分析师，专注电商带货视频脚本情绪识别。
分析以下台词句子的情绪类型和强度：
${inputSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

情绪类型：hook(钩子)|pain_point(痛点)|product_intro(产品介绍)|social_proof(社会证明)|promotion(促销紧迫感)|cta(行动号召)|neutral(中性)

直接输出JSON数组（仅JSON）：
[{"index":0,"text":"原文","emotion":"hook","intensity":85,"color":"#f59e0b","suggestion":"优化建议"}]`;

  const raw = await structuredText(emotionPrompt + '\nindex必须从0顺序递增，每句给出建议。', inputSentences);
  const segments = emotionSegments(raw, inputSentences);
  await persist(segments);
  return { segments, source: 'model_analysis', score_basis: '模型编辑建议评分' };
}

// ─── P2-N04: 多语言脚本翻译 ───────────────────────────────────────────────────
async function translateScript(body: Record<string, unknown>, supabase: ReturnType<typeof businessClient>) {
  const { user_id, project_id, text, target_language, source_language = 'zh' } = body as Record<string, string>;
  const LANG_MAP: Record<string, string> = { en: '英语', ja: '日语', ko: '韩语', th: '泰语', ar: '阿拉伯语', fr: '法语', de: '德语' };
  const targetName = LANG_MAP[target_language] ?? target_language;

  const translatePrompt = `请将以下电商带货视频脚本翻译为${targetName}，保持带货营销语气，口语化，本土化处理，保留原文结构：\n\n${text}\n\n直接输出翻译结果，不要任何解释：`;
  try {
    const translated = await callLLM([{ role: 'user', content: translatePrompt }], PLATFORM_SYSTEM_PROMPT);
    if (user_id) {
      await supabase.from('multilang_scripts').upsert({
        project_id: project_id || null, user_id, source_language, target_language,
        original_text: text, translated_text: translated.trim(), status: 'done',
      }, { onConflict: 'project_id,target_language' });
    }
    return { translated: translated.trim(), target_language, source_language };
  } catch (e) { console.error('translate_script failed:', e); throw e; }
}

// ─── P2-N03: 智能封面生成 ─────────────────────────────────────────────────────
// ─── P2-N03: 查询封面任务状态 ─────────────────────────────────────────────────
async function queryCoverTask(body: Record<string, unknown>, supabase: ReturnType<typeof businessClient>) {
  const { task_id, cover_id, user_id } = body as Record<string, string>;
  if (!user_id || (!task_id && !cover_id)) throw new Error('缺少封面标识');
  const query = supabase.from('cover_candidates').select('id,status,image_url,gen_task_id').eq('user_id', user_id);
  const { data, error } = await (cover_id ? query.eq('id', cover_id) : query.eq('gen_task_id', task_id)).maybeSingle();
  if (error || !data) throw new Error('封面不存在或无权查询');
  return { cover_id: data.id, status: data.status, image_url: data.image_url, task_id: data.gen_task_id };
}
