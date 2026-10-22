import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { responseBytes } from '../_shared/audio-provider.ts';
import { productDraft, productImportInput, productText, productUuid, ProductError } from '../_shared/product-contract.ts';
import { signMediaTree, validateMediaTree, canonicalMediaTree } from '../_shared/private-media.ts';
import { publicProductionJob, type ProductionJob } from '../_shared/production-jobs.ts';
import { productScope } from '../_shared/api-scopes.ts';
import { ConfigError } from '../_shared/model-registry.ts';
import { createProductTranslation } from '../_shared/product-translation.ts';
import { workloadPolicy } from '../_shared/workload-policy.ts';

export async function handleProductManagement(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = getCorsHeaders(req), reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  let mutation = false;
  try {
    let raw: string;
    try { raw = new TextDecoder().decode(await responseBytes(new Response(req.body), 1024 * 1024)); }
    catch { return reply({ error: '请求超过1MB或正文读取中断', outcome: 'rejected' }, 400); }
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProductError('商品请求非法');
    const auth = await authenticateRequest(req, productScope(body.action));
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: auth.error || '请先登录', outcome: 'rejected' }, auth.status || 401);
    const uid = auth.user.id, db = createServiceClient();
    const limited = await db.rpc('upsert_rate_limit', { p_window_key: `products:${uid}:${Math.floor(Date.now() / 60000)}`,
      p_client_id: `products:${uid}`, p_reset_at: new Date(Date.now() + 60000).toISOString(), p_max_req: 60 });
    if (limited.error) return reply({ error: '商品限流服务不可用', outcome: 'rejected' }, 503);
    if (!limited.data) return reply({ error: '请求过于频繁', outcome: 'rejected' }, 429);
    if (body.action === 'list') {
      const offset = body.offset ?? 0, limit = body.limit ?? 100;
      if (!Number.isInteger(offset) || offset < 0 || offset > 2000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProductError('分页参数非法');
      let query = db.from('products').select('*', { count: 'exact' }).eq('user_id', uid);
      if (body.search) {
        const search = productText(body.search, 200, true);
        query = query.ilike('name', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
      }
      if (body.category && body.category !== 'all') query = query.eq('category', productText(body.category, 50, true));
      if (body.status && body.status !== 'all') {
        if (!['active', 'inactive', 'draft'].includes(body.status)) throw new ProductError('商品状态非法');
        query = query.eq('status', body.status);
      }
      const sorting: Record<string, [string, boolean]> = { created_at_desc: ['created_at', false], created_at_asc: ['created_at', true],
        price_desc: ['price', false], price_asc: ['price', true], sales_desc: ['sales_count', false] };
      const sort = sorting[body.sort || 'created_at_desc'];
      if (!sort) throw new ProductError('商品排序非法');
      const listed = await query.order(sort[0], { ascending: sort[1], nullsFirst: false }).order('id').range(offset, offset + limit - 1);
      if (listed.error) throw new Error('商品列表读取失败');
      return reply({ products: await signMediaTree(db, listed.data, uid), total: listed.count, offset });
    }
    if (body.action === 'imports' || body.action === 'translations') {
      const listed = await db.from('production_jobs').select('*').eq('user_id', uid).eq('kind', body.action === 'imports' ? 'product_import' : 'product_translate')
        .order('created_at', { ascending: false }).limit(20);
      if (listed.error) throw new Error('商品提取任务读取失败');
      const prices = body.action === 'translations' ? await db.from('credit_costs').select('cost').eq('action', 'generate_product_translate').maybeSingle() : null;
      if (prices && (prices.error || !Number.isInteger(prices.data?.cost) || prices.data!.cost < 0)) throw new Error('翻译计费配置缺失');
      return reply({ jobs: await Promise.all(listed.data.map((job: ProductionJob) => publicProductionJob(db, job))),
        ...(prices ? { cost: prices.data!.cost } : {}) });
    }
    if (body.action === 'translate') {
      mutation = true;
      return reply({ job: await createProductTranslation(db, uid, body.request_key, body.input), outcome: 'accepted' }, 202);
    }
    if (body.action === 'extract') {
      if (!productUuid(body.request_key)) throw new ProductError('提取任务需要有效的请求标识');
      const input = productImportInput(body.input);
      mutation = true;
      const created = await db.rpc('create_product_import', { p_user: uid, p_key: body.request_key, p_input: input });
      if (created.error) throw new Error(created.error.message);
      return reply({ job: await publicProductionJob(db, created.data), outcome: 'accepted' }, 202);
    }
    if (['save', 'delete'].includes(body.action)) {
      if (!productUuid(body.request_key) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw new ProductError('商品操作需要标识及1–100个商品');
      mutation = true;
      const prior = await db.from('product_mutation_receipts').select('request_key').eq('user_id', uid).eq('request_key', body.request_key).maybeSingle();
      if (prior.error) throw new Error('商品原操作核对失败');
      const items = [];
      for (const item of body.items) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || item.id && !productUuid(item.id)
          || body.action === 'delete' && !item.id
          || item.id && (typeof item.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(item.expected_updated_at)))
          || item.import_job_id && !productUuid(item.import_job_id)) throw new ProductError('商品标识或版本非法');
        items.push({ ...(item.id ? { id: item.id, expected_updated_at: item.expected_updated_at } : {}),
          ...(item.import_job_id ? { import_job_id: item.import_job_id } : {}),
          ...(body.action === 'save' ? { draft: productDraft(prior.data ? canonicalMediaTree(item.draft, uid)
            : await validateMediaTree(db, item.draft, uid)) } : {}) });
      }
      mutation = true;
      const changed = await db.rpc('mutate_products', { p_user: uid, p_key: body.request_key, p_action: body.action, p_items: items });
      if (changed.error) throw new Error(changed.error.message);
      if (body.action === 'delete') return reply({ ...changed.data, outcome: 'accepted' });
      const rows = await db.from('products').select('*').eq('user_id', uid).in('id', changed.data.ids);
      if (rows.error) throw new Error('商品已保存，读取回执失败，请恢复原请求');
      return reply({ ...changed.data, products: await signMediaTree(db, rows.data, uid), outcome: 'accepted' });
    }
    throw new ProductError('商品操作不支持');
  } catch (cause) {
    const policy = workloadPolicy(cause);
    if (policy) return reply({ error: policy.message, outcome: 'rejected' }, policy.status);
    const message = cause instanceof Error ? cause.message : '商品服务不可用';
    const conflict = /同一请求标识|已被更新|已导入|更换导入来源|价格已更新|配置已更新/.test(message);
    const rejected = cause instanceof SyntaxError || cause instanceof ProductError || cause instanceof ConfigError || conflict || /积分不足/.test(message)
      || /不存在|无权访问|过期|内容非法|最多2000|队列已满/.test(message);
    return reply({ error: cause instanceof SyntaxError ? 'JSON请求非法' : message,
      outcome: rejected || !mutation ? 'rejected' : 'unknown' }, cause instanceof ConfigError ? 424 : /积分不足/.test(message) ? 402
        : conflict ? 409 : /队列已满|最多2000/.test(message) ? 429
        : /不存在|无权访问/.test(message) ? 404 : rejected ? 400 : 503);
  }
}
Deno.serve(handleProductManagement);
