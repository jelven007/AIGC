import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111', alertId = crypto.randomUUID();
const now = new Date().toISOString();
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600,
  user: { id: uid, email: 'alerts@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let stale = true, fail = true, canAck = true;
  let alert = { id: alertId, title: '生产任务结果待核对', source_id: crypto.randomUUID(), severity: 'critical',
    status: 'open', occurrences: 1, version: 1, opened_at: now, last_seen_at: now, note: null };
  const requests = [], receipts = new Map(), errors = [];
  await context.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {}; try { body = route.request().postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/operations')) {
      if (body.action === 'access') data = { root: false, grants: [], permissions: ['alerts:read', 'alerts:write'] };
      else if (body.action === 'list') data = { items: [{ ...alert, can_ack: canAck }], total: 1, page: 1, page_size: 25,
        observed_at: now, monitor: { stale, last_scan_at: now } };
      else if (body.action === 'mutate') {
        requests.push(body);
        if (!receipts.has(body.request_key)) {
          alert = { ...alert, status: 'acknowledged', version: 2, note: body.payload.reason };
          receipts.set(body.request_key, alert);
        }
        status = fail ? 503 : 200;
        data = fail ? { error: '操作受理待确认', outcome: 'unknown' } : receipts.get(body.request_key);
      }
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试值班', invite_code: 'TEST' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版' } };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/operations');
  await page.getByText('告警采集超过三分钟未更新，请检查后台调度。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '确认接手', exact: true }).click();
  await page.getByLabel('操作原因', { exact: true }).fill('已接手核对原供应商任务，保留原请求');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('操作受理待确认', { exact: true }).waitFor();
  await page.reload(); fail = false; stale = false;
  await page.getByRole('button', { name: '按原参数恢复', exact: true }).click();
  await page.getByText('运营操作已生效', { exact: true }).waitFor();
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].operation, 'alert_ack');
  assert.equal(requests[0].payload.expected, 1);
  await page.getByText('后台告警采集正常', { exact: true }).waitFor();
  await page.getByRole('cell', { name: '已接手', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认接手', exact: true }).count(), 0);
  alert = { ...alert, status: 'open', version: 4, occurrences: 2, note: null }; canAck = false;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('cell', { name: '待处理', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认接手', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/operations-alerts-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS 告警采集失效提示、503刷新按原UUID接手、版本固定、恢复状态与只读权限；390px无页面溢出/运行错误');
} finally { await browser.close(); }
