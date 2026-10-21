/** 隔离 API 夹具验证真实页面交互，不连接生产资源。PLAYWRIGHT_MODULE 可指向临时安装的模块。 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const uid = '11111111-1111-4111-8111-111111111111', projectId = crypto.randomUUID();
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const backend = 'https://ui-fixture.example';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture-only', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: { role: 'admin' }, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const context = await browser.newContext();
  await context.addInitScript(session => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session)), session);
  let created = 0, job, restored = false;
  const errors = [];
  const project = { id: projectId, user_id: uid, title: '真实成片夹具', video_url: `${backend}/storage/v1/object/authenticated/materials/${uid}/video.mp4`,
    duration: 2, status: 'completed', storyboard: [], materials: [], created_at: new Date().toISOString() };
  await context.route('https://ui-fixture.example/**', async route => {
    const request = route.request(), url = new URL(request.url());
    let body;
    try { body = request.postDataJSON(); } catch {}
    let reply = [], status = 200;
    if (request.method() === 'OPTIONS') reply = {};
    else if (url.pathname.includes('/auth/')) reply = session.user;
    else if (url.pathname.includes('/storage/v1/object/sign/')) reply = { signedURL: `/object/sign/materials/${uid}/preview.png?token=fixture` };
    else if (url.pathname.endsWith('/platform-accounts')) {
      reply = body.action === 'list' ? { platforms: [{ id: 'tiktok', name: 'TikTok', enabled: false }, { id: 'douyin', name: '抖音', enabled: false }], connections: [] }
        : body.action === 'apps' ? { apps: [] } : {};
    } else if (url.pathname.endsWith('/platform-publish')) {
      reply = body.action === 'metrics' ? { metrics: [{ id: 'metric', publish_task_id: 'task', platform: 'douyin', video_id: 'real-id',
        view_count: 123, like_count: null, comment_count: 5, share_count: 0, collected_at: new Date().toISOString() }] }
        : body.action === 'sync' ? { collected: 1 }
        : { tasks: [{ id: 'task', project_id: projectId, platform: 'douyin', title: '指标作品', status: 'published', metrics_error: '等待授权指标权限' }] };
    } else if (url.pathname.endsWith('/production-jobs')) {
      if (body.action === 'create') {
        created++; job = { id: crypto.randomUUID(), request_key: body.request_key, kind: body.kind, project_id: body.project_id || null,
          status: 'pending', progress: 5, phase: 'ready', created_at: new Date().toISOString(), result: null };
        reply = { job }; status = 202;
      } else if (body.action === 'query') {
        restored = true; job = { ...job, status: 'completed', progress: 100, result: { url: `${backend}/storage/v1/object/sign/materials/${uid}/image.png?token=fixture` } };
        reply = { job };
      } else reply = { jobs: job ? [job] : [] };
    } else if (url.pathname.endsWith('/model-settings')) reply = { configs: [{ slot: 'image.primary', name: '本地图片模型', enabled: true }] };
    else if (url.pathname.includes('/rest/v1/profiles')) reply = { id: uid, username: '本地测试', invite_code: 'LOCALTEST', role: 'admin' };
    else if (url.pathname.includes('/rest/v1/video_projects')) reply = [project];
    else if (url.pathname.includes('/rest/v1/credit_costs')) reply = [{ action: 'generate_image', cost: 10 }, { action: 'generate_video', cost: 10 }];
    else if (url.pathname.includes('/rest/v1/user_plans')) reply = { credits_total: 100, credits_used: 0, plans: { name: '专业版', level: 1 } };
    else if (url.pathname.includes('/rest/v1/rpc/')) reply = {};
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/publish`);
  await page.getByRole('heading', { name: '跨平台发布', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '待管理员配置' }).count(), 2);
  assert.equal(await page.getByRole('button', { name: '待管理员配置' }).first().isEnabled(), false);
  await page.getByRole('combobox').filter({ has: page.locator('option[value="' + projectId + '"]') }).selectOption(projectId);
  console.log('PASS 发布页读取私有成片，未配置平台禁止授权');
  await page.goto(`${base}/data-feedback`);
  await page.getByRole('heading', { name: '发布数据回流' }).waitFor();
  await page.getByText('等待授权指标权限', { exact: false }).waitFor();
  const row = page.getByRole('row').filter({ hasText: 'real-id' });
  assert.match(await row.textContent(), /123/); assert.match(await row.textContent(), /—/);
  await page.getByRole('button', { name: '同步官方数据' }).click();
  await page.getByRole('button', { name: '同步官方数据' }).waitFor();
  console.log('PASS 指标真实零与缺失值区分，同步错误可见');
  await page.goto(`${base}/video/create`);
  await page.getByRole('button', { name: '图片生成', exact: true }).click();
  const prompt = page.locator('textarea:visible').first();
  await prompt.fill('本地测试商品图片');
  await page.getByRole('button', { name: /生成图片/ }).click();
  await page.getByRole('button', { name: '刷新进度' }).waitFor();
  assert.equal(created, 1);
  await page.close();
  const resumed = await context.newPage();
  resumed.on('pageerror', error => errors.push(error.message));
  await resumed.goto(`${base}/video/create`);
  await resumed.getByRole('button', { name: '图片生成', exact: true }).click();
  await resumed.locator('img[src*="image.png?token=fixture"]').first().waitFor();
  assert.equal(created, 1); assert.equal(restored, true);
  console.log('PASS 图片关闭页面后恢复同一请求并显示成片，无重复创建');
  assert.deepEqual(errors, []);
  await context.close();
} finally { await browser.close(); }
