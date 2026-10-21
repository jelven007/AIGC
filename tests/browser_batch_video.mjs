/** 浏览器真实操作本地页面，业务响应使用夹具；不向云端提交或扣费。 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let createFail = true, cancelFail = true, batch = null;
  const creates = [], calls = [];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    calls.push({ path, method: request.method(), body });
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'video.Wan3', category: 'video', provider: 'Wan3', name: 'Wan3', enabled: true }] };
    else if (path.endsWith('/batch-video-jobs')) {
      if (body.action === 'quote') data = { unit_cost: 10, max_items: 50 };
      if (body.action === 'list') data = { batches: batch ? [batch] : [] };
      if (body.action === 'create') {
        creates.push(body); status = createFail ? 503 : 202;
        if (!createFail) batch = { id: productId, name: body.name, provider: 'Wan3', status: 'processing', created_at: '2026-10-21',
          total_count: 1, completed_count: 0, failed_count: 0, cancelled_count: 0, attention_count: 0,
          reserved_credits: 10, settled_credits: 0, refunded_credits: 0, progress: 0,
          items: [{ id: 'item', product_name: '超长商品名称用于验证移动端换行保温杯保温杯保温杯保温杯保温杯', status: 'pending' }] };
        data = createFail ? { error: '创建结果未确认' } : { batch };
      }
      if (body.action === 'pause') { batch.status = 'paused'; data = { batch }; }
      if (body.action === 'resume') { batch.status = 'processing'; data = { batch }; }
      if (body.action === 'cancel') {
        status = cancelFail ? 503 : 200;
        if (!cancelFail) batch = { ...batch, status: 'cancelled', cancelled_count: 1, reserved_credits: 0, refunded_credits: 10, progress: 100,
          items: batch.items.map(item => ({ ...item, status: 'cancelled' })) };
        data = cancelFail ? { error: '取消结果未确认' } : { batch };
      }
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '本地测试', invite_code: 'TEST', role: 'user' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版' } };
    else if (path.includes('/rest/v1/products')) data = [{ id: productId, name: '超长商品名称用于验证移动端换行保温杯保温杯保温杯保温杯保温杯', category: '杯具', price: 50 }];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/batch-create`);
  await page.getByRole('button', { name: '添加商品', exact: true }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  await page.getByLabel('批次名称', { exact: true }).fill('商品生产批次');
  await page.getByRole('button', { name: '确认预算并创建批次', exact: true }).click();
  await page.getByRole('button', { name: '恢复上次提交', exact: true }).waitFor();
  assert.equal(creates.length, 1);
  const original = creates[0];
  await page.reload();
  await page.getByRole('button', { name: '恢复上次提交', exact: true }).waitFor();
  createFail = false;
  await page.getByRole('button', { name: '恢复上次提交', exact: true }).click();
  await page.getByRole('heading', { name: '商品生产批次', exact: true }).waitFor();
  assert.equal(creates.length, 2); assert.deepEqual(creates[1], original);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(`shoproai:batch-request:11111111-1111-4111-8111-111111111111`)), null);
  console.log('PASS 创建故障保留原请求，刷新后恢复相同幂等请求与预算，服务确认后清理回执');
  await page.getByRole('button', { name: '暂停后续提交', exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '取消未提交项', exact: true }).click();
  await page.getByText('取消结果未确认', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '取消未提交项', exact: true }).count(), 1);
  cancelFail = false;
  await page.getByRole('button', { name: '取消未提交项', exact: true }).click();
  await page.getByText('预占 0 · 已结算 0 · 已返还 10 积分', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '取消未提交项', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/batch-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(calls.some(call => call.method !== 'GET' && /\/rest\/v1\/(batch_jobs|batch_job_items)/.test(call.path)), false);
  console.log('PASS 暂停恢复走业务API、取消故障不冒报退款、取消确认与长商品名移动布局');
} finally { await browser.close(); }
