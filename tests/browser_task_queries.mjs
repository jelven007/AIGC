import assert from 'node:assert/strict';
import test from 'node:test';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-crashpad-for-testing', '--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
async function fixture(blockStorage = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ session, blockStorage }) => {
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
    if (blockStorage) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('shopro:')) throw new DOMException('full', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }
  }, { session, blockStorage });
  const calls = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let reply = [], status = 200;
    if (req.method() === 'OPTIONS') reply = {};
    else {
      calls.push({ path, body });
      if (path.includes('/auth/')) reply = session.user;
      else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) {
        if (body.action === 'create') { status = 503; reply = { error: 'unexpected creation' }; }
        else reply = { jobs: [], costs: { tts: 2, beats: 0, subtitles: 3 }, voices: [] };
      } else if (path.endsWith('/platform-publish')) reply = { tasks: [] };
      else if (path.endsWith('/model-settings')) reply = { configs: [{ slot: 'image.primary', name: '本地图片', enabled: true }] };
      else if (path.includes('/rest/v1/profiles')) reply = { id: uid, username: '测试', invite_code: 'TEST' };
      else if (path.endsWith('/rpc/get_my_credits')) reply = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  return { context, page, calls, errors };
}
const lists = calls => calls.filter(call => call.body.action === 'list' && /\/(production-jobs|video-jobs|platform-publish)$/.test(call.path));
try {
  await test('空列表/全部终态自动请求为零，重新可见立即回源', async () => {
    const { context, page, calls, errors } = await fixture();
    try {
      await page.clock.install();
      await page.goto(`${base}/task-queue`);
      await page.getByText('暂无后台任务，提交创作后会在这里显示。', { exact: true }).waitFor();
      const before = lists(calls).length;
      await page.clock.runFor(60000);
      assert.equal(lists(calls).length, before, '终态仍在重复读取任务列表');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.runFor(600000);
      assert.equal(lists(calls).length, before);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('任务中心'));
      await page.getByRole('button', { name: '刷新全部', exact: true }).click();
      await page.getByRole('button', { name: '刷新全部', exact: true }).waitFor();
      assert.ok(lists(calls).length > before);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await test('图片生成回执存储满时显示错误且零创建请求', async () => {
    const { context, page, calls, errors } = await fixture(true);
    try {
      await page.goto(`${base}/video/create`);
      await page.getByRole('button', { name: '图片生成', exact: true }).click();
      await page.locator('textarea:visible').first().fill('商品图片');
      await page.getByRole('button', { name: /生成图片/ }).click();
      await page.getByRole('alert').filter({ hasText: '回执无法保存' }).first().waitFor();
      assert.equal(calls.filter(call => call.body.action === 'create').length, 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: '.volcengine-build/task-storage-mobile.png', fullPage: false });
    } finally { await context.close(); }
  });
} finally { await browser.close(); }
