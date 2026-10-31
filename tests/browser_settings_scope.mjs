import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.UI_TEST_URL || 'http://127.0.0.1:5173'}/tests/ui/model-settings.html?failure=empty`);
  await page.getByRole('heading', { name: '模型接口', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
  if (process.env.SETTINGS_BASELINE_SCREENSHOT) await page.screenshot({
    path: process.env.SETTINGS_BASELINE_SCREENSHOT, fullPage: true,
  });
  assert.equal(await page.getByRole('navigation', { name: '模型类别' }).getByRole('button').count(), 16,
    '模型接口只展示16项模型API，不包含统计、商品搜索或网页读取');
  for (const name of ['市场情报', '网页读取', '发布平台应用']) {
    assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0);
  }
  await page.getByRole('button', { name: /知识库 Embedding/ }).click();
  assert.equal(await page.getByLabel('模型 ID', { exact: true }).count(), 1);
  assert.match(await page.getByLabel('完整调用地址').getAttribute('placeholder'), /embeddings$/);
  await page.getByRole('button', { name: /照片数字人口播/ }).click();
  assert.equal(await page.getByLabel('任务查询地址').count(), 1);
  await page.getByRole('button', { name: '导入旧模型配置', exact: true }).click();
  await page.getByText('已导入 0 项，跳过 0 项', { exact: false }).waitFor();
  assert.ok(await page.evaluate(() => window.settingsFixtureRequests.every(item => item.scope === 'models')));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  await page.goto(`${process.env.UI_TEST_URL || 'http://127.0.0.1:5173'}/tests/ui/model-settings.html?scope=integrations`);
  await page.getByRole('heading', { name: '第三方集成', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('navigation', { name: '数据服务类别' }).getByRole('button').count(), 4);
  assert.equal(await page.getByLabel('模型 ID', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /商品网页读取/ }).click();
  await page.getByLabel('显示名称').fill('网页读取集成验收');
  await page.getByLabel('API Key', { exact: false }).fill('isolated-reader-key');
  await page.getByLabel('启用数据服务').click();
  await page.getByLabel('完整调用地址').fill('https://r.jina.ai/');
  await page.getByText('认证、超时与连接检查', { exact: true }).click();
  await page.getByLabel('只读检查地址').fill('https://r.jina.ai/health');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByText('配置已保存，新请求使用新版本', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('API Key', { exact: false }).inputValue(), '');
  // 手机下以键盘触发，覆盖焦点操作，避免夹具的底部提示遮挡按钮。
  await page.getByRole('button', { name: '检查连接', exact: true }).focus();
  await page.getByRole('button', { name: '检查连接', exact: true }).press('Enter');
  await page.getByRole('status').filter({ hasText: '只读接口连接成功' }).waitFor();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('显示名称').inputValue(), '网页读取集成验收');
  await page.getByRole('button', { name: '导入旧数据服务配置', exact: true }).click();
  await page.getByText('已导入 0 项，跳过 0 项', { exact: false }).waitFor();
  assert.ok(await page.evaluate(() => window.settingsFixtureRequests.every(item => item.scope === 'integrations')));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS 模型/集成类别边界、模型API保留、导入范围、集成保存/重载/检查及手机宽度');
} finally { await browser.close(); }
