/** 模拟普通用户的浏览器角色；服务端管理员权限拒绝另由model_settings_scope回归验证。 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const origin = process.env.SETTINGS_ORIGIN || 'https://118.196.122.161';
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route(`${origin}/auth/v1/token*`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.user) body.user.app_metadata = { ...body.user.app_metadata, role: 'user' };
    await route.fulfill({ response, json: body });
  });
  const page = await context.newPage(), errors = [], actions = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/\/functions\/v1\/(?:model-settings|platform-accounts)$/.test(new URL(request.url()).pathname)) {
      actions.push(request.postDataJSON()?.action);
    }
  });
  await page.goto(origin + '/login');
  await page.locator('input').first().fill(process.env.SETTINGS_LOGIN || 'admin');
  await page.locator('input[type=password]').fill(process.env.SETTINGS_PASSWORD);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await page.waitForURL('**/video/create');
  await page.goto(origin + '/settings/models');
  await page.getByText('平台管理员负责模型 API 配置。', { exact: false }).waitFor();
  await page.getByRole('status').filter({ hasText: '正在读取模型目录' }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('main .divide-y > div').count(), 16);
  assert.equal(await page.getByLabel('API Key', { exact: false }).count(), 0);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.goto(origin + '/settings/integrations');
  await page.getByText('第三方数据服务和发布应用由平台管理员配置。', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Client Key', { exact: true }).count(), 0);
  assert.ok(actions.every(action => action === 'catalog'));
  assert.deepEqual(errors, []);
  console.log('PASS 模拟普通用户视图：16项只读模型目录，无模型/发布应用编辑表单，仅请求catalog');
} finally { await browser.close(); }
