import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const requests = [];
  await context.route('https://ui-fixture.example/**', async route => {
    if (route.request().method() === 'POST') requests.push(route.request().url());
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  const page = await context.newPage();
  await page.goto(`${process.env.UI_TEST_URL || 'http://127.0.0.1:5211'}/login?mode=register`);
  await page.getByText('注册协议暂未发布，暂时无法创建账号。已有账号可直接登录。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox').isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /立\s*即\s*注\s*册/ }).isDisabled(), true);
  assert.equal(await page.getByRole('link', { name: '《用户协议》', exact: true }).count(), 0);
  await page.getByRole('button', { name: '手机号验证码注册', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '获取验证码', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '返回注册', exact: true }).click();
  await page.getByRole('button', { name: '直接登录', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /登\s*录/, exact: true }).first().isEnabled(), true);
  await page.getByRole('button', { name: '手机号验证码登录', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '获取验证码', exact: true }).isEnabled(), true);
  assert.equal(requests.some(url => /\/(signup|otp)$/.test(url)), false);
  console.log('PASS 缺正式协议配置时禁新账号注册/不可勾选/无虚假链接，已有邮箱和手机登录保留，零注册请求');
} finally { await browser.close(); }
