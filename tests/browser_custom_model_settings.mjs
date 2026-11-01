import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
  await page.goto(`${base}/tests/ui/model-settings.html`);
  const nav = page.getByRole('navigation', { name: '模型类别' });
  await nav.waitFor();
  assert.deepEqual(await nav.getByRole('heading').allTextContents(), ['文本', '视频', '图片', '音频', '向量', '数字人']);
  assert.equal(await nav.getByRole('button').count(), 13);
  assert.equal(await page.getByText('已退役模型说明', { exact: true }).count(), 0);
  assert.equal(await page.getByText('密钥加密保存在服务端。', { exact: false }).count(), 0);
  await page.getByText('配置调用地址、模型、密钥，密钥保存在服务端。更新只影响新任务，旧任务使用原配置。', { exact: true }).waitFor();
  for (const [type, name] of [['文本', '备用文本接口'], ['视频', '商品视频接口'], ['图片', '商品绘图接口'],
    ['音频', '商品语音接口'], ['3D', '商品3D接口'], ['向量', '检索接口']]) {
    await page.getByRole('button', { name: '新建模型配置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('模型类型').selectOption({ label: type });
    await dialog.getByLabel('配置名称').fill(name);
    await dialog.getByRole('button', { name: '创建配置', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await nav.getByRole('button', { name: `${name} 关闭`, exact: true }).waitFor();
    assert.equal(await page.getByLabel('显示名称').inputValue(), name);
    await page.getByLabel('显示名称').fill(`${name}已更新`);
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await nav.getByRole('button', { name: `${name}已更新 关闭`, exact: true }).waitFor();
    await page.reload();
    await nav.getByRole('button', { name: `${name}已更新 关闭`, exact: true }).click();
    assert.equal(await page.getByLabel('显示名称').inputValue(), `${name}已更新`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '新建模型配置', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.goto(`${base}/tests/ui/model-settings.html?failure=create`);
  await page.getByRole('button', { name: '新建模型配置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('配置名称').fill('创建失败重试');
  await dialog.getByRole('button', { name: '创建配置', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('配置名称').inputValue(), '创建失败重试');
  await dialog.getByRole('button', { name: '创建配置', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const requests = await page.evaluate(() => window.settingsFixtureRequests.filter(item => item.action === 'create'));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].id, requests[1].id, '失败重试保留创建标识');
  assert.deepEqual(errors, []);
  console.log('PASS 文案顺序、六类创建/保存/刷新、手机弹窗和失败重试');
} finally { await browser.close(); }
