/** 实际自托管全栈页面接受；浏览器插件不可用，使用已有Playwright。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const state = process.env.SELF_HOSTED_STATE_DIR;
assert.equal(process.env.SELF_HOSTED_ISOLATED_ACCEPTANCE, 'true');
const values = Object.fromEntries(fs.readFileSync(`${state}/runtime.env`, 'utf8')
  .split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
assert.equal(values.COMPOSE_PROJECT_NAME, process.env.SELF_HOSTED_EXPECTED_PROJECT || 'shopro-selfhost-final');
const resolverRules = process.env.SELF_HOSTED_RESOLVER_RULES
  || (new URL(values.PUBLIC_ORIGIN).hostname === 'shopro.test' ? 'MAP shopro.test 127.0.0.1' : '');
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [...(resolverRules ? [`--host-resolver-rules=${resolverRules}`] : []), '--no-proxy-server'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [], failed = [], checks = [];
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => {
  if (response.url().startsWith(values.PUBLIC_ORIGIN) && response.status() >= 400) {
    failed.push({ path: new URL(response.url()).pathname, status: response.status() });
  }
});
try {
  await page.goto(`${values.PUBLIC_ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill('admin');
  await page.locator('input[type=password]').fill('<REDACTED_CREDENTIAL>');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await page.waitForURL('**/video/create');
  checks.push({ admin_username_password_login: true, url: page.url() });
  const routes = ['/video/create', '/works', '/analytics', '/profile', '/settings/models', '/operations',
    '/support', '/products', '/product-selection', '/avatars', '/templates', '/credits', '/script',
    '/style-copy', '/knowledge', '/competitor', '/live-highlight', '/prompt-templates', '/video/edit',
    '/activities', '/invite', '/ab-test', '/emotion-analysis', '/multilang', '/task-queue', '/export-formats',
    '/llm-cache', '/team', '/open-api', '/data-feedback', '/trending-patterns', '/personalize',
    '/batch-create', '/ai-toolbox', '/notifications', '/materials', '/publish', '/data-dashboard'];
  for (const route of routes) {
    await page.goto(values.PUBLIC_ORIGIN + route, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor();
    await page.waitForFunction(() => !['加载中...', '页面加载中...'].some(text => document.body.innerText.includes(text)));
    await page.waitForLoadState('networkidle');
    const text = await page.locator('main').innerText();
    assert.ok(text.trim().length > 8, `Blank main: ${route}`);
    assert.ok(!text.includes('页面运行遇到了问题'), `Error boundary: ${route}`);
    console.log(JSON.stringify({ route, text: text.slice(0, 550) }));
    checks.push({ route, meaningful_content: true, error_boundary: false });
  }
  await page.goto(values.PUBLIC_ORIGIN + '/products');
  const name = `自托管浏览器商品-${Date.now()}`;
  await page.getByRole('button', { name: '添加商品', exact: true }).click();
  await page.getByLabel('商品名称', { exact: true }).fill(name);
  await page.getByLabel('原价', { exact: true }).fill('20');
  await page.getByLabel('币种', { exact: true }).fill('CNY');
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByText(name, { exact: true }).waitFor();
  await page.reload();
  await page.getByText(name, { exact: true }).waitFor();
  await page.getByRole('button', { name: `删除${name}`, exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByText(name, { exact: true }).waitFor({ state: 'detached' });
  checks.push({ real_product_save_reload_delete: true });
  await page.goto(values.PUBLIC_ORIGIN + '/settings/models');
  await page.getByText('主文本模型', { exact: true }).last().waitFor();
  await page.screenshot({ path: `${state}/receipts/browser-desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(values.PUBLIC_ORIGIN + '/products');
  await page.getByRole('button', { name: '添加商品', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${state}/receipts/browser-mobile.png`, fullPage: false });
  const receipt = { passed: errors.length === 0 && failed.length === 0, browser: 'Playwright Chromium',
    fallback_reason: 'Browser plugin not available', checks, errors, failed_requests: failed,
    origin: values.PUBLIC_ORIGIN, project: values.COMPOSE_PROJECT_NAME, tls_trust_ignored_for_test: true,
    viewports: ['1440x1000', '390x844'] };
  fs.writeFileSync(`${state}/receipts/browser-checks.json`, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(receipt));
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
} catch (error) {
  console.error(error.message);
  console.error(JSON.stringify({ checks, errors, failed, url: page.url(), text: (await page.locator('body').innerText()).slice(0, 7000) }));
  await page.screenshot({ path: `${state}/receipts/browser-failure.png`, fullPage: false, timeout: 5000 }).catch(() => {});
  throw error;
} finally { await browser.close(); }
