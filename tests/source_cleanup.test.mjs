import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEdge } from './edge-loader.mjs';

let values = {};
globalThis.Deno = { env: { get: name => values[name] }, serve() {} };
const { legacyModelConfigs } = await loadEdge('supabase/functions/_shared/model-env-import.ts', 'source-cleanup');

test('历史模型Key不能自动选中第三方演示网关', () => {
  values = {
    OPENAI_NEXT_API_KEY: 'old-account',
    SEEDANCE_MINI_API_KEY: 'old-account',
    WAN3_API_KEY: 'old-account',
    HAPPYHORSE_API_KEY: 'old-account',
    CDANCE_API_KEY: 'old-account',
    GLM_API_KEY: 'old-account',
  };
  assert.deepEqual(legacyModelConfigs(), []);
});

test('管理员提供原账号和明确地址后仍可迁移旧任务所需配置', () => {
  values = { CDANCE_API_KEY: 'account-key', CDANCE_BASE_URL: 'https://gateway.example/v1' };
  const entries = legacyModelConfigs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slot, 'video.Seedance');
  assert.equal(entries[0].settings.endpoint, 'https://gateway.example/v1/video/generations');
  assert.equal(entries[0].settings.query_endpoint, entries[0].settings.endpoint);
});

test('正式供应商协议仍支持从受控配置显式导入', () => {
  values = { ARK_API_KEY: 'account-key', ARK_TEXT_MODEL: 'text-model', ARK_VIDEO_MODEL: 'video-model' };
  const entries = legacyModelConfigs();
  assert.deepEqual(entries.map(item => item.slot), ['text.primary', 'video.ArkSeedance']);
  assert.ok(entries.every(item => new URL(item.settings.endpoint).hostname === 'ark.cn-beijing.volces.com'));
});

test('固定演示账号入口停用且不再执行数据库写入', async () => {
  let handler;
  globalThis.Deno.serve = callback => { handler = callback; };
  await loadEdge('supabase/functions/setup-demo/index.ts', 'source-cleanup-demo');
  const response = handler(new Request('https://backend.example/functions/v1/setup-demo', { method: 'POST' }));
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /已停用/);
});
