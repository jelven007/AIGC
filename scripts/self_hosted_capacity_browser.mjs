/** 容量发布后的公网管理员关键页面检查；浏览器插件不可用时使用现有Playwright。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-proxy-server'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [], failed = [], checks = [];
const origin = process.env.SELF_HOSTED_TEST_ORIGIN;
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.url().startsWith(origin) && response.status() >= 400) {
    failed.push({ path: new URL(response.url()).pathname, status: response.status() });
  }
});
try {
  await page.goto(origin + '/login');
  await page.locator('input').first().fill(process.env.SELF_HOSTED_TEST_USERNAME);
  await page.locator('input[type=password]').fill(process.env.SELF_HOSTED_TEST_PASSWORD);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await page.waitForURL('**/video/create');
  for (const route of ['/video/create', '/products', '/works', '/task-queue', '/settings/models']) {
    await page.goto(origin + route);
    await page.locator('main').waitFor();
    await page.waitForLoadState('networkidle');
    const text = await page.locator('main').innerText();
    assert.ok(text.trim().length > 8 && !text.includes('页面运行遇到了问题'), route);
    checks.push({ route, meaningful_content: true });
  }
  const report = { passed: errors.length === 0 && failed.length === 0,
    origin, admin_login: true, checks, errors, failed_requests: failed,
    browser: 'Playwright Chromium', fallback_reason: 'Browser plugin not available',
    tls_trust_ignored_for_browser_only: true };
  fs.writeFileSync(process.env.CAPACITY_OUTPUT, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
  assert.equal(report.passed, true);
} finally {
  await browser.close();
}
