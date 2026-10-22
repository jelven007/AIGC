/** 多镜头页面真实操作与原请求恢复，使用隔离业务响应，不调用真实供应商。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEdge } from './edge-loader.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111', product = crypto.randomUUID(), item = crypto.randomUUID();
const publishKey = crypto.randomUUID(), project = crypto.randomUUID();
globalThis.Deno = { env: { get: key => key === 'SUPABASE_URL' ? backend : undefined }, serve() {} };
const { pipelinePayload } = await loadEdge('supabase/functions/_shared/batch-pipeline.ts', 'pipeline-browser-source');
mkdirSync('.volcengine-build', { recursive: true });
execFileSync('docker', ['run', '--rm', '-v', `${resolve('.volcengine-build')}:/fixtures`, '--entrypoint', 'ffmpeg',
  'shoproai-render-worker:local', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x284:r=24:d=10',
  '-c:v', 'libx264', '-movflags', '+faststart', '-y', '/fixtures/pipeline-preview.mp4'], { timeout: 45000 });
const videoBytes = readFileSync('.volcengine-build/pipeline-preview.mp4');
const audioBytes = Buffer.alloc(44 + 16000 * 6.3 * 2);
audioBytes.write('RIFF'); audioBytes.writeUInt32LE(audioBytes.length - 8, 4); audioBytes.write('WAVEfmt ', 8);
audioBytes.writeUInt32LE(16, 16); audioBytes.writeUInt16LE(1, 20); audioBytes.writeUInt16LE(1, 22);
audioBytes.writeUInt32LE(16000, 24); audioBytes.writeUInt32LE(32000, 28); audioBytes.writeUInt16LE(2, 32);
audioBytes.writeUInt16LE(16, 34); audioBytes.write('data', 36); audioBytes.writeUInt32LE(audioBytes.length - 44, 40);
for (let index = 0; index < 16000 * 6.3; index++) audioBytes.writeInt16LE(Math.round(10000 * Math.sin(index / 16000 * Math.PI * 1000)), 44 + index * 2);
const session = { access_token: `header.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'fixture@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(session => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session)), session);
  await context.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (window.__blockBatchReceipt && key.startsWith('shoproai:batch-request:')) throw new DOMException('storage blocked');
      return original.call(this, key, value);
    };
  });
  const creates = [], errors = [], saved = [];
  let fail = true, batch = null, sourceProject = null;
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200, contentType = 'application/json';
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.includes('/storage/v1/object/sign/') && request.method() === 'POST') data = { signedURL: path.replace('/storage/v1', '') + '?token=fixture' };
    else if (path.includes('/storage/v1/object/')) {
      contentType = path.endsWith('.wav') ? 'audio/wav' : 'video/mp4';
      data = path.endsWith('.wav') ? audioBytes : videoBytes;
    }
    else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'video.Wan3', category: 'video', provider: 'Wan3', name: 'Wan3', enabled: true }] };
    else if (path.endsWith('/batch-video-jobs')) {
      if (body.action === 'quote') data = { unit_cost: 10, pipeline_costs: { video: 10, tts: 2, subtitles: 3, render: 0 }, max_items: 50 };
      if (body.action === 'list') data = { batches: batch ? [batch] : [] };
      if (body.action === 'create') {
        creates.push(body); status = fail ? 503 : 202;
        batch ||= { id: crypto.randomUUID(), name: body.name, provider: 'Wan3', pipeline: body.pipeline, status: 'awaiting_publish',
          created_at: new Date().toISOString(), total_count: 1, completed_count: 0, failed_count: 0, cancelled_count: 0,
          attention_count: 0, reserved_credits: 0, settled_credits: 25, refunded_credits: 0, progress: 85,
          items: [{ id: item, project_id: project, product_name: '移动端多镜头商品', status: 'awaiting_publish',
            needs_attention: false, video_url: `${backend}/storage/v1/object/authenticated/materials/${uid}/final.mp4`,
            stages: ['video', 'video', 'tts', 'subtitles', 'render', 'publish'].map((kind, position) => ({
              id: `${kind}-${position}`, kind, position, status: kind === 'publish' ? 'awaiting_confirmation' : 'completed',
              request_key: kind === 'publish' ? publishKey : crypto.randomUUID(), credit_cost: position < 2 ? 10 : position === 2 ? 2 : position === 3 ? 3 : 0,
              billing_state: position < 4 ? 'settled' : 'free',
            })) }] };
        data = fail ? { error: '创建结果未确认' } : { batch };
        const mediaUrl = name => `${backend}/storage/v1/object/authenticated/materials/${uid}/${name}`;
        const spec = pipelinePayload({ kind: 'render', request: body, product_name: '移动端多镜头商品' }, [
          ...[0, 1].map(position => ({ id: `shot-${position}`, position, kind: 'video', result: { video_url: mediaUrl(`shot-${position}.mp4`) } })),
          { id: 'voice', kind: 'tts', result: { url: mediaUrl('voice.wav') } },
          { id: 'subtitle', kind: 'subtitles', result: { duration: 6.3,
            segments: [{ start: .2, end: 2.7, text: '实际字幕甲' }, { start: 3.1, end: 6.2, text: '实际字幕乙' }] } },
        ], backend);
        sourceProject ||= { id: project, title: spec.title, user_id: uid, status: 'completed', duration: 10,
          video_url: mediaUrl('final.mp4'), thumbnail_url: null, materials: [],
          style_data: { ...spec, editorAspect: 'aspect-[9/16]', appliedTrans: 'none', edit_mode: true } };
      }
    } else if (path.endsWith('/production-jobs')) data = { jobs: [] };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    else if (path.includes('/rest/v1/video_projects')) {
      if (request.method() === 'PATCH') { saved.push(body); Object.assign(sourceProject, body); data = sourceProject; }
      else data = new URL(request.url()).searchParams.has('id') ? sourceProject : [];
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '本地测试', role: 'user' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 1000, credits_used: 0, plans: { name: '专业版' } };
    else if (path.includes('/rest/v1/products')) data = [{ id: product, name: '移动端多镜头商品', category: '商品', price: 50 }];
    await route.fulfill({ status, contentType, body: contentType === 'application/json' ? JSON.stringify(data) : data,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/batch-create`);
  await page.getByRole('checkbox', { name: '启用多镜头配音与合成', exact: true }).check();
  await page.getByRole('button', { name: '添加商品', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择移动端多镜头商品', exact: true }).check();
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '确认预算并创建批次' }).isEnabled(), false);
  await page.getByLabel('供应商音色ID', { exact: true }).fill('alloy');
  await page.getByLabel('目标语言配音正文（必填）', { exact: true }).fill('真实商品介绍，用户确认的配音台词。');
  await page.getByLabel('交付方式', { exact: true }).selectOption('publish');
  await page.getByText('单个商品 25 积分 · 本批预占 25 积分', { exact: true }).waitFor();
  await page.evaluate(() => { window.__blockBatchReceipt = true; });
  await page.getByRole('button', { name: '确认预算并创建批次' }).click();
  await page.getByText('无法保存提交回执，请允许会话存储后再提交', { exact: true }).waitFor();
  assert.equal(creates.length, 0);
  await page.evaluate(() => { window.__blockBatchReceipt = false; });
  await page.getByRole('button', { name: '确认预算并创建批次' }).click();
  await page.getByRole('button', { name: '恢复上次提交' }).waitFor();
  assert.equal(creates[0].pipeline.shots.length, 2);
  assert.equal(creates[0].overrides[product].narration, '真实商品介绍，用户确认的配音台词。');
  assert.equal(creates[0].expected_unit_cost, 25);
  await page.reload(); fail = false;
  await page.getByRole('button', { name: '恢复上次提交' }).click();
  await page.getByRole('link', { name: '预览并确认发布' }).waitFor();
  assert.deepEqual(creates[1], creates[0]);
  const link = page.getByRole('link', { name: '预览并确认发布' });
  const href = new URL(await link.getAttribute('href'), base);
  assert.equal(href.searchParams.get('batchItemId'), item);
  assert.equal(href.searchParams.get('batchRequestKey'), publishKey);
  assert.equal(href.searchParams.get('projectId'), project);
  await page.getByText('发布 · 等待预览确认', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '商品视频批次', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.volcengine-build/pipeline-mobile.png', fullPage: true });
  console.log('PASS 多镜头必填/价格、回执存储失败不提交、503刷新同UUID与预算、真实成片/原发布标识和390px');
  await page.getByRole('link', { name: '打开工程', exact: true }).click();
  await page.getByText('移动端多镜头商品 · 镜头1', { exact: true }).first().waitFor();
  await page.getByText('移动端多镜头商品 · 配音', { exact: true }).first().waitFor();
  await page.getByText('实际字幕甲', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByText('剪辑项目已成功保存', { exact: true }).waitFor();
  assert.equal(saved.at(-1).style_data.editorAspect, 'aspect-[9/16]');
  assert.equal(saved.at(-1).style_data.tracks.length, 5);
  assert.ok(saved.at(-1).style_data.tracks.every(track => typeof track.name === 'string' && track.name));
  await page.reload();
  await page.getByText('移动端多镜头商品 · 镜头2', { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS 实际合成协议回填编辑器、镜头/配音/字幕标签、9:16画幅及保存刷新恢复');
} finally { await browser.close(); }
