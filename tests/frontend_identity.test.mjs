import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';

let owner = 'account-a', calls = [], switchAt = '';
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent ??= class {};
const completed = { id: 'job-a', status: 'completed', result: { url: 'https://media.example/audio.mp3', text: '原账号文本' } };
globalThis.__frontendDB = {
  auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: `token-${owner}` } } }) },
  functions: { invoke: async (name, { body }) => {
    calls.push({ path: name, body, owner });
    if (['video-read', 'product-read'].includes(switchAt)) owner = 'account-b';
    return { data: { job: completed, jobs: [] } };
  } },
  storage: { from: () => ({ upload: async () => {
    calls.push({ path: 'storage', owner });
    if (switchAt === 'upload') owner = 'account-b';
    return { data: { path: 'media' }, error: null };
  } }) },
};
globalThis.fetch = async (url, init = {}) => {
  const path = String(url);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  const tokenOwner = new Headers(init.headers).get('authorization')?.replace('Bearer token-', '');
  calls.push({ path, body, owner: tokenOwner || owner });
  if (path.endsWith('/production-jobs') && body?.action === 'media-prices') {
    if (switchAt === 'price') owner = 'account-b';
    return Response.json({ costs: { tts: 2, asr: 2 } });
  }
  if (path.includes('/storage/v1/object/')) {
    if (switchAt === 'upload') owner = 'account-b';
    return Response.json({ Key: 'uploaded' });
  }
  if (body?.action === 'create' && switchAt === 'create') owner = 'account-b';
  if (path.endsWith('/video-jobs') && switchAt === 'video-read') owner = 'account-b';
  if (path.endsWith('/product-management') && switchAt === 'product-read') owner = 'account-b';
  if (path.endsWith('/knowledge-base') && switchAt === 'json-body') {
    const response = Response.json({ entries: [] });
    response.json = async () => { owner = 'account-b'; return { entries: [] }; };
    return response;
  }
  if (path.endsWith('/material-assets')) {
    if (switchAt === 'register') owner = 'account-b';
    return Response.json({ material: { id: 'material-a', url: 'https://media.example/a.png' } });
  }
  if (path === 'https://media.example/audio.mp3') return new Response(new Uint8Array([1, 2, 3]));
  return Response.json({ job: completed, jobs: [] });
};
const audio = await loadFrontend('apps/web/src/services/audio/index.ts', 'identity-audio');
const video = await loadFrontend('apps/web/src/api/videoJobs.ts', 'identity-video');
const material = await loadFrontend('apps/web/src/api/materialAssets.ts', 'identity-material');
const products = await loadFrontend('apps/web/src/api/products.ts', 'identity-products');
const knowledge = await loadFrontend('apps/web/src/api/knowledge.ts', 'identity-knowledge');
const production = await loadFrontend('apps/web/src/api/productionJobs.ts', 'identity-production');
const intelligence = await loadFrontend('apps/web/src/api/intelligence.ts', 'identity-intelligence');
const batches = await loadFrontend('apps/web/src/api/batchVideoJobs.ts', 'identity-batch');
function reset(at) { owner = 'account-a'; calls = []; switchAt = at; values.clear(); }
const isCreation = call => call.body?.action === 'create';

test('价格读取中切换账号时配音不能提交新账号请求', async () => {
  reset('price');
  await assert.rejects(audio.synthesizeSpeech({ input: '商品台词' }), /账号|会话/);
  assert.equal(calls.filter(isCreation).length, 0);
});
test('ASR上传中切换账号时停止后续价格与创建操作', async () => {
  reset('upload');
  await assert.rejects(audio.transcribeAudio({ file: new File(['audio'], 'voice.wav', { type: 'audio/wav' }) }), /账号|会话/);
  assert.equal(calls.filter(isCreation).length, 0);
});
test('已发送创建请求后切换账号不能清除原账号恢复回执', async () => {
  reset('create');
  await assert.rejects(audio.synthesizeSpeech({ input: '商品台词' }), /账号|会话/);
  assert.equal(calls.filter(isCreation)[0].owner, 'account-a');
  assert.ok(values.has('shopro:media-receipt:account-a'));
  assert.equal(values.has('shopro:media-receipt:account-b'), false);
});
test('视频查询固定原身份且拒绝切换后的迟到响应', async () => {
  reset('video-read');
  await assert.rejects(video.queryServerVideoJob({ job_id: 'job-a' }, 'account-a'), /账号|会话/);
  assert.equal(calls.at(-1).owner, 'account-a');
});
test('素材登记响应期间切换账号保留原上传回执', async () => {
  reset('register');
  values.set('shopro:material-uploads:account-a', JSON.stringify([{ request_key: 'original', input: { name: 'image', content_hash: 'a' } }]));
  const result = await material.recoverMaterialUploads('account-a');
  assert.equal(result.restored, 0);
  assert.equal(result.pending, 1);
  assert.equal(JSON.parse(values.get('shopro:material-uploads:account-a')).length, 1);
});
test('商品事务固定原身份且不接受切换后的保存结果', async () => {
  reset('product-read');
  await assert.rejects(products.productRequest({ action: 'save', request_key: 'original' }, 'account-a'), /账号|会话/);
});
test('解析JSON正文期间切换账号时不将旧知识数据返回新页面', async () => {
  reset('json-body');
  await assert.rejects(knowledge.knowledgeRequest({ action: 'entries' }, 'account-a'), /账号|会话/);
});
test('任务缓存取消后不发出任何旧列表或详情请求', async () => {
  reset('');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(production.listProductionJobs('account-a', controller.signal));
  await assert.rejects(video.queryServerVideoJob({ job_id: 'job-a' }, 'account-a', controller.signal));
  assert.equal(calls.length, 0);
});
test('商品、知识、情报和批次读取取消后均零网络调用', async () => {
  reset('');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(products.productRequest({ action: 'imports' }, 'account-a', controller.signal));
  await assert.rejects(knowledge.knowledgeRequest({ action: 'jobs' }, 'account-a', controller.signal));
  await assert.rejects(intelligence.intelligenceRequest({ action: 'catalog' }, 'account-a', controller.signal));
  await assert.rejects(batches.listBatchVideoJobs('account-a', controller.signal));
  assert.equal(calls.length, 0);
});
test('情报与批次请求在会话切换后拒绝原账号操作且零发送', async () => {
  reset(''); owner = 'account-b';
  await assert.rejects(intelligence.intelligenceRequest({ action: 'collect' }, 'account-a'), /账号|会话/);
  await assert.rejects(batches.createBatchVideoJob('original', {}, 'account-a'), /账号|会话/);
  assert.equal(calls.length, 0);
});
