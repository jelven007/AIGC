import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const key = `script-draft-${uid}`;
const defaults = { productName: '', category: '美妆护肤', priceRange: '', sellingPoints: [], audience: '',
  platform: 'douyin', videoLength: 25, knowledgeJobId: '', scenes: [], promptText: '', generated: false };
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {} } };
async function fixture(raw = undefined, width = 1280, extra = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.route('https://**/*', route => route.abort());
  if (process.env.DRAFT_ORIGINAL_MODULE) {
    await context.route('**/src/hooks/useDraft.ts*', route => route.fulfill({
      contentType: 'application/javascript', body: readFileSync(process.env.DRAFT_ORIGINAL_MODULE, 'utf8'),
    }));
  }
  await context.addInitScript(({ session, key, raw, extra }) => {
    window.__SHOPRO_RUNTIME__ = { backendUrl: 'https://ui-fixture.example', backendAnonKey: 'fixture' };
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
    if (!sessionStorage.getItem('notice-fixture-seeded')) {
      if (raw !== undefined) localStorage.setItem(key, raw);
      for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, value);
      sessionStorage.setItem('notice-fixture-seeded', '1');
    }
  }, { session, key, raw, extra });
  const scriptRows = [];
  await context.route('https://ui-fixture.example/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let data = [];
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/profiles')) data = { id: uid, username: '创作者', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid);
    else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) data = { jobs: [] };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    else if (path.endsWith('/model-settings')) data = { configs: [] };
    else if (path.endsWith('/batch-video-jobs')) data = { unit_cost: 10, max_items: 50, batches: [] };
    else if (path.endsWith('/product-management')) data = { products: [], total: 0, offset: 0 };
    else if (path.endsWith('/scripts')) {
      if (request.method() === 'POST') scriptRows.push(request.postDataJSON());
      data = scriptRows.filter(row => !url.searchParams.get('id') || url.searchParams.get('id') === `eq.${row.id}`);
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, errors, close: async () => { await context.close(); await browser.close(); } };
}
for (const [name, raw] of [['first visit', undefined], ['legacy empty cache', JSON.stringify(defaults)],
  ['whitespace cache', JSON.stringify({ ...defaults, productName: '  ', audience: '\n', sellingPoints: [' '] })]]) {
  test(`empty script does not claim restoration: ${name}`, async () => {
    const f = await fixture(raw);
    try {
      await f.page.goto(`${base}/script`);
      await f.page.getByPlaceholder('例：无线降噪耳机 Pro').waitFor();
      await f.page.reload();
      await f.page.getByPlaceholder('例：无线降噪耳机 Pro').waitFor();
      assert.equal(await f.page.getByText(/已恢复.*草稿/).count(), 0);
      assert.equal(await f.page.evaluate(key => localStorage.getItem(key), key), null);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
for (const raw of ['null', '{"sellingPoints":"invalid","scenes":{}}']) {
  test(`invalid cached draft is not restored: ${raw}`, async () => {
    const f = await fixture(raw);
    try {
      await f.page.goto(`${base}/script`);
      await f.page.getByPlaceholder('例：无线降噪耳机 Pro').waitFor();
      assert.equal(await f.page.getByText(/已恢复.*草稿/).count(), 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
for (const width of [1280, 390]) {
  test(`real draft restores once in a floating notice; close preserves it; new script clears it: ${width}px`, async () => {
    const draft = { ...defaults, productName: '保留真实创意', audience: '音乐爱好者', sellingPoints: ['轻巧便携'] };
    const f = await fixture(JSON.stringify(draft), width), page = f.page;
    try {
      await page.goto(`${base}/script`);
      const field = page.getByPlaceholder('例：无线降噪耳机 Pro');
      await field.waitFor();
      assert.equal(await field.inputValue(), draft.productName);
      const notice = page.locator('[data-floating-notice]').filter({ hasText: '已恢复本地脚本草稿' });
      await notice.waitFor();
      assert.equal(await page.locator('.app-content').getByText(/已恢复.*草稿/).count(), 0);
      await notice.getByRole('button', { name: '关闭提醒', exact: true }).click();
      await notice.waitFor({ state: 'hidden' });
      assert.equal(await field.inputValue(), draft.productName);
      await field.fill('继续修改后的创意');
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.productName === '继续修改后的创意', key);
      assert.equal(await page.locator('[data-floating-notice]').count(), 0);
      await page.reload();
      await field.waitFor();
      assert.equal(await field.inputValue(), '继续修改后的创意');
      await notice.waitFor();
      if (process.env.NOTICE_SCREENSHOTS) await page.screenshot({
        path: join(process.env.NOTICE_SCREENSHOTS, `脚本草稿浮层-${width}-20261101.png`),
      });
      await page.getByRole('button', { name: '新建脚本', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '清空并新建', exact: true }).click();
      assert.equal(await field.inputValue(), '');
      await page.reload();
      await field.waitFor();
      assert.equal(await field.inputValue(), '');
      assert.equal(await page.getByText(/已恢复.*草稿/).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
test('legacy wizard draft notification floats and retains its continue action', async () => {
  const f = await fixture(undefined, 390, { [`video-create-draft-${uid}`]: JSON.stringify({ productData: { name: '旧草稿商品', category: '家居用品' } }) });
  try {
    await f.page.goto(`${base}/home`);
    await f.page.getByRole('button', { name: '分镜编辑', exact: true }).click();
    const notice = f.page.locator('[data-floating-notice]').filter({ hasText: '检测到旧向导草稿' });
    await notice.waitFor();
    assert.equal(await f.page.locator('.app-content').getByText(/检测到旧向导草稿/).count(), 0);
    await notice.getByRole('button', { name: '关闭提醒', exact: true }).click();
    await notice.waitFor({ state: 'hidden' });
    await f.page.getByRole('button', { name: /查看待处理提醒：检测到旧向导草稿/ }).click();
    await notice.waitFor();
    await notice.getByRole('link', { name: '继续旧商品草稿', exact: true }).click();
    await f.page.waitForURL('**/script');
    await f.page.waitForFunction(() => document.querySelector('input[placeholder="例：无线降噪耳机 Pro"]')?.value === '旧草稿商品');
    assert.equal(await f.page.getByPlaceholder('例：无线降噪耳机 Pro').inputValue(), '旧草稿商品');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('pending saves can collapse and reopen their original recovery action outside the page', async () => {
  const receiptKey = `shopro:script-writes:${uid}`;
  const receipt = { id: '22222222-2222-4222-8222-222222222222', table: 'scripts', input: { title: '原保存内容' }, confirmed: false };
  const f = await fixture(undefined, 390, { [receiptKey]: JSON.stringify([receipt]) }), page = f.page;
  try {
    await page.goto(`${base}/script`);
    const notice = page.locator('[data-floating-notice]').filter({ hasText: '脚本或知识保存结果待确认' });
    await notice.waitFor();
    assert.equal(await page.locator('.app-content').getByText(/脚本或知识保存结果待确认/).count(), 0);
    await notice.getByRole('button', { name: '关闭提醒', exact: true }).click();
    await notice.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), receiptKey), [receipt]);
    await page.getByRole('button', { name: /查看待处理提醒：有 1 份脚本/ }).click();
    await notice.getByRole('button', { name: '恢复原脚本保存', exact: true }).click();
    await page.getByText('已恢复1份原保存', { exact: true }).waitFor();
    await notice.waitFor({ state: 'hidden' });
    const recovered = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), receiptKey);
    assert.deepEqual(recovered, [{ ...receipt, confirmed: true }]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('knowledge reference uses a floating notice and its remove action keeps the script', async () => {
  const f = await fixture(JSON.stringify({ ...defaults, productName: '保留脚本', knowledgeJobId: 'knowledge-fixture' }), 390), page = f.page;
  try {
    await page.goto(`${base}/script`);
    const notice = page.locator('[data-floating-notice]').filter({ hasText: '已带入知识库资料' });
    await notice.waitFor();
    assert.equal(await page.locator('.app-content').getByText(/已带入知识库资料/).count(), 0);
    await notice.getByRole('button', { name: '移除知识引用', exact: true }).click();
    await notice.waitFor({ state: 'hidden' });
    assert.equal(await page.getByPlaceholder('例：无线降噪耳机 Pro').inputValue(), '保留脚本');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.knowledgeJobId === '', key);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
