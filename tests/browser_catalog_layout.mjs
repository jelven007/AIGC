import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const baseline = process.env.CATALOG_LAYOUT_BASELINE === '1';
const uid = '11111111-1111-4111-8111-111111111111';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'creator@example.com', app_metadata: { role: 'admin' }, user_metadata: {} } };
const products = [
  { id: 'p1', name: '无线降噪耳机 Pro', category: '数码电器', status: 'active', sale_price: 329, stock: 120, selling_points: ['主动降噪', '轻巧便携'] },
  { id: 'p2', name: '晨间随行保温杯', category: '家居用品', status: 'draft', sale_price: null, stock: null, selling_points: [] },
  { id: 'p3', name: '轻盈透气运动外套 · 日常通勤与户外出行系列', category: '服装配饰', status: 'inactive', sale_price: 199, stock: 0, selling_points: ['透气面料', '轻盈收纳'] },
  { id: 'p4', name: '燕麦风味咖啡', category: '食品饮料', status: 'active', sale_price: 0, stock: 24, selling_points: ['独立包装'] },
].map(product => ({ ...product, user_id: uid, sub_category: null, description: '用于创作的已登记商品资料。',
  original_price: null, currency: 'CNY', sales_count: null, cover_image: null, images: [], specs: [], ai_selling_points: [],
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', target_language: 'zh', target_platform: 'douyin' }));
async function fixture(width) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(session => {
    window.__SHOPRO_RUNTIME__ = { backendUrl: 'https://ui-fixture.example', backendAnonKey: 'fixture' };
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
  }, session);
  const requests = [];
  await context.route('https://ui-fixture.example/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    requests.push({ path, body });
    let data = [];
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/profiles')) data = { id: uid, username: '创作者', role: 'admin' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid);
    else if (path.endsWith('/product-management')) {
      let rows = products.filter(product => (!body.search || product.name.includes(body.search))
        && (!body.category || body.category === 'all' || product.category === body.category)
        && (!body.status || body.status === 'all' || product.status === body.status));
      if (body.sort === 'price_asc') rows = rows.toSorted((a, b) => (a.sale_price ?? Infinity) - (b.sale_price ?? Infinity));
      data = { products: rows, total: rows.length, offset: 0 };
    }
    else if (path.endsWith('/model-settings')) data = { configs: [] };
    else if (path.endsWith('/platform-accounts')) data = { apps: [] };
    else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) data = { jobs: [] };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, errors, requests, close: async () => { await context.close(); await browser.close(); } };
}
async function snapshot(page, name) {
  if (process.env.CATALOG_LAYOUT_SCREENSHOTS) await page.screenshot({
    path: join(process.env.CATALOG_LAYOUT_SCREENSHOTS, `${name}.png`), fullPage: true,
  });
}
async function readable(locator) {
  const ratios = await locator.evaluateAll(elements => {
    const rgba = value => {
      const values = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
      return [...values.slice(0, 3), values[3] ?? 1];
    };
    const over = (top, bottom) => top.slice(0, 3).map((value, i) => value * top[3] + bottom[i] * (1 - top[3]));
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return elements.flatMap(element => {
      const nodes = [];
      for (let node = element; node; node = node.parentElement) nodes.unshift(node);
      let backgrounds = [[255, 255, 255]];
      for (const node of nodes) {
        const style = getComputedStyle(node);
        backgrounds = backgrounds.map(background => over(rgba(style.backgroundColor), background));
        const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(match => rgba(match[0]));
        if (stops.length) backgrounds = backgrounds.flatMap(background => stops.map(stop => over(stop, background)));
      }
      return backgrounds.map(background => {
        const foreground = over(rgba(getComputedStyle(element).color), background);
        const a = luminance(foreground), b = luminance(background);
        return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
          text: element.textContent.trim(), foreground, background };
      });
    });
  });
  const minimum = ratios.toSorted((a, b) => a.ratio - b.ratio)[0];
  assert.ok(minimum.ratio >= 4.5, `商品文字对比度 ${JSON.stringify(minimum)}`);
}
for (const width of [1440, 1024, 390, 320]) {
  test(`product filtering, views and creation controls remain usable at ${width}px`, async () => {
    const f = await fixture(width), page = f.page;
    try {
      await page.goto(`${base}/products`);
      await page.getByText('无线降噪耳机 Pro', { exact: true }).first().waitFor();
      await snapshot(page, `商品管理-${baseline ? 'before' : 'dark'}-${width}`);
      if (baseline) return;
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await readable(page.locator('.product-card h2, .product-card p, .product-card span:not([aria-hidden="true"])'));
      await snapshot(page, `商品管理-light-${width}`);
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await readable(page.locator('.product-card h2, .product-card p, .product-card span:not([aria-hidden="true"])'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const card = page.locator('[data-product-id="p2"]:visible');
      await card.waitFor();
      if (width < 640) assert.ok((await card.boundingBox()).width >= width - 64, '手机商品卡片应保持可读宽度');
      await page.getByRole('checkbox', { name: '选择当前页', exact: true }).check();
      await page.getByRole('button', { name: '批量删除', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('checkbox', { name: '选择当前页', exact: true }).uncheck();
      await page.getByRole('button', { name: '更多操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '批量导入', exact: true }).click();
      await page.getByRole('dialog', { name: '批量导入商品', exact: true }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByLabel('搜索商品名称', { exact: true }).fill('保温杯');
      await page.getByText('未设置价格', { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-product-id="p1"]'));
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      await page.locator('[data-product-id="p1"]:visible').waitFor();
      await page.getByLabel('商品状态筛选', { exact: true }).selectOption('inactive');
      await page.locator('[data-product-id="p3"]:visible').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-product-id="p1"]'));
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      await page.locator('[data-product-id="p1"]:visible').waitFor();
      await page.getByRole('button', { name: '列表视图', exact: true }).click();
      await snapshot(page, `商品管理-list-${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('button', { name: '网格视图', exact: true }).click();
      const first = page.locator('[data-product-id="p1"]:visible');
      await first.getByRole('button', { name: '编辑资料', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.getByLabel('商品名称', { exact: true }).inputValue(), '无线降噪耳机 Pro');
      assert.equal(await dialog.getByLabel('售价', { exact: true }).inputValue(), '329');
      assert.equal(await dialog.getByLabel('卖点（每行一条，最多6条）', { exact: true }).inputValue(), '主动降噪\n轻巧便携');
      await snapshot(page, `商品编辑-${width}`);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await first.getByRole('button', { name: '无线降噪耳机 Pro更多操作', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: '翻译商品', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await first.getByRole('button', { name: '创建视频', exact: true }).click();
      await page.waitForURL('**/video/create');
      await page.getByRole('button', { name: '分镜编辑', exact: true }).waitFor();
      assert.ok(f.requests.some(({ body }) => body.action === 'list' && body.status === 'inactive'));
      assert.equal(f.requests.filter(({ body }) => ['save', 'delete'].includes(body.action)).length, 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
test('models and integrations have direct page titles without a platform-settings label', async () => {
  const f = await fixture(1440), page = f.page;
  try {
    for (const [path, title] of [['settings/models', '模型接口'], ['settings/integrations', '第三方集成']]) {
      await page.goto(`${base}/${path}`);
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.getByRole('navigation', { name: title === '模型接口' ? '模型类别' : '数据服务类别', exact: true }).waitFor();
      await snapshot(page, `配置页-${title}-${baseline ? 'before' : 'after'}`);
      if (!baseline) assert.equal(await page.locator('.app-content').getByText('平台设置', { exact: true }).count(), 0);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
