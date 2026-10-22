import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const jobs = [], submissions = [], errors = [];
  let fail = true, done = false;
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/production-jobs')) {
      if (body.action === 'create') {
        submissions.push(body);
        let job = jobs.find(item => item.request_key === body.request_key);
        if (!job) { job = { id: crypto.randomUUID(), request_key: body.request_key, kind: body.kind, mode: body.input.mode,
          status: 'pending', progress: 0, result: null, credit_cost: body.kind === 'analysis' ? 6 : 0, input: body.input }; jobs.unshift(job); }
        status = fail ? 503 : 202; data = fail ? { error: '创建结果待确认' } : { job };
      } else if (body.action === 'analysis-price') data = { cost: 6 };
      else if (body.action === 'list') data = { jobs: jobs.map(job => done && job.kind === 'analysis' ? {
        ...job, status: 'completed', progress: 100, result: { source_url: job.input.source_url, source_hash: 'a'.repeat(64),
          transcript_summary: '真实商品演示摘要', score_basis: '编辑建议评分，经营数据未接入',
          highlights: [{ start_sec: .4, end_sec: 3.5, title: '真实演示片段', score: 80, reason: '完整演示产品',
            suggested_title: '商品演示', transcript: '真实商品介绍与演示', peak_viewers: null }],
          model_versions: { text: 'text-v1', asr: 'asr-v1' }, evidence: { frame_times: [0, 1, 2, 3], has_audio: true } },
      } : job) };
      else throw new Error('Unexpected action ' + body.action);
    } else if (path.includes('/ai-assistant')) { status = 503; data = { code: 1, message: '模型服务暂时不可用' }; }
    else if (path.includes('/storage/v1/object/materials/')) data = { Key: path.slice('/storage/v1/object/'.length), Id: crypto.randomUUID() };
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/live-highlight`);
  await page.getByRole('heading', { name: '直播高光切片', exact: true }).waitFor();
  assert.equal(await page.getByText('真实演示片段', { exact: true }).count(), 0);
  await page.getByLabel('素材标题', { exact: true }).fill('真实素材回放');
  await page.getByLabel('上传分析视频', { exact: true }).setInputFiles({ name: 'source.mp4', mimeType: 'video/mp4', buffer: Buffer.from('ftyp-local') });
  await page.getByText('已上传：source.mp4', { exact: true }).waitFor();
  const firstSubmission = page.waitForResponse(response => response.url().endsWith('/production-jobs')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'create');
  await page.getByRole('button', { name: '提交直播高光切片任务', exact: true }).click();
  await firstSubmission;
  await page.getByRole('button', { name: '恢复原请求', exact: true }).waitFor();
  await page.reload(); fail = false;
  const recovered = page.waitForResponse(response => response.url().endsWith('/production-jobs')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'create');
  await page.getByRole('button', { name: '恢复原请求', exact: true }).click();
  await recovered;
  await page.getByRole('button', { name: '恢复原请求', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(submissions[0], submissions[1]);
  done = true;
  await page.getByRole('button', { name: '刷新任务', exact: true }).click();
  await page.getByText('真实演示片段', { exact: true }).waitFor();
  await page.getByLabel('选择片段1', { exact: true }).check();
  await page.getByRole('button', { name: '生成所选片段 MP4', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === '生成所选片段 MP4' && button.disabled));
  const render = submissions.at(-1);
  assert.equal(render.kind, 'render'); assert.equal(render.input.tracks[0].sourceStart, .4);
  assert.equal(render.input.duration, 3.1); assert.equal(render.input.ratio, '9:16');
  assert.ok(render.input.tracks[0].url.includes('/authenticated/materials/'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/analysis-mobile.png', fullPage: true });
  console.log('PASS 390px私有上传、创建失联刷新同键恢复、真实时间片段MP4渲染提交');
  await page.goto(`${base}/emotion-analysis`);
  await page.getByLabel('口播脚本', { exact: true }).fill('真实口播，不生成随机结果。');
  await page.getByRole('button', { name: '开始情绪分析', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '模型服务暂时不可用' }).waitFor();
  assert.equal(await page.getByText('带入语音与数字人', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS 口播分析失败保留输入且不显示预置成功结果');
} finally { await browser.close(); }
