import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111', videoKey = crypto.randomUUID(), imageKey = crypto.randomUUID();
const videoStorage = `shopro:video-task:${uid}`, imageStorage = `shopro:production:${uid}:image:workbench`;
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const video = { request_key: videoKey, provider: 'SeedanceMini', input: { prompt: '真实商品', duration: 5, ratio: '16:9', resolution: '720P' } };
const image = { request_key: imageKey, input: { prompt: '真实商品图', size: '1024x1024' } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(data => {
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(data.session));
    localStorage.setItem(data.videoStorage, JSON.stringify(data.video));
    localStorage.setItem(data.imageStorage, JSON.stringify(data.image));
  }, { session, videoStorage, imageStorage, video, image });
  const creates = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {}; try { body = route.request().postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/video-jobs') || path.endsWith('/production-jobs')) {
      if (body.action === 'query') { status = 404; data = { error: '任务不存在' }; }
      else if (body.action === 'create') {
        creates.push(body); status = path.endsWith('/video-jobs') ? 403 : 429;
        data = { error: status === 403 ? '账号的新计费任务已受限，可通过工单申诉' : '团队日积分预算不足', outcome: 'rejected' };
      } else data = { jobs: [] };
    } else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'image.primary', name: '图片模型', enabled: true }, { slot: 'video.SeedanceMini', name: '视频模型', enabled: true }] };
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试客户', invite_code: 'TEST' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版', level: 1 } };
    else if (path.includes('/rest/v1/credit_costs')) data = [{ action: 'generate_image', cost: 10 }, { action: 'generate_video', cost: 10 }];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/video/create');
  await page.waitForFunction(keys => keys.every(key => localStorage.getItem(key) === null), [videoStorage, imageStorage]);
  assert.equal(creates.find(row => row.provider)?.request_key, videoKey);
  assert.equal(creates.find(row => row.kind === 'image')?.request_key, imageKey);
  assert.equal(creates.length, 2);
  await page.getByRole('button', { name: '图片生成', exact: true }).click();
  await page.getByText('团队日积分预算不足', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '积分管理与充值' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS 视频/图片刷新404后沿原UUID恢复，明确403限制/429预算清理未受理回执，无重复创建或充值弹窗');
} finally { await browser.close(); }
