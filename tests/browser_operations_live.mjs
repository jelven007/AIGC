/** 线上真实只读验收，候选静态文件在同源下预览；不发起退款或业务变更。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.OPERATIONS_ORIGIN || 'https://118.196.122.161';
const evidence = { origin, candidate: !!process.env.OPERATIONS_CANDIDATE_DIR, domains: [], errors: [],
  failures: [], unexpected_writes: [], browser_plugin_available: false, browser: 'Playwright Chromium' };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-proxy-server'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  if (process.env.OPERATIONS_CANDIDATE_DIR) await context.route(`${origin}/**`, async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' || /^\/(?:auth|rest|functions|storage|realtime|health)\//.test(pathname)
      || pathname === '/runtime-config.js') return route.continue();
    const root = path.resolve(process.env.OPERATIONS_CANDIDATE_DIR);
    let file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(pathname)) return route.continue();
      file = path.join(root, 'index.html');
    }
    return route.fulfill({ path: file });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/operations') && request.postDataJSON()?.action === 'mutate') {
      evidence.unexpected_writes.push(request.postDataJSON()?.operation);
    }
  });
  page.on('response', async response => {
    if (response.status() >= 400 && response.url().startsWith(origin)) evidence.failures.push({
      path: new URL(response.url()).pathname, status: response.status(),
    });
  });
  await page.goto(origin + '/login');
  await page.locator('input').first().fill(process.env.OPERATIONS_LOGIN || 'admin');
  await page.locator('input[type=password]').fill(process.env.OPERATIONS_PASSWORD);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await page.waitForFunction(() => Object.keys(localStorage).some(key => {
    if (!key.endsWith('-auth-token')) return false;
    const session = JSON.parse(localStorage.getItem(key) || '{}');
    return !!session.access_token && !!session.user?.id;
  }));
  const uid = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.endsWith('-auth-token'));
    return JSON.parse(localStorage.getItem(key)).user.id;
  });
  await page.goto(origin + '/operations');
  const navigation = page.getByRole('navigation', { name: '运营数据域' });
  await navigation.waitFor();
  const names = await navigation.getByRole('button').allTextContents();
  assert.equal(names.length, 13);
  for (const name of names) {
    if (name !== names[0]) {
      const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/operations')
        && response.request().postDataJSON()?.action === 'list');
      await navigation.getByRole('button', { name, exact: true }).click();
      await loaded;
    }
    await page.getByRole('status').filter({ hasText: '正在读取运营数据' }).waitFor({ state: 'hidden' });
    const alerts = await page.locator('main').getByRole('alert').allTextContents();
    assert.deepEqual(alerts, [], name);
    evidence.domains.push({ name, table_rows: await page.locator('main tbody tr').count(),
      actions: await page.locator('main tbody button').allTextContents() });
  }
  await navigation.getByRole('button', { name: '客户与预算', exact: true }).click();
  await page.getByRole('button', { name: '设置日预算', exact: true }).first().waitFor();
  const ownRow = page.locator('tbody tr').filter({ hasText: 'admin' });
  evidence.self_restriction_buttons = await ownRow.getByRole('button', { name: /限制新计费任务|解除任务限制/ }).count();
  assert.equal(evidence.self_restriction_buttons, 0);
  await page.getByRole('button', { name: '设置日预算', exact: true }).first().click();
  await page.getByRole('dialog', { name: '设置日积分预算' }).waitFor();
  assert.ok(/^\d+$/.test(await page.getByLabel('日积分预算', { exact: true }).inputValue()));
  await page.getByRole('dialog').getByRole('button', { name: /^(Close|关闭弹窗)$/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  evidence.budget_dialog = true;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.OPERATIONS_SCREENSHOT_DIR) await page.screenshot({
      path: `${process.env.OPERATIONS_SCREENSHOT_DIR}/运营控制台-修复后-${width}-20261031.png`, fullPage: true,
    });
  }
  await page.goto(origin + '/support');
  await page.getByRole('button', { name: '新建工单', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建工单', exact: true }).click();
  await page.getByLabel('工单标题', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: /^(Close|关闭弹窗)$/ }).click();
  evidence.support_dialog = true;
  // 以原账号恢复未受理的固定申请；只用于验证前端与后端拒绝语义，使用非法预算避免业务写入。
  if (process.env.OPERATIONS_VERIFY_REJECTION === '1') {
    const pending = { kind: 'operator', body: { action: 'mutate', operation: 'budget', request_key: crypto.randomUUID(),
      payload: { user_id: uid, amount: -1, expected: 0 } } };
    await page.evaluate(({ uid, pending }) => localStorage.setItem(`shopro-operator-request-${uid}`, JSON.stringify(pending)), { uid, pending });
    evidence.unexpected_writes.length = 0;
    await page.goto(origin + '/operations');
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/operations')
      && response.request().postDataJSON()?.action === 'mutate');
    await page.getByRole('button', { name: '按原参数恢复', exact: true }).click();
    const response = await loaded;
    assert.equal(response.status(), 400);
    assert.equal((await response.json()).outcome, 'rejected');
    await page.getByText('运营申请参数非法', { exact: true }).waitFor();
    await page.waitForFunction(uid => localStorage.getItem(`shopro-operator-request-${uid}`) === null, uid);
    evidence.expected_rejection = { status: 400, outcome: 'rejected', local_request_cleared: true };
    assert.deepEqual(evidence.unexpected_writes, ['budget']);
    evidence.unexpected_writes = [];
    evidence.failures = evidence.failures.filter(item => !(item.path.endsWith('/operations') && item.status === 400));
  }
  for (const route of ['/settings/models', '/settings/integrations']) {
    await page.goto(origin + route);
    await page.getByRole('navigation', { name: route.endsWith('/models') ? '模型类别' : '数据服务类别' }).waitFor();
  }
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.failures, []); assert.deepEqual(evidence.unexpected_writes, []);
  evidence.business_writes = 0; evidence.paid_refunds = 0;
  if (process.env.OPERATIONS_LIVE_REPORT) fs.writeFileSync(process.env.OPERATIONS_LIVE_REPORT, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
