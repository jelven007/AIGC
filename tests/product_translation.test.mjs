import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111', version = '22222222-2222-4222-8222-222222222222', key = crypto.randomUUID();
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: 'b'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, resolveDns: async () => ['8.8.8.8'], serve() {} };
const worker = await loadEdge('supabase/functions/_shared/product-translation.ts', 'translation-worker');
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'translation-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'translation-defaults');
const images = await loadEdge('supabase/functions/_shared/intelligence-image.ts', 'translation-images');
const api = await loadEdge('supabase/functions/product-management/index.ts', 'translation-api');
const intelligence = await loadEdge('supabase/functions/market-intelligence/index.ts', 'translation-intelligence');
const cipher = await registry.encryptKey('text.primary', 'server-only-model-key');
const source = { name: '杯子', description: '不锈钢', selling_points: ['500ml'], specs: [{ name: '颜色', value: '白色' }], cover_image: null };
const input = { product_id: key, expected_updated_at: '2026-10-22T00:00:00Z', target_language: 'en', include_image: false, confirmed_credit_cost: 2 };
const output = { translation: { name: 'Cup', description: 'Stainless steel', selling_points: ['500ml'], specs: [{ name: 'Color', value: 'White' }] }, image_text: [] };
let job, events = [], fetches = [], reads = [], rpcs = [], mode = 'success', prior = false, failCompleted = false, failCheckpoint = false;
const db = {
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  from(table) {
    const filters = {};
    return { select() { return this; }, eq(k, v) { filters[k] = v; return this; }, order() { return this; }, limit() { return this; },
      maybeSingle: async () => {
        reads.push({ table, filters });
        return { data: table === 'model_configs' ? { current_version_id: '33333333-3333-4333-8333-333333333333', enabled: true }
          : table === 'credit_costs' ? { cost: 2 } : prior ? { id: key } : null };
      },
      single: async () => {
        reads.push({ table, filters });
        return { data: { id: filters.id, slot: 'text.primary', settings: { ...defaultSettings('text.primary'),
          model: 'original-model', endpoint: 'https://model.example/v1/chat/completions', timeout_ms: 1000 }, key_ciphertext: cipher } };
      },
      then(resolve) { resolve({ data: [job] }); },
    };
  },
  storage: { from: () => ({ createSignedUrl: async path => ({ data: { signedUrl: `https://db.example/storage/v1/object/sign/materials/${path}?token=private` } }) }) },
  rpc: async (name, args) => {
    rpcs.push({ name, args });
    if (name === 'upsert_rate_limit' || name === 'can_read_media') return { data: true };
    if (name === 'claim_production_job') return { data: structuredClone(job) };
    if (name === 'update_production_job') {
      events.push({ event: args.p_event, data: args.p_data });
      if (args.p_event === 'checkpoint' && failCheckpoint) return { error: {} };
      if (args.p_event === 'checkpoint') job.evidence = args.p_data;
      if (args.p_event === 'resolution') job.resolution = args.p_data;
      if (args.p_event === 'completed' && failCompleted) return { error: {} };
      return { data: job };
    }
    if (name === 'create_product_translation') return { data: job };
    if (name === 'save_intelligence_target') return { data: { id: key } };
    throw new Error(name);
  },
};
globalThis.__createClient = () => db;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
globalThis.fetch = async (url, init) => {
  fetches.push({ url: String(url), init });
  if (String(url).startsWith('https://db.example/')) return new Response(png);
  if (mode === 'network') throw new Error('socket lost');
  if (mode === 'rejected') return new Response('', { status: 429 });
  if (mode === 'invalid') return Response.json({ choices: [{ message: { content: '{"translation":{}}' } }] });
  return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
};
const reset = () => {
  events = []; fetches = []; reads = []; rpcs = []; mode = 'success'; prior = false; failCompleted = false; failCheckpoint = false;
  job = { id: key, user_id: uid, request_key: key, kind: 'product_translate', lease_token: crypto.randomUUID(), attempts: 1,
    model_config_version_id: version, evidence: null, resolution: null, payload: { request: input, source, source_hash: 'a'.repeat(64) } };
};
for (const patch of [{ product_id: 'bad' }, { expected_updated_at: 'bad' }, { target_language: 'xx' }, { confirmed_credit_cost: 1.5 }, { include_image: 'false' }]) {
  assert.throws(() => worker.translationRequest({ ...input, ...patch }));
}
for (const patch of [{ translation: { ...output.translation, selling_points: [] } }, { translation: { ...output.translation, specs: [] } },
  { image_text: [{ original: 'fake', translated: 'fake' }] }]) {
  assert.throws(() => worker.translationOutput({ ...output, ...patch }, source, false));
}
console.log('PASS 翻译请求、原字段数量和无图OCR校验');
reset();
await worker.processProductTranslation(db);
assert.equal(fetches.length, 1);
assert.equal(reads.find(read => read.table === 'model_config_versions').filters.id, version);
assert.equal(fetches[0].init.headers.Authorization, 'Bearer server-only-model-key');
const body = JSON.parse(fetches[0].init.body);
assert.match(body.messages[1].content[0].text, /杯子/);
assert.match(body.messages[1].content[0].text, /目标语言：en/);
assert.equal(events.find(event => event.event === 'completed').data.source_hash, 'a'.repeat(64));
assert.equal(events.find(event => event.event === 'completed').data.source_updated_at, input.expected_updated_at);
assert.equal(events.some(event => /products.*save/.test(event.event)), false);
console.log('PASS 真实Worker使用任务原模型版本与商品快照，不修改商品');
reset(); failCompleted = true;
await worker.processProductTranslation(db);
assert.ok(events.some(event => event.event === 'retry'));
failCompleted = false; events = [];
await worker.processProductTranslation(db);
assert.equal(fetches.length, 1); assert.ok(events.some(event => event.event === 'completed'));
reset(); failCheckpoint = true;
await worker.processProductTranslation(db);
assert.equal(fetches.length, 1);
assert.ok(events.some(event => event.event === 'resolution' && event.data.event === 'completed'));
assert.ok(events.some(event => event.event === 'completed'));
console.log('PASS 结果保存和结案中断均恢复归档，不再次调用模型');
for (const [setting, expected] of [['network', 'unknown'], ['invalid', 'failed'], ['rejected', 'failed']]) {
  reset(); mode = setting;
  await worker.processProductTranslation(db);
  assert.ok(events.some(event => event.event === expected), setting);
  assert.equal(events.some(event => event.event === 'retry'), false);
}
console.log('PASS 网络受理未知停止重发，已响应的非法结构与明确拒绝走退款结案');
reset();
job.payload = { ...job.payload, source: { ...source, cover_image: `https://db.example/storage/v1/object/authenticated/materials/${uid}/cup.png` },
  request: { ...input, include_image: true } };
await worker.processProductTranslation(db);
const multimodal = JSON.parse(fetches.find(call => call.url.includes('model.example')).init.body);
assert.match(multimodal.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
assert.match(events.find(event => event.event === 'completed').data.image_hash, /^[a-f0-9]{64}$/);
assert.ok(!multimodal.messages[1].content[1].image_url.url.includes('token=private'));
console.log('PASS 私有主图按5MB上限读取后传图片字节，供应商不获得存储签名凭据');
const imageRef = `https://db.example/storage/v1/object/authenticated/materials/${uid}/cup.png`;
reset();
const hash = await images.imageHash(png);
const checked = await images.readIntelligenceImage(db, imageRef, uid, hash);
assert.equal(checked.type, 'image/png');
await assert.rejects(() => images.readIntelligenceImage(db, imageRef, uid, 'b'.repeat(64)));
assert.throws(() => images.privateImageReference(imageRef.replace(uid, key), uid));
globalThis.fetch = async () => new Response(new Uint8Array(6 * 1024 * 1024));
await assert.rejects(() => images.readIntelligenceImage(db, imageRef, uid, hash), /5MB/);
console.log('PASS 私有图片归属、魔数、内容哈希与流式大小上限');
const req = body => new Request('https://db.example/functions/v1/product-management', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify(body) });
reset(); prior = true;
const response = await api.handleProductManagement(req({ action: 'translate', request_key: key, input }));
assert.equal(response.status, 202);
assert.equal(rpcs.find(call => call.name === 'create_product_translation').args.p_version, null);
assert.equal(reads.some(read => read.table === 'model_configs'), false);
assert.equal((await api.handleProductManagement(req({ action: 'translate', request_key: key, input: { ...input, target_language: 'bad' } }))).status, 400);
const restoredImage = await intelligence.handleIntelligence(req({ action: 'save_target', request_key: key, name: '图片找杯子',
  kind: 'intelligence_products', source_slot: 'intelligence.ebay',
  params: { search_mode: 'image', image_url: `${imageRef.replace('/authenticated/', '/sign/')}?token=expired`, image_hash: hash, market: 'US' } }));
assert.equal(restoredImage.status, 201);
assert.equal(rpcs.find(call => call.name === 'save_intelligence_target').args.p_params.image_url, imageRef);
assert.equal(fetches.length, 0);
console.log('PASS 原请求恢复跳过新配置与失效签名，保持商品或图片参数绑定');
