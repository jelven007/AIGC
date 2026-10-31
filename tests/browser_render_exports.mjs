/** 真实移动端页面操作；夹具模拟请求失联、刷新恢复及部分成片。 */
import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', projectId = crypto.randomUUID();
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let fail = true, group = null, completed = false;
  const requests = [], errors = [], projectMutations = [], legacyQueries = [];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/production-jobs')) {
      if (body.action === 'export') {
        requests.push(body);
        group ||= { id: crypto.randomUUID(), request_key: body.request_key, title: '很长的商品成片名称用于验证移动端内容换行和跨平台导出记录',
          source_project_id: projectId, status: 'processing', progress: 0, total_count: body.formats.length, completed_count: 0,
          jobs: body.formats.map(format => ({ id: crypto.randomUUID(), project_id: crypto.randomUUID(), output_ratio: format.ratio,
            output_height: format.height, status: 'pending', progress: 0, result: null })) };
        status = fail ? 503 : 202; data = fail ? { error: '导出创建结果待确认' } : { export: group };
      } else if (body.action === 'exports') {
        if (completed) group = { ...group, status: 'partial', completed_count: 1, progress: 100,
          jobs: group.jobs.map((job, index) => ({ ...job, status: index ? 'failed' : 'completed', progress: index ? 5 : 100,
            result: index ? null : { url: 'https://download.example/result.mp4' },
            error_message: index ? '素材编码失败' : null })) };
        data = { exports: group && !fail ? [group] : [] };
      } else if (body.action === 'query') {
        legacyQueries.push(body); data = { job: { id: crypto.randomUUID(), status: 'pending' } };
      } else throw new Error('unexpected production action ' + body.action);
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '本地测试', invite_code: 'TEST', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    else if (path.includes('/rest/v1/video_projects')) {
      if (request.method() !== 'GET') projectMutations.push(body);
      data = [{ id: projectId, user_id: uid, title: '私有成片', duration: 2 }];
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/export-formats`);
  await page.getByRole('heading', { name: '跨平台导出', exact: true }).waitFor();
  await page.getByLabel('选择成片', { exact: true }).selectOption(projectId);
  await page.getByLabel('4:5', { exact: true }).check();
  await page.getByLabel('720p', { exact: true }).check();
  await page.getByRole('button', { name: '创建 4 种规格导出', exact: true }).click();
  await page.getByRole('button', { name: '恢复上次导出', exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].formats.length, 4);
  assert.equal(await page.getByRole('button', { name: '创建 4 种规格导出', exact: true }).isEnabled(), false);
  await page.reload();
  await page.getByRole('button', { name: '恢复上次导出', exact: true }).waitFor();
  fail = false;
  await page.getByRole('button', { name: '恢复上次导出', exact: true }).click();
  await page.getByText('后台处理中 · 0/4', { exact: true }).waitFor();
  assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]);
  completed = true;
  await page.getByRole('button', { name: '刷新记录', exact: true }).click();
  await page.getByText('部分完成 · 1/4', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /下载/ }).count(), 1);
  assert.equal(await page.getByRole('link', { name: '发布成片' }).count(), 1);
  assert.equal(await page.getByText('素材编码失败', { exact: true }).count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); assert.deepEqual(projectMutations, []);
  await page.screenshot({ path: '.volcengine-build/exports-mobile.png', fullPage: true });
  console.log('PASS 4:5多分辨率选择、失联刷新原请求恢复、独立下载发布、部分失败及390px布局');
  const legacyKey = crypto.randomUUID();
  await context.addInitScript(({ uid, key }) => localStorage.setItem(`shopro:format:${uid}`,
    JSON.stringify({ request_key: key, project_id: key, input: { title: '旧导出' } })), { uid, key: legacyKey });
  await page.reload();
  await page.getByRole('button', { name: '恢复旧版导出', exact: true }).click();
  await page.getByRole('button', { name: '恢复旧版导出', exact: true }).waitFor({ state: 'detached' });
  assert.equal(legacyQueries.length, 1); assert.equal(legacyQueries[0].request_key, legacyKey);
  assert.equal(requests.length, 2);
  console.log('PASS 旧版单规格回执升级后可恢复原任务，不新建作品或重复导出');
} finally { await browser.close(); }
