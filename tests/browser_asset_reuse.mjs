import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { creditSnapshot } from './browser_credit_fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const session = {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {} },
};

async function fixture(width, height, signedIn = false) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(({ signedIn, session }) => {
    window.__SHOPRO_RUNTIME__ = { backendUrl: 'https://ui-fixture.example', backendAnonKey: 'fixture' };
    if (signedIn) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
  }, { signedIn, session });
  const requests = [], errors = [];
  await context.route('https://ui-fixture.example/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method(), body: route.request().postData() });
    let data = [];
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/profiles')) data = { id: uid, username: '创作者', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid);
    else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) data = { jobs: [] };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    else if (path.endsWith('/model-settings')) data = { configs: [] };
    else if (path.endsWith('/product-management')) data = { products: [], total: 0 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, requests, errors, close: async () => { await context.close(); await browser.close(); } };
}

async function decodedImage(image) {
  await image.evaluate(node => new Promise((resolve, reject) => {
    if (node.complete && node.naturalWidth > 0) { resolve(); return; }
    if (node.complete && node.currentSrc) { reject(new Error('参考图加载失败')); return; }
    node.addEventListener('load', resolve, { once: true });
    node.addEventListener('error', () => reject(new Error('参考图加载失败')), { once: true });
  }));
  await image.evaluate(node => node.decode());
}

test('等待尚未进入视口的懒加载参考图实际加载后再解码', async () => {
  const f = await fixture(390, 844), page = f.page;
  try {
    await page.goto(`${base}/landing`);
    const src = await page.getByRole('region', { name: '视觉参考图库' }).locator('img').first().getAttribute('src');
    await page.setContent('<div style="height:20000px"></div><img loading="lazy" width="100" height="100">');
    const image = page.locator('img');
    assert.equal(await image.evaluate(node => node.naturalWidth), 0);
    const decoding = decodedImage(image).then(() => null, error => error);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await image.evaluate((node, url) => { node.src = url; }, `${base}${src}?lazy-regression`);
    await image.scrollIntoViewIfNeeded();
    assert.equal(await decoding, null);
    assert.ok(await image.evaluate(node => node.complete && node.naturalWidth > 0));
  } finally { await f.close(); }
});

test('已经加载失败的图片必须报错，不能等待不会再出现的load事件', { timeout: 5000 }, async () => {
  const f = await fixture(390, 844), page = f.page;
  try {
    await page.goto(`${base}/landing`);
    await page.setContent('<img width="100" height="100">');
    const image = page.locator('img');
    await image.evaluate(node => new Promise(resolve => {
      node.addEventListener('error', resolve, { once: true });
      node.src = 'data:image/png;base64,aW52YWxpZA==';
    }));
    await assert.rejects(decodedImage(image), /参考图加载失败/);
  } finally { await f.close(); }
});

for (const [width, height] of [[1440, 1000], [390, 844], [844, 390]]) {
  test(`35个视觉参考可加载、筛选、预览和复制：${width}px`, async () => {
    const f = await fixture(width, height), page = f.page;
    try {
      await page.goto(`${base}/landing`);
      const gallery = page.getByRole('region', { name: '视觉参考图库', exact: true });
      await gallery.waitFor();
      const previews = gallery.getByRole('button', { name: /^预览：/ });
      assert.equal(await previews.count(), 35);
      for (let i = 0; i < 35; i++) {
        const img = gallery.locator('img').nth(i);
        await img.scrollIntoViewIfNeeded();
        await decodedImage(img);
        assert.ok(await img.evaluate(image => image.naturalWidth > 0));
      }
      await gallery.getByRole('button', { name: '商品构图', exact: true }).click();
      assert.equal(await previews.count(), 6);
      await previews.first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
        '预览必须保持在当前屏幕范围内');
      const prompt = await dialog.getByLabel('参考提示词').inputValue();
      assert.ok(prompt.length > 20);
      await dialog.getByRole('button', { name: '复制提示词', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await dialog.count(), 0);
      assert.equal(await page.locator(':focus').getAttribute('aria-label'), await previews.first().getAttribute('aria-label'));
      await gallery.getByRole('button', { name: '全部', exact: true }).click();
      assert.equal(await previews.count(), 35);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByText('参考图能直接成为作品吗？', { exact: true }).click();
      assert.equal(await page.locator('details').filter({ hasText: '参考图能直接成为作品吗？' }).getAttribute('open'), '');
      assert.deepEqual(f.errors, []);
      if (process.env.ASSET_SCREENSHOTS) {
        await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.ASSET_SCREENSHOTS, `asset-reuse-${width}.png`), fullPage: true });
      }
    } finally { await f.close(); }
  });
}

test('视觉参考图片在桌面和窄屏逐行展示，图片与相邻标题不重叠', async () => {
  for (const [width, height] of [[1440, 1000], [390, 844], [844, 390]]) {
    const f = await fixture(width, height), page = f.page;
    try {
      await page.goto(`${base}/landing`);
      const gallery = page.getByRole('region', { name: '视觉参考图库', exact: true });
      await gallery.waitFor();
      const overlaps = await gallery.locator('img').evaluateAll(images => {
        const boxes = images.map(image => image.getBoundingClientRect());
        return boxes.flatMap((box, index) => boxes.slice(index + 1)
          .filter(other => box.left < other.right && box.right > other.left
            && box.top < other.bottom && box.bottom > other.top).map(() => index));
      });
      assert.deepEqual(overlaps, [], `${width}px参考图片不得交叠`);
      for (const image of await gallery.locator('img').all()) {
        const bounds = await image.boundingBox();
        const title = await image.locator('../..').getByRole('button', { name: /^预览：/ }).boundingBox();
        assert.ok(title && bounds && title.y >= bounds.y + bounds.height - 1, '预览标题位于完整图片下方');
      }
    } finally { await f.close(); }
  }
});

test('参考提示词带入工作台，未提交生成或上传素材', async () => {
  const f = await fixture(1280, 900, true), page = f.page;
  try {
    await page.goto(`${base}/landing`);
    const gallery = page.getByRole('region', { name: '视觉参考图库', exact: true });
    await gallery.getByRole('button', { name: '人物出镜', exact: true }).click();
    await gallery.getByRole('button', { name: /^预览：/ }).last().click();
    const prompt = await page.getByLabel('参考提示词').inputValue();
    await page.getByRole('link', { name: '用这个思路创作', exact: true }).click();
    await page.waitForURL(/\/video\/create\?inspiration=ref-35$/);
    const input = page.locator('textarea').filter({ visible: true }).first();
    await input.waitFor();
    assert.equal(await input.inputValue(), prompt);
    assert.equal(f.requests.some(r => /"action"\s*:\s*"create"/.test(r.body || '')), false);
    assert.equal(f.requests.some(r => r.path.includes('/storage/v1/object/') && r.method === 'POST'), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('访客登录后保留参考编号、套餐与支持去向', async () => {
  const guest = await fixture(390, 844), page = guest.page;
  try {
    await page.goto(`${base}/landing`);
    await page.getByRole('link', { name: '查看套餐与权益', exact: true }).click();
    await page.waitForURL(/\/login\?/);
    assert.equal(new URL(page.url()).searchParams.get('redirect'), '/credits?tab=plans');
    await page.goto(`${base}/landing`);
    await page.getByRole('link', { name: '提交支持工单', exact: true }).click();
    await page.waitForURL(/\/login\?/);
    assert.equal(new URL(page.url()).searchParams.get('redirect'), '/support');
    await page.goto(`${base}/landing`);
    await page.getByRole('region', { name: '视觉参考图库' }).getByRole('button', { name: /^预览：/ }).first().click();
    await page.getByRole('link', { name: '用这个思路创作', exact: true }).click();
    await page.waitForURL(/\/login\?/);
    const login = new URL(page.url());
    assert.equal(login.searchParams.get('redirect'), '/video/create?inspiration=ref-01');
    const member = await fixture(390, 844, true);
    try {
      await member.page.goto(login.href);
      await member.page.waitForURL(/\/video\/create\?inspiration=ref-01$/);
      assert.ok((await member.page.locator('textarea').filter({ visible: true }).first().inputValue()).length > 20);
      assert.deepEqual(member.errors, []);
    } finally { await member.close(); }
  } finally { await guest.close(); }
});
