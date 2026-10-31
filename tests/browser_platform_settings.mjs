import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const open = async mode => {
    await page.goto(`${process.env.UI_TEST_URL || 'http://127.0.0.1:5197'}/tests/ui/platform-settings.html?failure=${mode}`);
    await page.getByRole('heading', { name: '发布平台应用' }).waitFor();
    await page.getByRole('status').filter({ hasText: '正在加载平台配置' }).waitFor({ state: 'hidden' });
  };
  await open('offline');
  const key = page.getByLabel('Client Key', { exact: true }).first();
  const secret = page.getByLabel(/Client Secret/).first();
  await key.fill('待恢复草稿'); await secret.fill('isolated-secret');
  assert.equal(await page.getByRole('button', { name: '保存平台应用', exact: true }).first().isDisabled(), true);
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await key.inputValue(), '待恢复草稿');
  assert.equal(await secret.inputValue(), 'isolated-secret');
  await open('recover');
  await key.fill('恢复后草稿'); await secret.fill('isolated-secret');
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  const save = page.getByRole('button', { name: '保存平台应用', exact: true }).first();
  await save.click();
  await page.getByText('平台应用配置已保存', { exact: true }).waitFor();
  assert.equal(await key.inputValue(), '恢复后草稿');
  assert.equal(await secret.inputValue(), '');
  await open('empty');
  assert.equal(await key.count(), 1);
  assert.equal(await key.inputValue(), '');
  for (const mode of ['save', 'receipt', 'conflict']) {
    await open(mode); await key.fill('保留草稿'); await secret.fill('isolated-secret');
    await save.click(); await page.getByRole('alert').waitFor();
    assert.equal(await key.inputValue(), '保留草稿');
    assert.equal(await secret.inputValue(), 'isolated-secret');
    assert.equal(await page.getByText('平台应用配置已保存', { exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS 平台设置失败/空列表/恢复、草稿与密钥保留、未知版本禁存、冲突与无回执拒绝');
} finally { await browser.close(); }
