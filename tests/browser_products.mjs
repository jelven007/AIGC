import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let products = [], jobs = [], failSave = true, failDelete = true, failExtract = true, failList = false;
  const submissions = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/product-management')) {
      if (body.action === 'list') {
        data = failList ? { error: '商品读取故障', outcome: 'rejected' } : { products, total: products.length, offset: 0 };
        status = failList ? 503 : 200;
      } else if (body.action === 'imports') data = { jobs };
      else if (body.action === 'save') {
        submissions.push(body);
        if (!products.some(product => product.name === body.items[0].draft.name)) {
          products.push({ ...body.items[0].draft, id: body.items[0].import_job_id ? 'imported' : id,
            user_id: uid, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            ai_selling_points: [], target_language: 'zh', target_platform: 'douyin' });
        }
        status = failSave ? 503 : 200; data = failSave ? { error: '商品保存回执待确认', outcome: 'unknown' }
          : { action: 'save', ids: products.map(product => product.id), count: 1, products };
      } else if (body.action === 'delete') {
        submissions.push(body); status = failDelete ? 503 : 200;
        if (!failDelete) products = [];
        data = failDelete ? { error: '商品删除回执待确认', outcome: 'unknown' } : { action: 'delete', ids: [id], count: 1 };
      } else if (body.action === 'extract') {
        submissions.push(body);
        if (!jobs.length) jobs = [{ id, request_key: body.request_key, kind: 'product_import', created_at: new Date().toISOString(),
          credit_cost: 0, status: 'pending', progress: 0, phase: 'ready', result: null }];
        status = failExtract ? 503 : 202;
        data = failExtract ? { error: '商品提取回执待确认', outcome: 'unknown' } : { job: jobs[0], outcome: 'accepted' };
      }
    } else if (path.endsWith('/production-jobs')) data = { jobs: jobs.filter(job => !body.kinds || body.kinds.includes(job.kind)) };
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试用户', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/products');
  await page.getByText('暂无商品，请添加或导入商品资料', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加商品', exact: true }).click();
  await page.getByLabel('商品名称', { exact: true }).fill('真实杯子');
  await page.getByLabel('原价', { exact: true }).fill('0');
  await page.getByLabel('币种', { exact: true }).fill('USD');
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复原商品操作', exact: true }).waitFor();
  assert.equal(submissions[0].items[0].draft.stock, null);
  assert.equal(submissions[0].items[0].draft.original_price, 0);
  await page.reload(); failSave = false;
  await page.locator('[data-floating-notice]').getByRole('button', { name: '恢复原商品操作', exact: true }).click();
  await page.getByText('USD 0.00', { exact: true }).waitFor();
  assert.deepEqual(submissions[0], submissions[1]); assert.equal(products.length, 1);
  console.log('PASS 商品空态、零价/原币种/未知库存，保存503刷新按原UUID恢复');

  await page.getByRole('button', { name: '真实杯子更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除真实杯子', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复原商品操作', exact: true }).waitFor();
  assert.equal(products.length, 1);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByText('USD 0.00', { exact: true }).waitFor();
  failDelete = false; await page.locator('[data-floating-notice]').getByRole('button', { name: '恢复原商品操作', exact: true }).click();
  await page.getByText('暂无商品，请添加或导入商品资料', { exact: true }).waitFor();
  assert.deepEqual(submissions[2], submissions[3]);
  assert.equal(await page.evaluate(() => localStorage.getItem('shopro_deleted_product_ids')), null);
  console.log('PASS 删除失败不隐藏商品、不冒报成功，恢复原删除请求');

  await page.getByRole('button', { name: '链接与资料导入', exact: true }).click();
  await page.getByLabel('资料类型', { exact: true }).selectOption('text');
  await page.getByLabel('商品资料文本', { exact: true }).fill('商品名称：商家确认标题\n原始商品资料');
  const firstExtraction = page.waitForResponse(response => response.url().endsWith('/product-management')
    && response.request().postDataJSON()?.action === 'extract');
  await page.getByRole('button', { name: '提取商品资料', exact: true }).click();
  await firstExtraction;
  await page.getByRole('button', { name: '恢复原提取请求', exact: true }).waitFor();
  await page.reload(); failExtract = false;
  await page.getByRole('button', { name: '链接与资料导入', exact: true }).click();
  const recoveredExtraction = page.waitForResponse(response => response.url().endsWith('/product-management')
    && response.request().postDataJSON()?.action === 'extract');
  await page.getByRole('button', { name: '恢复原提取请求', exact: true }).click();
  await recoveredExtraction;
  await page.getByText('后台正在提取商品资料…', { exact: true }).waitFor();
  const extractions = submissions.filter(submission => submission.action === 'extract');
  assert.equal(extractions.length, 2); assert.deepEqual(extractions[0], extractions[1]);
  jobs[0] = { ...jobs[0], status: 'completed', result: { draft: { name: '商家确认标题', category: '其他', description: '原始商品资料',
    currency: null, original_price: null, sale_price: null, stock: null, sales_count: null, selling_points: [], specs: [], images: [], cover_image: null, status: 'draft' },
    warnings: ['请手动核对价格、币种、库存和卖点。'],
    source: { mode: 'text', url: null, content_hash: 'a'.repeat(64), observed_at: new Date().toISOString(), facts: { name: '商家确认标题' } } } };
  await page.getByRole('button', { name: '刷新提取记录', exact: true }).click();
  await page.getByLabel('商品名称', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('原价', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('库存', { exact: true }).inputValue(), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/products-import-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '确认并导入商品', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(submissions.at(-1).items[0].import_job_id, id);
  await page.getByText('库存：未提供 · 累计销量：未提供', { exact: true }).waitFor();
  failList = true; await page.reload();
  await page.getByRole('alert').filter({ hasText: '商品读取故障' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS 提取503同UUID恢复、真实结果核对/缺失数值/无推荐图片/来源入库、390px无溢出及读取故障');
} finally { await browser.close(); }
