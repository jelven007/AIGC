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
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const tracks = [
    { id: 'one', type: 'video', trackId: 'video', name: '主视频1', start: 0, duration: 1, url: media },
    { id: 'two', type: 'video', trackId: 'video', name: '主视频2', start: 1, duration: 1, url: media },
    { id: 'layer', type: 'video', trackId: 'pip', name: '画中画', start: 0, duration: 2, url: media },
  ];
  const project = { id: projectId, user_id: uid, title: '成片效果测试', status: 'draft', duration: 2,
    video_url: null, thumbnail_url: null, materials: [], style_data: { duration: 2, tracks } };
  const created = [], saved = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname; let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200, type = 'application/json';
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.includes('/storage/v1/object/sign/') && req.method() === 'POST') data = { signedURL: `/object/sign/materials/${uid}/sample.mp4?token=fixture` };
    else if (path.includes('/storage/v1/object/')) { type = 'video/mp4'; data = ''; }
    else if (path.endsWith('/production-jobs')) {
      if (body.action === 'list') data = { jobs: [] };
      else if (body.action === 'create') {
        created.push(body); data = { job: { id: crypto.randomUUID(), kind: 'render', request_key: body.request_key,
          project_id: projectId, status: 'pending', progress: 0 } }; status = 202;
      }
    } else if (path.includes('/rest/v1/video_projects')) {
      if (req.method() === 'PATCH') {
        saved.push(body); Object.assign(project, body); data = [project];
      } else data = new URL(req.url()).searchParams.has('id') ? [project] : [];
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: type, body: type === 'application/json' ? JSON.stringify(data) : data,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/video/edit?importId=${projectId}`);
  await page.getByText('成片效果测试', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '效果 (E)', exact: true }).click();
  await page.getByRole('button', { name: '圆形展开', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '圆形展开', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '画中画 (P)', exact: true }).click();
  await page.getByRole('button', { name: '柔光', exact: true }).click();
  await page.getByRole('button', { name: 'AI工具 (I)', exact: true }).click();
  await page.getByRole('button', { name: '色键去背景', exact: true }).click();
  await page.getByLabel('颜色容差', { exact: true }).fill('0.33');
  await page.getByLabel('边缘平滑', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: '立即执行', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByText('色键去背景 · 导出后生效', { exact: true }).waitFor();
  await page.getByRole('button', { name: /导出视频/ }).first().click();
  const submitResponse = page.waitForResponse(response => response.url().endsWith('/production-jobs')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'create');
  await page.getByRole('button', { name: '开始渲染导出并入库', exact: true }).click();
  try { await submitResponse; }
  catch (cause) { console.log((await page.locator('[role="dialog"]').last().innerText()).slice(-1200), errors); throw cause; }
  assert.equal(created.length, 1);
  const input = created[0].input;
  assert.equal(input.duration, 2); assert.equal(input.transition, 't6');
  assert.equal(input.tracks[2].blendMode, 'softlight');
  assert.deepEqual(input.tracks[0].chromaKey, { color: '#00ff00', similarity: .33, smoothness: .1 });
  assert.equal(input.tracks[2].chromaKey, undefined);
  assert.ok(input.tracks.every(track => !track.url.includes('token=')));
  assert.equal(saved.at(-1).style_data.appliedTrans, 't6');
  await page.reload();
  await page.getByText('色键去背景 · 导出后生效', { exact: true }).waitFor();
  await page.getByRole('button', { name: '画中画 (P)', exact: true }).click();
  assert.ok((await page.getByRole('button', { name: '柔光', exact: true }).getAttribute('class')).includes('border-indigo-500'));
  assert.equal(created.length, 1); assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'AI工具 (I)', exact: true }).click();
  await page.getByRole('button', { name: '色键去背景', exact: true }).click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog && dialog.getAnimations().every(animation => animation.playState === 'finished');
  });
  assert.equal(await page.getByLabel('颜色容差', { exact: true }).inputValue(), '0.33');
  assert.equal(await page.getByLabel('边缘平滑', { exact: true }).inputValue(), '0.1');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/render-effects-mobile.png', fullPage: true });
  console.log('PASS 真实编辑器效果参数提交、私有稳定URL、2秒工程、保存刷新恢复和390px弹窗');
} finally { await browser.close(); }
