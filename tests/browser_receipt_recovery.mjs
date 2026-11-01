/** 真实登录后验证旧回执显示；不提交新任务或调用收费供应商。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const inputs = JSON.parse(fs.readFileSync(0, 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-proxy-server', ...(process.env.RESOLVER_RULES ? [
    `--host-resolver-rules=${process.env.RESOLVER_RULES}`] : [])] });
const checks = [];
try {
  for (const scenario of ['corrupt-current', 'legacy-session']) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], creates = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/functions/v1/batch-video-jobs') && request.method() === 'POST') {
        try { if (request.postDataJSON()?.action === 'create') creates.push('create'); } catch { /* 无正文。 */ }
      }
    });
    await page.goto(inputs.origin + '/login');
    await page.locator('input').first().fill(inputs.username);
    await page.locator('input[type=password]').fill(inputs.password);
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    await page.waitForURL('**/video/create');
    const uid = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => /^sb-.*-auth-token$/.test(key));
      return key ? JSON.parse(localStorage.getItem(key))?.user?.id : null;
    });
    assert.ok(uid, 'real authenticated account');
    const receipt = { key: crypto.randomUUID(), input: { name: '兼容修复浏览器回执',
      product_ids: [crypto.randomUUID()], budget: 10, provider: 'ArkSeedance' } };
    await page.evaluate(({ uid, receipt, scenario }) => {
      const legacy = `shoproai:batch-request:${uid}`, current = `aigc:batch-request:${uid}`;
      localStorage.removeItem(current);
      localStorage.removeItem(legacy);
      if (scenario === 'corrupt-current') {
        localStorage.setItem(legacy, JSON.stringify(receipt));
        localStorage.setItem(current, '{broken-current');
      } else {
        sessionStorage.setItem(legacy, JSON.stringify(receipt));
      }
    }, { uid, receipt, scenario });
    await page.goto(inputs.origin + '/batch-create');
    await page.getByRole('button', { name: '恢复上次提交', exact: true }).waitFor();
    await page.getByText('兼容修复浏览器回执', { exact: false }).waitFor();
    const restored = await page.evaluate(uid => {
      const value = localStorage.getItem(`aigc:batch-request:${uid}`);
      return value ? JSON.parse(value) : null;
    }, uid);
    assert.deepEqual(restored, receipt);
    assert.equal(creates.length, 0, 'page loading must not submit restored requests');
    assert.deepEqual(errors, []);
    checks.push({ scenario, original_uuid_and_payload_preserved: true,
      real_auth_login: true, creates_sent: creates.length, page_errors: errors.length });
    await context.close();
  }
  const report = { passed: true, origin: inputs.origin, checks,
    browser_tls_ignored_for_self_signed_test: true };
  if (process.env.RECEIPT_OUTPUT) fs.writeFileSync(process.env.RECEIPT_OUTPUT,
    JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
