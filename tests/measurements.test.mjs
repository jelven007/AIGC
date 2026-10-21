import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111', sid = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  MODEL_CONFIG_ENCRYPTION_KEY: 'd'.repeat(64) };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
let user = { id: uid, app_metadata: {} }, source, limitError = false, saved = [], report;
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) { return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    maybeSingle: async () => ({ data: table === 'measurement_sources' ? source : null }),
    then(resolve) { resolve({ data: table === 'measurement_sources' ? [{ id: sid, name: '授权数据', enabled: true }] : [] }); } }; },
  async rpc(name, args) {
    if (name === 'upsert_rate_limit') return limitError ? { error: { message: 'outage' } } : { data: true };
    if (name === 'ingest_measurement') { saved.push(args); return { data: { accepted: 1 } }; }
    if (name === 'read_measurement_report') { assert.equal(args.p_user, uid); return { data: report }; }
    throw new Error('Unexpected RPC ' + name);
  },
};
globalThis.__createClient = () => db;
const stats = await loadEdge('supabase/functions/_shared/measurement-statistics.ts', 'measurement-stats');
assert.ok(Math.abs(stats.normalTwoSided(1.959963984540054) - .05) < .000001);
assert.ok(Math.abs(stats.normalTwoSided(0) - 1) < .000001);
assert.equal(stats.proportionTest(0, 100, 0, 100), null);
assert.equal(stats.proportionTest(101, 100, 2, 100), null);
assert.ok(stats.proportionTest(10, 100, 30, 100) < .001);
assert.deepEqual(stats.holm([.01, .04, null]), [.03, .08, null]);
assert.deepEqual(stats.wilson(1, 0), null);
assert.equal(stats.ratio(0, 100), 0);
assert.equal(stats.ratio(1, 0), null);
const variant = (id, clicks, assigned = 1000) => ({ id, label: id, title: id, project_id: uid, assigned, impressions: 1000, clicks, conversions: Math.floor(clicks / 10) });
const experiment = { id: 'exp', status: 'closed', primary_metric: 'ctr', planned_sample: 1000, variants: [variant('A', 100), variant('B', 200)] };
let result = stats.experimentStatistics(experiment);
assert.equal(result.variants[1].recommended, true);
assert.equal(result.variants[1].cvr, .1);
assert.equal(result.variants[1].conversion_per_exposure, .02);
assert.equal(result.variants[1].uplift, 1);
for (const patch of [{ status: 'running' }, { planned_sample: 2000 }, { variants: [variant('A', 0), variant('B', 0)] },
  { variants: [variant('A', 100), variant('B', 200, 1001)] }]) {
  result = stats.experimentStatistics({ ...experiment, ...patch });
  assert.equal(result.variants[1].recommended, false);
  assert.equal(result.variants[1].adjusted_p_value, null);
}
console.log('PASS 正确双尾p值、Holm、Wilson、零分母、CVR与实验未结案/缺样本拒绝结论');
report = { natural: [{ view_count: 100, like_count: null, comment_count: 0, share_count: 0 }, { view_count: 200, like_count: 0, comment_count: null, share_count: 1 }],
  delivery: [{ spend_minor: 5000, gmv_minor: 15000, refunds_minor: 1000, impressions: 1000, clicks: 100, conversions: 10 }] };
result = stats.reportStatistics(report);
assert.deepEqual(result.natural_totals.like_count, { value: 0, observed: 1, total: 2 });
assert.equal(result.delivery[0].ctr, .1); assert.equal(result.delivery[0].cvr, .1);
assert.equal(result.delivery[0].roas, 2.8); assert.equal(result.delivery[0].cpa_minor, 500);
assert.equal(result.delivery[0].profit_roi, null);
console.log('PASS 缺失指标覆盖、真实零、加权漏斗、扣退款ROAS、未知利润ROI');
const input = await loadEdge('supabase/functions/_shared/measurement-input.ts', 'measurement-input');
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'measurement-registry');
const secret = 'signing-key-'.repeat(4);
source = { id: sid, key_ciphertext: await registry.encryptKey(`measurement:${sid}`, secret) };
const ingest = await loadEdge('supabase/functions/measurement-ingest/index.ts', 'measurement-ingest');
const body = { action: 'assign', request_key: crypto.randomUUID(), experiment_id: crypto.randomUUID(), unit_hash: 'a'.repeat(64) };
const raw = JSON.stringify(body), now = String(Math.floor(Date.now() / 1000));
const signature = await input.measurementSignature(secret, now, raw);
assert.equal(await input.verifyMeasurementSignature(secret, now, signature, raw), true);
assert.equal(await input.verifyMeasurementSignature(secret, now, signature, raw + ' '), false);
assert.equal(await input.verifyMeasurementSignature(secret, String(Number(now) - 301), signature, raw), false);
const request = (text = raw, sig = signature) => new Request('https://db.example/functions/v1/measurement-ingest', {
  method: 'POST', body: text, headers: { 'x-measurement-source': sid, 'x-measurement-timestamp': now, 'x-measurement-signature': sig },
});
assert.equal((await ingest.handleMeasurementIngest(request())).status, 200);
assert.equal(saved.length, 1); assert.equal(saved[0].p_data.unit_hash, body.unit_hash);
assert.equal((await ingest.handleMeasurementIngest(request(raw + ' '))).status, 401);
assert.equal((await ingest.handleMeasurementIngest(request('x'.repeat(131073)))).status, 413);
limitError = true;
assert.equal((await ingest.handleMeasurementIngest(request())).status, 503);
assert.equal(saved.length, 1);
source = null;
assert.equal((await ingest.handleMeasurementIngest(request())).status, 401);
limitError = false;
console.log('PASS 真实HMAC原始正文、时窗、128KB上限、停用数据源及限流故障不写入');
const api = await loadEdge('supabase/functions/measurements/index.ts', 'measurement-api');
const apiRequest = body => new Request('https://db.example/functions/v1/measurements', {
  method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
assert.equal((await api.handleMeasurements(apiRequest({ action: 'source-create' }))).status, 403);
user = null;
assert.equal((await api.handleMeasurements(apiRequest({ action: 'report', days: 30 }))).status, 401);
user = { id: uid, app_metadata: {} };
assert.equal((await api.handleMeasurements(apiRequest({ action: 'report', days: 10000 }))).status, 400);
const response = await api.handleMeasurements(apiRequest({ action: 'report', days: 30 }));
assert.equal(response.status, 200);
assert.equal((await response.json()).report.delivery[0].roas, 2.8);
assert.throws(() => input.checkMeasurementInput({ action: 'events', request_key: crypto.randomUUID(), experiment_id: sid,
  events: [{ unit_hash: 'plain-user-email', type: 'click', occurred_at: new Date().toISOString() }] }), /格式/);
console.log('PASS JWT用户隔离、仅管理员登记、无效范围与原始用户标识拒绝');
