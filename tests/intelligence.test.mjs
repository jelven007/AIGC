import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'b'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, resolveDns: async () => ['8.8.8.8'], serve() {} };
const version = '22222222-2222-4222-8222-222222222222', uid = '11111111-1111-4111-8111-111111111111';
const id = '33333333-3333-4333-8333-333333333333', channelId = `UC${'a'.repeat(22)}`, videoId = 'abcdefghijk';
let selected = {}, cipher = {}, calls = [], fetches = [], claimed = null, failCompletion = false, user = { id: uid };
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    selected = {};
    return { select() { return this; }, eq(k,v) { selected[k]=v; return this; }, maybeSingle: async () =>
      table === 'model_configs' ? { data: { current_version_id: version, enabled: true } }
        : table === 'intelligence_targets' ? { data: { source_slot: 'intelligence.ebay' } } : { data: null },
    single: async () => ({ data: { id: version, slot: selected.slot, settings: { ...defaults(selected.slot), timeout_ms: 1000 }, key_ciphertext: cipher[selected.slot] } }) };
  },
  rpc: async (name, params) => {
    calls.push({ name, params });
    if (name === 'upsert_rate_limit') return { data: true };
    if (name === 'claim_production_job') return { data: claimed ? structuredClone(claimed) : null };
    if (name === 'update_production_job') {
      if (params.p_event === 'checkpoint') claimed.evidence = params.p_data;
      if (params.p_event === 'completed' && failCompletion) return { error: {} };
      return { data: claimed };
    }
    return { data: claimed };
  },
};
globalThis.__createClient = () => db;
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'intelligence-registry');
const { defaultSettings: defaults } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'intelligence-defaults');
const provider = await loadEdge('supabase/functions/_shared/intelligence-provider.ts', 'intelligence-provider');
const jobs = await loadEdge('supabase/functions/_shared/intelligence-jobs.ts', 'intelligence-jobs');
const { handleIntelligence } = await loadEdge('supabase/functions/market-intelligence/index.ts', 'intelligence-api');
for (const slot of provider.INTELLIGENCE_SLOTS) cipher[slot] = await registry.encryptKey(slot, `private-${slot}`);
const config = slot => ({ slot, version_id: version, settings: { ...defaults(slot), ...(slot === 'intelligence.licensed' ? { endpoint: 'https://licensed.example/v1' } : {}) },
  headers: slot === 'intelligence.youtube' ? { 'x-goog-api-key': 'google-private' } : { Authorization: slot === 'intelligence.ebay' ? 'Basic encoded-app-credentials' : 'Bearer licensed-private' } });
assert.throws(() => provider.intelligenceParams('intelligence_competitor','intelligence.youtube',{ account_id: 'wrong' }));
assert.throws(() => provider.intelligenceParams('intelligence_products','intelligence.ebay',{ query: 'cup',market: 'MY' }));
await assert.rejects(() => registry.validateSettings('intelligence.ebay',{ ...defaults('intelligence.ebay'), endpoint: 'https://api.sandbox.ebay.com/buy/browse/v1' },true));
await assert.rejects(() => registry.validateSettings('intelligence.youtube',{ ...defaults('intelligence.youtube'), auth_header: 'Authorization' },true));
console.log('PASS YouTube账号、eBay市场、正式地址及凭据目的地校验');
const nativeFetch = async (url, init) => {
  fetches.push({ url: String(url), init }); const path = new URL(url).pathname;
  if (path.endsWith('/channels')) return Response.json({ items: [{ id: channelId, snippet: { title: '真实频道' }, statistics: { subscriberCount: '123000' },
    contentDetails: { relatedPlaylists: { uploads: 'UUupload' } } }] });
  if (path.endsWith('/playlistItems')) return Response.json({ items: [{ contentDetails: { videoId } }] });
  if (path.endsWith('/videos')) return Response.json({ items: [{ id: videoId, snippet: { title: '杯子实测', channelId, publishedAt: '2026-10-20T00:00:00Z' },
    statistics: { viewCount: '1000', commentCount: '8' }, contentDetails: { duration: 'PT1M2S' } }] });
  if (path.endsWith('/oauth2/token')) return Response.json({ token_type: 'Bearer', access_token: 'server-only-access' });
  return Response.json({ total: 1, itemSummaries: [{ itemId: 'v1|1|0', title: '真实杯子', price: { value: '12.90',currency: 'USD' },
    seller: { username: 'real-seller' }, itemWebUrl: 'https://www.ebay.com/itm/1' }] });
};
globalThis.fetch = nativeFetch;
const youtube = await provider.collectIntelligence(config('intelligence.youtube'),'intelligence_competitor',{ account_id: '@realchannel' });
assert.equal(fetches.length,3); assert.ok(fetches.every(call => call.init.headers['x-goog-api-key'] === 'google-private' && call.init.redirect === 'error'));
assert.equal(new URL(fetches[0].url).searchParams.get('forHandle'),'@realchannel');
assert.equal(youtube.items[0].duration,62); assert.equal(youtube.items[0].likes,null); assert.equal(youtube.items[0].shares,null);
assert.ok(youtube.source.definition.includes('2025-03-31'));
console.log('PASS YouTube三个官方GET、频道归属、时长转换、缺失统计保留空值和Shorts口径');
fetches=[];
const ebay = await provider.collectIntelligence(config('intelligence.ebay'),'intelligence_products',{ query: 'cup',market: 'GB' });
assert.equal(fetches[0].init.headers.Authorization,'Basic encoded-app-credentials');
assert.equal(fetches[0].url,'https://api.ebay.com/identity/v1/oauth2/token');
assert.equal(fetches[1].init.headers.Authorization,'Bearer server-only-access');
assert.equal(fetches[1].init.headers['X-EBAY-C-MARKETPLACE-ID'],'EBAY_GB');
assert.equal(ebay.items[0].sold_7d,null); assert.equal(ebay.items[0].price,'12.90');
assert.ok(!JSON.stringify(ebay).includes('server-only-access'));
assert.equal(new URL(fetches[1].url).searchParams.get('limit'),'20');
console.log('PASS eBay应用OAuth、市场请求头和Best Match价格，token不进入结果且不捏造销量');
fetches = [];
const imageParams = { search_mode: 'image', image_url: `https://db.example/storage/v1/object/authenticated/materials/${uid}/cup.png`,
  image_hash: 'a'.repeat(64), market: 'US' };
assert.throws(() => provider.intelligenceParams('intelligence_products', 'intelligence.licensed', imageParams));
assert.throws(() => provider.intelligenceParams('intelligence_products', 'intelligence.ebay', { ...imageParams, image_hash: 'bad' }));
await assert.rejects(() => provider.collectIntelligence(config('intelligence.ebay'), 'intelligence_products', imageParams));
const imageSearch = await provider.collectIntelligence(config('intelligence.ebay'), 'intelligence_products', imageParams, new Uint8Array([1, 2, 3]));
assert.equal(fetches.length, 2);
assert.match(fetches[1].url, /\/item_summary\/search_by_image\?/);
assert.equal(fetches[1].init.method, 'POST');
assert.deepEqual(JSON.parse(fetches[1].init.body), { image: 'AQID' });
assert.equal(fetches[1].init.headers.Authorization, 'Bearer server-only-access');
assert.equal(new URL(fetches[1].url).searchParams.get('q'), null);
assert.equal(imageSearch.params.image_hash, imageParams.image_hash);
assert.equal(imageSearch.params.image_url, undefined);
assert.match(imageSearch.source.definition, /图片相似商品/);
console.log('PASS 图片搜索使用正式search_by_image、纯base64正文、原市场与Bearer凭据，拒绝不支持的数据源');
const gatewayBody = { schema: 'intelligence-v1',environment: 'production',licensed: true,platform: 'tiktok',
  observed_at: new Date().toISOString(),metric_definition: '授权平台累计播放，采样非全量',
  account: { id: 'account-1',name: '真实账号',url: 'https://www.tiktok.com/@account1',followers: 1200 },
  items: [{ id: 'video-1',title: '实际视频',url: 'https://www.tiktok.com/@account1/video/1',views: 500 }] };
globalThis.fetch = async () => Response.json(gatewayBody);
const licensed = await provider.collectIntelligence(config('intelligence.licensed'),'intelligence_competitor',{ account_id: 'account-1',platform: 'tiktok' });
assert.equal(licensed.items[0].shares,null);
for (const patch of [{ environment: 'sandbox' }, { licensed: false }, { observed_at: '2020-01-01' }, { account: { ...gatewayBody.account,id: 'forged' } },
  { items: [{ ...gatewayBody.items[0], url: 'https://localhost.local/video' }] }]) {
  globalThis.fetch = async () => Response.json({ ...gatewayBody,...patch });
  await assert.rejects(() => provider.collectIntelligence(config('intelligence.licensed'),'intelligence_competitor',{ account_id: 'account-1',platform: 'tiktok' }));
}
console.log('PASS 授权网关schema/生产环境/账号/时效/链接校验，拒绝演示或伪造来源');
claimed = { id,user_id: uid,kind: 'intelligence_products',payload: { source_slot: 'intelligence.ebay',params: { query: 'cup',market: 'US' },request: { target_id: id } },
  lease_token: id,model_config_version_id: version,evidence: null };
globalThis.fetch = nativeFetch; calls=[]; fetches=[]; failCompletion=true;
await jobs.processIntelligenceJob(db,'intelligence_products');
assert.equal(fetches.length,2); assert.ok(calls.some(call => call.params.p_event==='retry'));
failCompletion=false; calls=[];
await jobs.processIntelligenceJob(db,'intelligence_products');
assert.equal(fetches.length,2); assert.ok(calls.some(call => call.params.p_event==='completed'));
claimed.evidence=null; calls=[]; globalThis.fetch=async () => { throw new Error('socket disconnected'); };
await jobs.processIntelligenceJob(db,'intelligence_products');
assert.ok(calls.some(call => call.params.p_event==='retry')); assert.ok(!calls.some(call => call.params.p_event==='unknown'));
console.log('PASS 已保存来源结果恢复不重复采集，只读网络中断按有限重试恢复');
claimed.attempts=4; calls=[]; fetches=[];
await jobs.processIntelligenceJob(db,'intelligence_products');
assert.equal(fetches.length,0); assert.ok(calls.some(call=>call.params.p_event==='failed'));
console.log('PASS 崩溃后第四次领取直接结案释放，不再调用供应商');
const req = body => new Request('https://db.example/functions/v1/market-intelligence',{ method: 'POST',headers: { Authorization: 'Bearer user' },body: JSON.stringify(body) });
user=null; assert.equal((await handleIntelligence(req({ action: 'catalog',kind: 'intelligence_products' }))).status,401);
user={ id: uid }; assert.equal((await handleIntelligence(req({ action: 'collect',target_id: 'bad',confirmed_credit_cost: 2 }))).status,400);
assert.equal((await handleIntelligence(req({ action: 'save_target',request_key: id,name: '真实账号',kind: 'intelligence_competitor',source_slot: 'intelligence.youtube',params: { account_id: 'bad' } }))).status,400);
assert.equal((await handleIntelligence(new Request('https://db.example',{ method: 'POST',body: '[' })) ).status,400);
console.log('PASS 身份、有限正文、请求JSON与正式业务参数校验');
