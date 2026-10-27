import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { loadEdge } from './edge-loader.mjs';

globalThis.crypto ??= webcrypto;
const owner = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', MODEL_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64) };
const imageUrl = `https://db.example/storage/v1/object/authenticated/materials/${owner}/image.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
let handler, state, cipher, settings;
const db = {
  auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: `${imageUrl}?token=test` } }) }) },
  from(table) {
    let slot;
    return {
      select() { return this; }, eq(key, value) { if (key === 'slot') slot = value; return this; },
      gte() { return this; }, order() { return this; },
      insert(row) { state.inserts.push({ table, row }); return this; }, upsert() { return this; },
      update(row) { if (table === 'ai_requests') Object.assign(state.receipt, row); return this; },
      async maybeSingle() {
        if (table === 'credit_costs') return { data: { cost: 0 } };
        if (table === 'user_plans') return { data: { daily_credit_budget: 0 } };
        if (table === 'model_configs') return { data: { enabled: true, current_version_id: 'model-version' } };
        return { data: null };
      },
      async single() {
        return { data: { id: 'model-version', slot, settings: slot === 'reader.primary'
          ? { ...catalog.defaultSettings(slot), endpoint: 'https://reader.example', model: 'web-reader' }
          : { ...settings, supports_vision: state.vision }, key_ciphertext: slot === 'reader.primary' ? null : cipher } };
      },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
    };
  },
  async rpc(name, params) {
    state.rpcs.push({ name, params });
    if (name === 'upsert_rate_limit') {
      if (state.limiterThrows) throw new Error('isolated limiter outage');
      return state.limiterError ? { error: { message: 'isolated limiter outage' } } : { data: true };
    }
    if (name === 'can_read_media') return { data: state.mediaAllowed };
    if (name === 'begin_model_attempt') return { data: params.p_attempt };
    if (name === 'begin_script_request') return { data: state.receipt };
    if (name === 'read_script_request') return { data: state.receipt };
    if (name === 'checkpoint_script_result') {
      if (state.checkpointThrows) throw new Error('checkpoint disconnected');
      if (state.checkpointError) return { error: { message: 'checkpoint offline' } };
      Object.assign(state.receipt, { raw_content: params.p_content, result: params.p_result,
        status: params.p_result ? 'result_ready' : 'invalid' });
      return { data: state.receipt };
    }
    if (name === 'save_script_request') {
      if (state.saveThrows) throw new Error('save disconnected');
      if (state.saveError) return { error: { message: 'save offline' } };
      state.receipt.status = 'completed';
      return { data: state.receipt };
    }
    if (name === 'reject_script_request') {
      state.receipt.status = 'invalid';
      return { data: state.receipt };
    }
    return { data: true };
  },
};
globalThis.__createClient = () => db;
globalThis.Deno = { env: { get: key => env[key] }, resolveDns: async () => ['8.8.8.8'], serve: fn => { handler = fn; } };
const catalog = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'ai-safety-catalog');
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'ai-safety-registry');
settings = { ...catalog.defaultSettings('text.primary'), model: 'configured-vision-model', endpoint: 'https://models.example/v1/chat/completions' };
cipher = await registry.encryptKey('text.primary', 'isolated-model-key');
await loadEdge('supabase/functions/ai-assistant/index.ts', 'ai-safety-handler');

async function invoke(body, options = {}) {
  state = { rpcs: [], inserts: [], fetches: [], vision: true, mediaAllowed: true,
    output: JSON.stringify({ pass: true, result: 'pass', confidence: 0.98, reason: '内容合规' }), ...options };
  globalThis.fetch = async (url, init) => {
    state.fetches.push({ url: String(url), init });
    if (String(url).startsWith(imageUrl)) return new Response(state.badImage ? 'not an image' : png, { headers: { 'content-type': 'image/png' } });
    if (String(url).startsWith('https://reader.example')) return new Response('授权网页中的商品资料。'.repeat(10));
    if (state.networkError) throw new Error('isolated network outage');
    if (state.modelRejected) return new Response('', { status: 400 });
    return Response.json({ choices: [{ message: { content: state.output } }] });
  };
  const response = await handler(new Request('https://db.example/functions/v1/ai-assistant', {
    method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'content_moderation', text: '商品说明', ...body }),
  }));
  return { response, json: await response.json(), state };
}

test('审核拒绝字符串布尔值、缺字段和互相矛盾的判定', async () => {
  for (const output of [
    { pass: 'false', result: 'reject', confidence: .95, reason: '拒绝' },
    { pass: true, result: 'reject', confidence: .95, reason: '矛盾' },
    { pass: false, result: 'pass', confidence: .95, reason: '矛盾' },
    { result: 'pass', confidence: .95, reason: '缺字段' },
    { pass: true, result: 'pass', confidence: '0.95', reason: '错误类型' },
  ]) {
    const { json } = await invoke({}, { output: JSON.stringify(output) });
    assert.equal(json.data.pass, false);
    assert.equal(json.data.result, 'review_pending');
  }
});

test('有效拒绝记录风险，空输入不可标为已审核通过', async () => {
  let result = await invoke({}, { output: JSON.stringify({ pass: false, result: 'reject', confidence: .9, reason: '违规内容', category: 'fraud' }) });
  assert.equal(result.json.data.pass, false);
  assert.equal(result.json.data.result, 'reject');
  assert.ok(result.state.inserts.some(item => item.table === 'risk_events'));
  result = await invoke({ text: '' });
  assert.notEqual(result.json.data?.pass, true);
  assert.equal(result.state.fetches.length, 0);
});

test('图像审核先授权读取实物，视觉输入包含图片和源指纹', async () => {
  const { json, state } = await invoke({ text: '', image_url: imageUrl });
  assert.equal(json.data.pass, true);
  assert.match(json.data.image_sha256, /^[a-f0-9]{64}$/);
  assert.equal(state.rpcs.filter(item => item.name === 'can_read_media').length, 1);
  const calls = state.fetches.filter(item => item.url.startsWith('https://models.example'));
  assert.equal(calls.length, 1);
  const parts = JSON.parse(calls[0].init.body).messages.at(-1).content;
  assert.equal(parts.find(part => part.type === 'image_url').image_url.url, `data:image/png;base64,${png.toString('base64')}`);
});

test('无权限、外部地址、非图片以及未声明视觉能力均不放行', async () => {
  for (const [body, options] of [
    [{ image_url: imageUrl }, { mediaAllowed: false }],
    [{ image_url: 'https://external.example/image.png' }, {}],
    [{ image_url: imageUrl }, { badImage: true }],
    [{ image_url: imageUrl }, { vision: false }],
  ]) {
    const { json, state } = await invoke(body, options);
    assert.notEqual(json.data?.pass, true);
    assert.equal(state.fetches.filter(item => item.url.startsWith('https://models.example')).length, 0);
  }
});

test('持久限流RPC错误或异常返回503且零供应商调用', async () => {
  for (const options of [{ limiterError: true }, { limiterThrows: true }]) {
    const { response, state } = await invoke({}, options);
    assert.equal(response.status, 503);
    assert.equal(state.fetches.length, 0);
    assert.equal(state.rpcs.filter(item => item.name === 'deduct_credits').length, 0);
  }
});

test('付费Reader读取和后续文本各保留真实尝试，GET开始台账先于网络读取', async () => {
  const result = await invoke({ action: 'extract_url_selling_points', url: 'https://shop.example/product?sku=1' },
    { output: '{"selling_points":["轻便","收纳","耐用"]}' });
  assert.equal(result.response.status, 200);
  const attempts = result.state.rpcs.filter(item => item.name === 'begin_model_attempt');
  assert.deepEqual(attempts.map(item => item.params.p_slot), ['reader.primary', 'text.primary']);
  assert.equal(new Set(attempts.map(item => item.params.p_request)).size, 1);
  assert.equal(result.state.fetches[0].init.method, 'GET');
});

test('创建后的脚本模型失败保留原请求ID和unknown回执，重放不重新调用模型', async () => {
  const receipt = { id: crypto.randomUUID(), request_key: crypto.randomUUID(), created: true,
    status: 'started', credits_cost: 0 };
  const body = { action: 'generate_script_four_layer', request_key: receipt.request_key,
    product_name: '通勤包', selling_points: ['耐用'], audience: '通勤者' };
  const original = await invoke(body, { receipt, networkError: true });
  assert.equal(original.response.status, 202);
  assert.equal(original.json.data.request_id, receipt.id);
  assert.equal(original.json.data.status, 'unknown');
  assert.equal(original.state.rpcs.filter(item => item.name === 'refund_credit_charge').length, 0);
  const replay = await invoke(body, { receipt: { ...receipt, created: false }, output: '' });
  assert.equal(replay.json.data.request_id, receipt.id);
  assert.equal(replay.state.fetches.length, 0);
});

const scriptOutput = '```json\n' + JSON.stringify([{ order: 1, scene: '开场', visual: '商品近景',
  dialogue: '通勤包介绍', duration: 3, prompt: 'Product closeup', layer: 'hook' }])
  + '\n```\n```prompt\nProduct video\n```';
const scriptBody = receipt => ({ action: 'generate_script_four_layer', request_key: receipt.request_key,
  product_name: '通勤包', selling_points: ['耐用'], audience: '通勤者' });
const newReceipt = () => ({ id: crypto.randomUUID(), request_key: crypto.randomUUID(),
  script_id: crypto.randomUUID(), created: true, status: 'started', credits_cost: 5, charge_id: crypto.randomUUID() });

test('写入错误和连接异常保留原结果，恢复绕过新任务限流且零模型和退款', async () => {
  for (const options of [{ saveError: true }, { saveThrows: true }]) {
    const receipt = newReceipt();
    const original = await invoke(scriptBody(receipt), { receipt, output: scriptOutput, ...options });
    assert.equal(original.response.status, 202);
    assert.equal(original.json.data.status, 'result_ready');
    assert.equal(original.json.data.full_content, scriptOutput);
    assert.equal(original.state.rpcs.filter(item => item.name === 'refund_credit_charge').length, 0);
    const restored = await invoke({ action: 'recover_script_four_layer', request_id: receipt.id },
      { receipt, limiterError: true });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.json.data.script_id, receipt.script_id);
    assert.equal(restored.state.fetches.length, 0);
    assert.equal(restored.state.rpcs.filter(item => item.name === 'upsert_rate_limit').length, 0);
  }
});

test('检查点失败保留返回原文供核对，明确无效结果不成为成功保存', async () => {
  for (const options of [{ checkpointError: true }, { checkpointThrows: true }]) {
    const receipt = newReceipt();
    const result = await invoke(scriptBody(receipt), { receipt, output: scriptOutput, ...options });
    assert.equal(result.response.status, 202);
    assert.equal(result.json.data.result_persisted, false);
    assert.equal(result.json.data.full_content, scriptOutput);
    assert.equal(result.state.rpcs.filter(item => item.name === 'refund_credit_charge').length, 0);
  }
  const receipt = newReceipt();
  const invalid = await invoke(scriptBody(receipt), { receipt, output: '无有效场景' });
  assert.equal(invalid.response.status, 502);
  assert.equal(invalid.json.data.status, 'invalid');
  assert.equal(invalid.json.data.request_id, receipt.id);
  assert.equal(invalid.state.rpcs.filter(item => item.name === 'save_script_request').length, 0);
});

test('明确上游拒绝和空正文分别补偿原请求，网络未知不进入拒绝RPC', async () => {
  for (const options of [{ modelRejected: true }, { output: '' }]) {
    const receipt = newReceipt();
    const result = await invoke(scriptBody(receipt), { receipt, ...options });
    assert.equal(result.response.status, 502);
    assert.equal(result.json.data.status, 'invalid');
    assert.equal(result.json.data.request_id, receipt.id);
  }
  const receipt = newReceipt();
  const result = await invoke(scriptBody(receipt), { receipt, networkError: true });
  assert.equal(result.response.status, 202);
  assert.equal(result.state.rpcs.filter(item => item.name === 'reject_script_request').length, 0);
});
