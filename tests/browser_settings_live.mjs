/** 实际页面只读验收；不保存凭据、不导入、不触发供应商生成。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-proxy-server'] });
const origin = process.env.SETTINGS_ORIGIN || process.env.SELF_HOSTED_TEST_ORIGIN;
const baseline = process.env.SETTINGS_BASELINE === '1';
const results = [], errors = [], failed = [], apiReceipts = [];
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  if (process.env.SETTINGS_CANDIDATE_DIR) await context.route(`${origin}/**`, async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' || /^\/(?:auth|rest|functions|storage|realtime|health)\//.test(pathname)) return route.continue();
    const root = path.resolve(process.env.SETTINGS_CANDIDATE_DIR);
    let file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(pathname)) return route.continue();
      file = path.join(root, 'index.html');
    }
    await route.fulfill({ path: file });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (response.status() >= 400 && response.url().startsWith(origin)) failed.push({
      path: new URL(response.url()).pathname, status: response.status(),
    });
    if (new URL(response.url()).pathname === '/functions/v1/model-settings' && response.ok()) {
      const request = response.request().postDataJSON();
      const result = await response.json();
      apiReceipts.push({ action: request.action, scope: request.scope || 'all', slots: result.configs?.length });
    }
  });
  await page.goto(origin + '/login');
  await page.locator('input').first().fill(process.env.SETTINGS_LOGIN);
  await page.locator('input[type=password]').fill(process.env.SETTINGS_PASSWORD);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await page.waitForURL('**/video/create');
  await page.goto(origin + '/settings/models');
  const models = page.getByRole('navigation', { name: '模型类别', exact: true });
  await models.waitFor();
  results.push({ route: '/settings/models', model_slots: await models.getByRole('button').count(),
    unrelated_data_headings: await page.locator('main').getByRole('heading', { name: /^(市场情报|网页读取|发布平台应用)$/ }).count() });
  if (baseline) {
    if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({
      path: `${process.env.SETTINGS_SCREENSHOT_DIR}/模型接口-优化前-桌面-20261031.png`, fullPage: true,
    });
  } else {
    assert.equal(results[0].model_slots, 16);
    assert.equal(results[0].unrelated_data_headings, 0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.getByRole('button', { name: /知识库 Embedding/ }).click();
      assert.equal(await page.getByLabel('模型 ID', { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({
        path: `${process.env.SETTINGS_SCREENSHOT_DIR}/模型接口-优化后-${width}-20261031.png`, fullPage: true,
      });
    }
    await page.goto(origin + '/settings/integrations');
    const data = page.getByRole('navigation', { name: '数据服务类别', exact: true });
    await data.waitFor();
    await page.getByRole('status').filter({ hasText: '正在加载平台配置' }).waitFor({ state: 'hidden' });
    assert.equal(await data.getByRole('button').count(), 4);
    assert.equal(await page.getByRole('heading', { name: '发布平台应用', exact: true }).count(), 1);
    assert.equal(await page.getByLabel('Client Key', { exact: true }).count(), 2);
    await page.getByRole('button', { name: /商品网页读取/ }).click();
    assert.equal(await page.getByLabel('完整调用地址').inputValue(), 'https://r.jina.ai/');
    assert.equal(await page.getByLabel('模型 ID', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    results.push({ route: '/settings/integrations', data_slots: 4, publishing_apps: 2 });
    if (!process.env.SETTINGS_CANDIDATE_DIR) {
      assert.ok(apiReceipts.some(item => item.action === 'list' && item.scope === 'models' && item.slots === 16));
      assert.ok(apiReceipts.some(item => item.action === 'list' && item.scope === 'integrations' && item.slots === 4));
    }
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({
        path: `${process.env.SETTINGS_SCREENSHOT_DIR}/第三方集成-${width}-20261031.png`, fullPage: true,
      });
    }
    // 核对应用其他主要入口仍可渲染。
    for (const route of ['/credits', '/video/create', '/works']) {
      await page.goto(origin + route);
      await page.locator('main').waitFor();
      await page.waitForLoadState('networkidle');
      assert.ok((await page.locator('main').innerText()).trim().length > 8);
      assert.equal(await page.getByText('页面运行遇到了问题', { exact: true }).count(), 0);
      results.push({ route, rendered: true });
    }
  }
  const report = { origin, baseline, candidate_preview: !!process.env.SETTINGS_CANDIDATE_DIR,
    results, configuration_api: apiReceipts, page_errors: errors, failed_requests: failed,
    browser: 'Playwright Chromium', browser_plugin_available: false,
    writes_to_configuration: 0, paid_model_requests: 0 };
  if (process.env.SETTINGS_LIVE_REPORT) fs.writeFileSync(process.env.SETTINGS_LIVE_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
} finally { await browser.close(); }
