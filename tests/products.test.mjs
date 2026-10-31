import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: key => env[key] }, resolveDns: async () => ['8.8.8.8'], serve() {} };
const contract = await loadEdge('supabase/functions/_shared/product-contract.ts', 'products-contract');
const parser = await loadEdge('supabase/functions/_shared/product-import.ts', 'products-import');
const csv = await loadEdge('apps/web/src/lib/productCsv.ts', 'products-csv');
const draft = contract.productDraft({ name: '真实"杯子"\n第二行', category: '家居用品', original_price: '0', stock: '', currency: 'USD' });
assert.equal(draft.original_price, 0); assert.equal(draft.stock, null); assert.equal(draft.sales_count, null);
for (const changes of [{ original_price: '-1' }, { original_price: '12abc' }, { stock: 1.5 }, { stock: true },
  { original_price: '1.999' }, { original_price: 10, sale_price: 11 }, { currency: '' }, { images: ['data:image/png;base64,x'] }]) {
  assert.throws(() => contract.productDraft({ ...draft, ...changes }));
}
assert.equal(csv.parseProductCsv(csv.productCsv([draft]))[0].name, draft.name);
assert.equal(csv.parseProductCsv(csv.productCsv([{ ...draft, description: '描述含,逗号和"引号"\n第二行' }]))[0].description, '描述含,逗号和"引号"\n第二行');
assert.throws(() => csv.parseProductCsv(csv.productCsv([draft]).replace('"0"', '"12abc"')));
assert.match(csv.productCsv([{ ...draft, name: '=cmd' }]), /'=cmd/);
console.log('PASS 空值/零价/金额/币种/数量验证，CSV多行/引号/同模板导入及公式保护');

const html = product => `<html><script type="application/ld+json">${JSON.stringify(product)}</script></html>`;
const product = { '@type': 'Product', name: '真实商品', description: '商家描述', image: '/cup.jpg',
  offers: { '@type': 'Offer', price: '12.90', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } };
const extracted = parser.extractProductHtml(html(product), 'https://shop.example/item');
assert.equal(extracted.draft.original_price, 12.90); assert.equal(extracted.draft.currency, 'USD');
assert.equal(extracted.draft.sale_price, null); assert.equal(extracted.draft.stock, null); assert.deepEqual(extracted.draft.selling_points, []);
assert.deepEqual(extracted.image_urls, ['https://shop.example/cup.jpg']);
assert.throws(() => parser.extractProductHtml('<html>login required</html>', 'https://shop.example'));
assert.throws(() => parser.extractProductHtml(html([product, product]), 'https://shop.example'));
assert.equal(parser.extractProductHtml(html({ ...product, offers: { price: '12.90' } }), 'https://shop.example').draft.original_price, null);
assert.equal(parser.extractProductText('商品名称：确认的杯子\n分享文案').draft.original_price, null);
assert.throws(() => parser.extractProductText('https://shop.example/item'));
console.log('PASS 实际JSON-LD/单商品/原币种，登录页/多商品拒绝，文本只保留真实标题与原文');
const originalFetch = globalThis.fetch; let urls = [];
globalThis.fetch = async (url, options) => {
  urls.push(String(url)); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
  return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
};
await assert.rejects(parser.fetchProductResource('https://shop.example/item?q=cup', 1024, 'text/html'));
assert.equal(urls.length, 1);
globalThis.Deno.resolveDns = async () => ['127.0.0.1'];
await assert.rejects(parser.fetchProductResource('https://shop.example/item', 1024, 'text/html'));
assert.equal(urls.length, 1);
globalThis.Deno.resolveDns = async () => ['8.8.8.8'];
console.log('PASS 商品GET无凭据，DNS内网地址和重定向内网在读取前拒绝');

const uid = '11111111-1111-4111-8111-111111111111', key = crypto.randomUUID();
let rpcs = [], reads = [], failMutation = false, job = null;
const events = [], db = {
  auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
  from(table) {
    const query = { select() { reads.push({ table, filters: {} }); return this; },
      eq(name, value) { reads.at(-1).filters[name] = value; return this; }, in() { return this; }, order() { return this; },
      range() { return this; }, limit() { return this; }, ilike() { return this; },
      maybeSingle: async () => ({ data: null }),
      then(resolve) { resolve({ data: [], count: 0 }); } };
    return query;
  },
  rpc: async (name, args) => {
    rpcs.push({ name, args });
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'mutate_products') return failMutation ? { error: { message: 'database unavailable' } } : { data: { ids: [], count: 0 } };
    if (name === 'claim_production_job') return { data: job };
    if (name === 'update_production_job') { events.push(args); return { data: {} }; }
    if (name === 'create_product_import') return { data: { id: key, user_id: uid, request_key: key, kind: 'product_import', payload: args.p_input } };
    throw new Error(name);
  },
};
globalThis.__createClient = () => db;
const { handleProductManagement } = await loadEdge('supabase/functions/product-management/index.ts', 'products-api');
const request = (body, token = 'user') => new Request('https://db.example/functions/v1/product-management', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
assert.equal((await handleProductManagement(request({ action: 'list' }, 'service'))).status, 401);
assert.equal((await handleProductManagement(request({ action: 'extract', request_key: key, input: { mode: 'url', content: 'http://localhost' } }))).status, 400);
let response = await handleProductManagement(request({ action: 'list', user_id: 'other' }));
assert.equal(response.status, 200); assert.ok(reads.some(read => read.table === 'products' && read.filters.user_id === uid));
failMutation = true;
response = await handleProductManagement(request({ action: 'save', request_key: key, items: [{ draft }] }));
assert.equal(response.status, 503); assert.equal((await response.json()).outcome, 'unknown');
assert.equal(rpcs.find(call => call.name === 'mutate_products').args.p_user, uid);
console.log('PASS 服务端身份/私有分页读取，错误URL拒绝，保存故障503明确受理未知');
job = { id: key, user_id: uid, kind: 'product_import', lease_token: crypto.randomUUID(), attempts: 1,
  payload: { mode: 'text', content: '商品名称：真实杯子\n未经改写的商家资料' } };
await parser.processProductImport(db);
const completion = events.find(event => event.p_event === 'completed').p_data;
assert.equal(completion.draft.name, '真实杯子'); assert.equal(completion.draft.stock, null); assert.match(completion.source.content_hash, /^[a-f0-9]{64}$/);
events.length = 0;
job.evidence = completion;
globalThis.fetch = async () => { throw new Error('recovery must not fetch'); };
await parser.processProductImport(db);
assert.equal(events.some(event => event.p_event === 'completed'), true);
const uploads = [];
db.storage = { from: bucket => ({ upload: async (path, bytes, options) => {
  uploads.push({ bucket, path, bytes, options }); return { data: {} };
} }) };
job = { ...job, evidence: null, payload: { mode: 'url', content: 'https://shop.example/item' } };
events.length = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(options.method, undefined); assert.equal(options.headers.Authorization, undefined);
  return String(url).endsWith('/cup.jpg')
    ? new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), { headers: { 'Content-Type': 'image/png' } })
    : new Response(html(product), { headers: { 'Content-Type': 'text/html' } });
};
await parser.processProductImport(db);
assert.equal(uploads.length, 1); assert.equal(uploads[0].bucket, 'materials');
assert.ok(uploads[0].path.startsWith(`${uid}/products/imports/${key}/`));
assert.equal(uploads[0].options.contentType, 'image/png');
assert.match(events.find(event => event.p_event === 'completed').p_data.draft.cover_image, /\/storage\/v1\/object\/authenticated\/materials\//);
globalThis.fetch = originalFetch;
console.log('PASS 真实Worker文本提取与SHA256来源、已保存证据恢复不重新读取站点');
console.log('PASS 真实Worker读取商品页及图片，魔数确认后按用户路径私有归档');
