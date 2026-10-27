import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', projectId = '22222222-2222-4222-8222-222222222222';
const media = `${backend}/storage/v1/object/authenticated/materials/${uid}/sample.mp4`;
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-crashpad-for-testing', '--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
const contexts = [];
async function fixture() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  contexts.push(context);
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const tracks = [
    { id: 'main', type: 'video', trackId: 'video', name: '商品主视频', start: 0, duration: 6, sourceStart: 3, speed: 1.5, url: media },
    { id: 'voice', type: 'audio', trackId: 'audio', name: '原音轨', start: 1, duration: 4, sourceStart: 1, speed: 2, url: media },
  ];
  const state = { created: [], saved: [], jobs: [], errors: [], loseCreate: false,
    project: { id: projectId, user_id: uid, title: '实际音轨工程', status: 'draft', duration: 6,
      video_url: null, thumbnail_url: null, materials: [], style_data: { duration: 6, tracks } } };
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200, type = 'application/json';
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.includes('/storage/v1/object/sign/') && req.method() === 'POST') data = { signedURL: `/object/sign/materials/${uid}/sample.mp4?token=fixture` };
    else if (path.includes('/storage/v1/object/')) { type = 'video/mp4'; data = ''; }
    else if (path.endsWith('/production-jobs')) {
      if (body.action === 'list') data = { jobs: [] };
      else if (body.action === 'edit-prices') data = { costs: { beats: 0, subtitles: 3 } };
      else if (body.action === 'query') {
        const job = state.jobs.find(item => item.id === body.job_id || item.request_key === body.request_key);
        if (job) data = { job }; else { status = 404; data = { error: '任务不存在' }; }
      } else if (body.action === 'create') {
        state.created.push(body);
        const job = { id: crypto.randomUUID(), kind: body.kind, request_key: body.request_key, project_id: projectId,
          status: 'completed', progress: 100, edit_mode: body.input.mode, edit_source: body.input.source, edit_request: body.input,
          result: { mode: body.input.mode, source: body.input.source, source_hash: 'a'.repeat(64), duration: body.input.source?.duration,
            ...(body.input.mode === 'beats' ? { beats: [.3, .9, 1.5], bpm: null, confidence: .9 }
              : { segments: [{ start: .2, end: .8, text: '实际第一句' }, { start: 1.1, end: 2.3, text: '实际第二句' }] }) } };
        state.jobs.push(job);
        if (state.loseCreate) { state.loseCreate = false; status = 503; data = { error: '创建响应待确认' }; } else data = { job };
      }
    } else if (path.includes('/rest/v1/video_projects')) {
      if (req.method() === 'PATCH') { state.saved.push(body); Object.assign(state.project, body); data = [state.project]; }
      else data = new URL(req.url()).searchParams.has('id') ? [state.project] : [];
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: type, body: type === 'application/json' ? JSON.stringify(data) : data,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => state.errors.push(error.message));
  state.page = page; return state;
}
async function open(page, tool) {
  await page.getByRole('button', { name: 'AI工具 (I)', exact: true }).click();
  await page.getByRole('button', { name: tool, exact: true }).click();
  await page.getByLabel('分析源片段', { exact: true }).selectOption('voice');
}
try {
  const subtitle = await fixture(), page = subtitle.page;
  subtitle.loseCreate = true;
  await page.goto(`${base}/video/edit?importId=${projectId}`);
  await page.getByText('实际音轨工程', { exact: true }).first().waitFor();
  await open(page, '时间分段字幕');
  const lostResponse = page.waitForResponse(response => response.url().endsWith('/production-jobs')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'create' && response.status() === 503);
  await page.getByRole('button', { name: '确认价格并分析', exact: true }).click();
  await lostResponse;
  await page.reload();
  await open(page, '时间分段字幕');
  await page.getByRole('button', { name: '应用原任务结果并保存', exact: true }).click();
  await page.getByText('分析结果已应用并保存到工程', { exact: true }).waitFor();
  assert.equal(subtitle.created.length, 1);
  const request = subtitle.created[0];
  assert.equal(request.input.confirmed_credit_cost, 3); assert.equal(request.project_id, projectId);
  assert.equal(request.input.source.sourceStart, 1); assert.equal(request.input.source.speed, 2);
  assert.ok(!request.input.source.url.includes('token='));
  const items = subtitle.saved.at(-1).style_data.tracks.filter(track => track.type === 'text');
  assert.equal(items[0].start, 1.2); assert.equal(items[0].duration, .6000000000000001);
  assert.equal(items[1].start, 2.1); assert.equal(items[1].text, '实际第二句');
  await page.reload();
  await open(page, '时间分段字幕');
  await page.getByRole('button', { name: '应用原任务结果并保存', exact: true }).click();
  await page.getByRole('alert').getByText('原任务字幕已应用，无需重复添加', { exact: true }).waitFor();
  assert.equal(subtitle.created.length, 1);
  console.log('PASS 字幕原请求响应丢失/刷新恢复、价格/裁剪/速度、真实时间偏移和重复应用拒绝');

  const beat = await fixture(), beatPage = beat.page;
  await beatPage.goto(`${base}/video/edit?importId=${projectId}`);
  await beatPage.getByText('实际音轨工程', { exact: true }).first().waitFor();
  await open(beatPage, '真实音轨卡点');
  await beatPage.getByRole('button', { name: '确认价格并分析', exact: true }).click();
  await beatPage.getByRole('button', { name: '应用原任务结果并保存', exact: true }).click();
  await beatPage.getByText('分析结果已应用并保存到工程', { exact: true }).waitFor();
  const cuts = beat.saved.at(-1).style_data.tracks.filter(track => track.type === 'video');
  assert.equal(cuts.length, 4); assert.equal(cuts[1].start, 1.3); assert.equal(cuts[1].sourceStart, 4.95);
  await beatPage.getByRole('button', { name: '关闭', exact: true }).click();
  await beatPage.getByRole('button', { name: '人物去背景', exact: true }).click();
  await beatPage.getByRole('button', { name: '立即执行', exact: true }).click();
  await beatPage.getByRole('button', { name: '关闭', exact: true }).click();
  await beatPage.getByText('人物去背景 · 导出后生效', { exact: true }).waitFor();
  await beatPage.getByRole('button', { name: '保存项目', exact: true }).click();
  await beatPage.reload();
  await beatPage.getByText('人物去背景 · 导出后生效', { exact: true }).waitFor();
  console.log('PASS 实际节拍位置切分与原裁剪位置、人物分割参数保存刷新恢复');

  const link = await fixture(), linkPage = link.page;
  link.jobs.push(subtitle.jobs[0]);
  await linkPage.goto(`${base}/video/edit?importId=${projectId}&editJob=${subtitle.jobs[0].id}`);
  await linkPage.getByRole('button', { name: '应用原任务结果并保存', exact: true }).waitFor();
  assert.equal(link.created.length, 0);
  await linkPage.setViewportSize({ width: 390, height: 844 });
  await linkPage.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAnimations().every(animation => animation.playState === 'finished'));
  assert.equal(await linkPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const bounds = await linkPage.locator('[role="dialog"]').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await linkPage.screenshot({ path: '.volcengine-build/edit-analysis-mobile.png', fullPage: true });
  await linkPage.getByRole('button', { name: '应用原任务结果并保存', exact: true }).click();
  await linkPage.getByText('分析结果已应用并保存到工程', { exact: true }).waitFor();
  assert.equal(link.created.length, 0);
  assert.deepEqual([...subtitle.errors, ...beat.errors, ...link.errors], []);
  console.log('PASS 无本地回执按任务中心链接恢复原结果，390px对话框和真实按钮应用');
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
