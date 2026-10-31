import assert from 'node:assert/strict';
import test from 'node:test';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const product = { id, name: '真实杯子', category: '其他', status: 'draft', updated_at: '2026-10-27T00:00:00Z',
  selling_points: [], specs: [], images: [] };
const session = { access_token: `header.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-crashpad-for-testing', '--disable-breakpad', '--disable-crash-reporter'] });
async function fixture(blockStorage = false, archive = null, publishSetup = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ session, blockStorage }) => {
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
    if (blockStorage) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('shopro')) throw new DOMException('full', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }
  }, { session, blockStorage });
  const calls = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (req.method() !== 'OPTIONS') {
      calls.push({ path, body });
      if (path.includes('/auth/')) data = session.user;
      else if (path.endsWith('/knowledge-base')) data = { entries: [], jobs: [], prices: { knowledge_index: 2, knowledge_search: 1 } };
      else if (path.endsWith('/market-intelligence')) data = { targets: [], jobs: [], sources: [{ slot: 'intelligence.ebay', enabled: true }], prices: { intelligence_products: 2 } };
      else if (path.endsWith('/batch-video-jobs')) data = { batches: [], unit_cost: 20, max_items: 50, pipeline_costs: null };
      else if (path.endsWith('/product-management')) data = { jobs: [], products: [product], total: 1, cost: 2 };
      else if (path.endsWith('/production-jobs')) {
        data = archive && body.action === 'query' ? { job: { id, request_key: id, kind: 'product_translate',
          status: archive.complete ? 'completed' : 'running', credit_cost: 2, created_at: '2026-10-27T00:00:00Z',
          result: archive.complete ? { product_id: id, source_updated_at: product.updated_at, source_hash: 'a'.repeat(64),
            target_language: 'en', version_id: id, created_at: '2026-10-27T00:00:00Z', image_text: [], image_hash: null,
            image_note: '', translation: { name: 'Original cup', description: 'Confirmed description', selling_points: [], specs: [] } } : null,
        } } : { jobs: [] };
      }
      else if (path.endsWith('/video-jobs')) data = { jobs: [] };
      else if (path.endsWith('/platform-accounts')) data = body.action === 'creator'
        ? { display_name: '测试账号', platform: 'tiktok', privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 60,
          comment_disabled: true, duet_disabled: true, stitch_disabled: true }
        : { connections: publishSetup ? [{ id: uid, platform: 'tiktok', display_name: '测试账号', status: 'active' }] : [], platforms: [] };
      else if (path.endsWith('/platform-publish')) data = { tasks: [], groups: [] };
      else if (path.endsWith('/model-settings')) data = { configs: [
        { slot: 'video.primary', category: 'video', name: '本地视频', enabled: true, provider: 'vidu' },
        { slot: 'video.fallback', category: 'video', name: '方舟视频', enabled: true, provider: 'ArkSeedance' },
      ] };
      else if (path.endsWith('/rest/v1/video_projects') && publishSetup) data = [{ id, title: '原成片', video_url: `${backend}/fixture.mp4`, duration: 2 }];
      else if (path.endsWith('/rest/v1/products')) data = [product];
      else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
      else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
      if (['create', 'collect', 'save_target', 'translate', 'extract', 'create_group'].includes(body.action)) {
        status = 503; data = { error: 'unexpected creation' };
      }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  return { context, page, calls, errors };
}
const taskReads = calls => calls.filter(call => /\/(knowledge-base|market-intelligence|batch-video-jobs|production-jobs|platform-publish|platform-accounts)$/.test(call.path));
try {
  await test('超出最近列表的原翻译深链接仍查询同一任务直到完成', async () => {
    const archive = { complete: false };
    const { context, page, calls, errors } = await fixture(false, archive);
    try {
      await page.clock.install(); await page.goto(`${base}/products?translationJob=${id}`);
      await page.getByRole('dialog').getByRole('status').filter({ hasText: '2积分' }).waitFor();
      const before = calls.filter(call => call.body.action === 'query').length;
      archive.complete = true; await page.clock.runFor(30000);
      await page.getByRole('dialog').getByText('Original cup', { exact: true }).waitFor();
      assert.ok(calls.filter(call => call.body.action === 'query').length > before);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  for (const [path, title] of [['knowledge', 'Prompt 知识库'], ['product-selection', '智能选品'],
    ['batch-create', '批量生成工作台'], ['publish', '跨平台发布']]) {
    await test(`${title}空任务60秒和隐藏10分钟没有重复任务/目录读取`, async () => {
      const { context, page, calls, errors } = await fixture();
      try {
        await page.clock.install(); await page.goto(`${base}/${path}`);
        await page.getByRole('heading', { name: title, exact: true }).waitFor();
        if (path === 'knowledge') await page.getByText('检索我的知识 · 0/200条', { exact: true }).waitFor();
        if (path === 'product-selection') await page.getByText('还没有情报对象。保存账号或搜索后，可确认积分并开始采集。', { exact: true }).waitFor();
        if (path === 'batch-create') await page.waitForFunction(() => document.querySelector('option[value="vidu"]')?.parentElement.value === 'vidu');
        if (path === 'publish') await page.getByText('暂无发布任务。', { exact: true }).waitFor();
        const before = taskReads(calls).length;
        await page.clock.runFor(60000);
        assert.equal(taskReads(calls).length, before);
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.runFor(600000); assert.equal(taskReads(calls).length, before);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
  for (const scenario of ['knowledge', 'intelligence', 'translation', 'import', 'batch', 'video', 'publish']) {
    await test(`${scenario}回执存储满显示错误且零提交`, async () => {
      const { context, page, calls, errors } = await fixture(true, null, scenario === 'publish');
      try {
        if (scenario === 'knowledge') {
          await page.goto(`${base}/knowledge`); await page.getByLabel('知识检索关键词').fill('杯子');
          await page.getByRole('button', { name: '语义检索 · 1积分', exact: true }).click();
        } else if (scenario === 'intelligence') {
          await page.goto(`${base}/product-selection`); await page.getByLabel('商品关键词', { exact: true }).fill('cup');
          await page.getByRole('button', { name: '保存情报对象', exact: true }).click();
        } else if (scenario === 'video') {
          await page.setViewportSize({ width: 1200, height: 900 });
          const loaded = page.waitForResponse(response => response.url().endsWith('/video-jobs') && response.request().method() === 'POST');
          await page.goto(`${base}/video/create`); await loaded;
          await page.getByRole('button', { name: /方舟视频/ }).waitFor();
          await page.getByPlaceholder('描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频').fill('真实商品视频');
          await page.getByRole('button', { name: 'AI视频生成', exact: true }).click();
        } else if (scenario === 'publish') {
          await page.goto(`${base}/publish`); await page.getByRole('combobox').first().selectOption(id);
          await page.getByRole('checkbox', { name: 'tiktok · 测试账号', exact: true }).check();
          const account = page.getByRole('group', { name: '测试账号', exact: true });
          await account.getByRole('combobox').selectOption('SELF_ONLY');
          await account.getByRole('checkbox', { name: /我已预览/ }).check();
          await page.getByRole('button', { name: '提交到 1 个账号', exact: true }).click();
        } else if (scenario === 'batch') {
          await page.goto(`${base}/batch-create`); await page.getByRole('button', { name: '添加商品', exact: true }).click();
          await page.getByRole('checkbox').first().check(); await page.getByRole('button', { name: '确认添加', exact: true }).click();
          await page.getByRole('button', { name: '确认预算并创建批次', exact: true }).click();
        } else {
          await page.goto(`${base}/products`, { waitUntil: 'domcontentloaded' });
          if (scenario === 'translation') {
            await page.locator('[data-product-id]:visible').first().getByRole('button', { name: /更多操作$/ }).click();
            await page.getByRole('menuitem', { name: '翻译商品', exact: true }).click();
            await page.getByRole('button', { name: '确认翻译 · 2积分', exact: true }).click();
          } else {
            await page.getByRole('button', { name: '链接与资料导入', exact: true }).click();
            await page.getByLabel('资料类型', { exact: true }).selectOption('text');
            await page.getByLabel('商品资料文本', { exact: true }).fill('商品名称：杯子');
            await page.getByRole('button', { name: '提取商品资料', exact: true }).click();
          }
        }
        await page.getByText(/回执无法保存/).first().waitFor();
        assert.equal(calls.filter(call => ['create', 'collect', 'save_target', 'translate', 'extract', 'create_group'].includes(call.body.action)).length, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
} finally { await browser.close(); }
