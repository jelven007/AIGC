import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { validateBatchRequest, prepareBatchItems } from '../_shared/batch-video.ts';
import { providerConfig } from '../_shared/video-providers.ts';
import { signMediaTree } from '../_shared/private-media.ts';
import { pipelineVersions } from '../_shared/batch-pipeline.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

const headers = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function handleBatchVideoJobs(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await responseBytes(new Response(req.body), 512 * 1024))); }
    catch { return reply({ error: '请求格式非法或超过512KB' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: '请求格式非法' }, 400);
    const auth = await authenticateRequest(req, ['quote', 'list', 'query'].includes(body.action) ? 'video:read'
      : body.action === 'create' && body.pipeline ? 'batch:create'
        : ['create', 'pause', 'resume', 'cancel'].includes(body.action) ? 'video:create' : undefined);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录' }, auth.status || 401);
    const db = createServiceClient();
    const snapshot = async (id: string) => {
      const result = await db.rpc('batch_video_snapshot', { p_user_id: auth.user!.id, p_batch_id: id });
      if (result.error) throw new Error('批次状态读取失败');
      return signMediaTree(db, result.data, auth.user!.id);
    };
    if (body.action === 'quote') {
      const { data, error } = await db.from('credit_costs').select('cost').eq('action', 'generate_video').single();
      if (error || !data || !Number.isInteger(data.cost) || data.cost <= 0) return reply({ error: '视频积分价格未配置' }, 503);
      const media = await db.from('credit_costs').select('action,cost').in('action', ['generate_tts', 'generate_edit_subtitles']);
      const costs = Object.fromEntries((media.data || []).map((row: any) => [row.action, row.cost]));
      const ready = !media.error && ['generate_tts', 'generate_edit_subtitles'].every(action =>
        Number.isInteger(costs[action]) && costs[action] >= 0);
      return reply({ unit_cost: data.cost, max_items: 50, max_active_batches: 5,
        pipeline_costs: ready ? { video: data.cost, tts: costs.generate_tts, subtitles: costs.generate_edit_subtitles, render: 0 } : null });
    }
    if (body.action === 'create') {
      if (!uuid(body.request_key)) return reply({ error: '缺少幂等请求标识' }, 400);
      let request;
      try { request = validateBatchRequest(body); }
      catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '批次参数非法' }, 400); }
      // 重试先查持久化批次，不受商品后续修改/删除及模型停用影响。
      const previous = await db.from('batch_jobs').select('id').eq('user_id', auth.user.id)
        .eq('request_key', body.request_key).maybeSingle();
      if (previous.error) return reply({ error: '创建结果未确认，请使用相同请求标识重试' }, 503);
      let items = null, versionId = null, versions = null;
      if (!previous.data) {
        try {
          const config = await providerConfig(request.provider, db);
          versionId = config.versionId;
          if (request.pipeline) versions = await pipelineVersions(db, request, config.versionId);
          items = await prepareBatchItems(db, auth.user.id, request);
        } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '商品或模型配置非法' }, 400); }
      }
      const created = request.pipeline ? await db.rpc('create_batch_pipeline', { p_user: auth.user.id,
        p_key: body.request_key, p_request: request, p_items: items, p_versions: versions })
        : await db.rpc('create_batch_video_jobs', { p_user_id: auth.user.id,
        p_request_key: body.request_key, p_name: request.name, p_provider: request.provider,
        p_request: request, p_items: items, p_config_version: versionId,
        p_expected_unit_cost: request.expected_unit_cost, p_budget: request.budget });
      if (created.error) {
        const message = created.error.message;
        if (message.includes('积分不足')) return reply({ error: message }, 402);
        if (/同一请求标识|价格已更新|模型配置/.test(message)) return reply({ error: message }, 409);
        if (/商品|预算|批次|套餐/.test(message)) return reply({ error: message }, 400);
        console.error('batch create transaction failed', created.error.code);
        return reply({ error: '创建结果未确认，请使用相同请求标识重试' }, 503);
      }
      return reply({ batch: await signMediaTree(db, created.data, auth.user.id) }, 202);
    }
    if (body.action === 'list') {
      const result = await db.from('batch_jobs').select('id').eq('user_id', auth.user.id)
        .order('created_at', { ascending: false }).limit(20);
      if (result.error) return reply({ error: '批次读取失败，请重试' }, 503);
      const batches = [];
      for (const row of result.data || []) batches.push(await snapshot(row.id));
      return reply({ batches });
    }
    if (body.action === 'query') {
      if (!uuid(body.batch_id) && !uuid(body.request_key)) return reply({ error: '缺少批次标识' }, 400);
      const result = await db.from('batch_jobs').select('id').eq('user_id', auth.user.id)
        .eq(uuid(body.batch_id) ? 'id' : 'request_key', uuid(body.batch_id) ? body.batch_id : body.request_key).maybeSingle();
      if (result.error) return reply({ error: '批次读取失败，请重试' }, 503);
      if (!result.data) return reply({ error: '批次不存在' }, 404);
      return reply({ batch: await snapshot(result.data.id) });
    }
    if (['pause', 'resume', 'cancel'].includes(body.action)) {
      if (!uuid(body.batch_id)) return reply({ error: '缺少批次标识' }, 400);
      const result = await db.rpc('control_batch_video', {
        p_user_id: auth.user.id, p_batch_id: body.batch_id, p_action: body.action,
      });
      if (result.error) {
        if (/批次|操作/.test(result.error.message)) return reply({ error: result.error.message }, 409);
        return reply({ error: '操作未确认，请刷新状态后重试' }, 503);
      }
      return reply({ batch: await signMediaTree(db, result.data, auth.user.id) });
    }
    return reply({ error: '不支持的批次操作' }, 400);
  } catch { return reply({ error: '批量任务服务暂时不可用' }, 503); }
}
Deno.serve(handleBatchVideoJobs);
