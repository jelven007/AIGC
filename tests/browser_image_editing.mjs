import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const uid = '11111111-1111-4111-8111-111111111111';
const version = '44444444-4444-4444-8444-444444444444';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await context.route('https://**/*', route => route.abort());
await context.addInitScript(value => { if (!localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)); }, session);
const state = { errors: [], creates: [], uploads: [], materials: [], job: null, failCreate: true, editing: true, holdCreate: false, cost: 10 };
let createHeld, releaseCreate, releasedCreate;
const held = new Promise(resolve => { createHeld = resolve; }), release = new Promise(resolve => { releaseCreate = resolve; });
const released = new Promise(resolve => { releasedCreate = resolve; });
await context.route(`${backend}/**`, async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  let id = uid; try { id = JSON.parse(Buffer.from((req.headers().authorization || '').split('.')[1], 'base64url')).sub; } catch {}
  let input = {}; try { input = req.postDataJSON() || {}; } catch {}
  let data = [], status = 200;
  if (req.method() === 'OPTIONS') data = {};
  else if (path.includes('/auth/')) data = { ...session.user, id };
  else if (path.includes('/profiles')) data = { id, username: '图片测试', role: 'user' };
  else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(id);
  else if (path.includes('/credit_costs')) data = req.headers().accept === 'application/vnd.pgrst.object+json'
    ? { cost: state.cost } : [{ action: 'generate_image', cost: state.cost }];
  else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'image.primary', name: '已配置图片模型', enabled: true,
    version_id: version, image_capabilities: { reference: state.editing, mask: state.editing } }] };
  else if (path.includes('/object/sign/') && req.method() === 'POST') data = { signedURL: path.replace('/storage/v1', '') + '?token=fixture' };
  else if (path.includes('/storage/v1/object/') && req.method() === 'POST') {
    state.uploads.push({ path, bytes: req.postDataBuffer()?.length }); data = { Key: path, Id: crypto.randomUUID() };
  } else if (path.endsWith('/material-assets')) {
    if (input.action === 'register') {
      const material = { id: crypto.randomUUID(), name: input.input.name, type: 'image', user_id: uid,
        url: `${backend}/storage/v1/object/authenticated/materials/${uid}/uploads/${input.request_key}.png` };
      state.materials.push(material); data = { material };
    } else data = { materials: state.materials, total: state.materials.length };
  } else if (path.endsWith('/production-jobs')) {
    if (input.action === 'create') {
      state.creates.push(input);
      state.job ||= { id: crypto.randomUUID(), request_key: input.request_key, kind: 'image', project_id: null,
        status: 'pending', progress: 5, phase: 'ready', created_at: new Date().toISOString() };
      if (state.failCreate) { state.failCreate = false; status = 503; data = { error: '提交结果待确认' }; }
      else data = { job: state.job };
      if (state.holdCreate) { assert.equal(id, uid); createHeld(); await release; }
    } else if (input.action === 'query') data = { job: state.job };
    else data = { jobs: state.job && id === uid ? [state.job] : [] };
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  if (state.holdCreate && input.action === 'create') releasedCreate();
});
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', error => state.errors.push(error.message));
try {
  await page.goto(`${base}/ai-toolbox`);
  await page.getByRole('heading', { name: 'AI工具箱', exact: true }).waitFor();
  if (process.env.UI_BASELINE) {
    assert.equal(await page.getByText('24.8万', { exact: true }).count(), 1);
    await page.getByRole('button', { name: /跨平台一键发布/ }).click();
    await page.waitForURL('**/export-formats');
    await page.goto(`${base}/video/create`);
    await page.getByRole('button', { name: '图片生成', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '扩图', exact: true }).count(), 0);
    console.log('BASELINE 工具箱硬编码24.8万、发布入口误入导出，图片缺扩图/局部重绘');
  } else {
    assert.equal(await page.getByText('24.8万', { exact: true }).count(), 0);
    assert.equal(await page.getByText('98.6%', { exact: true }).count(), 0);
    await page.getByRole('searchbox', { name: '搜索工具', exact: true }).fill('发布');
    await page.getByRole('link', { name: /跨平台发布/ }).click(); await page.waitForURL('**/publish');
    await page.goto(`${base}/ai-toolbox`);
    await page.getByRole('link', { name: /商品图片编辑/ }).click();
    await page.getByRole('button', { name: '扩图', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '图片生成', exact: true }).getAttribute('aria-pressed'), 'true');
    console.log('PASS 工具箱真实统计、可搜索分类、正确发布和图片入口');
    await page.getByRole('button', { name: '扩图', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '准备编辑素材', exact: true }).isDisabled(), true);
    const png = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0c784b'; ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = '#ddd'; ctx.fillRect(125, 60, 150, 200);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('选择编辑原图', { exact: true }).setInputFiles({ name: '自有商品.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.getByRole('checkbox', { name: /我拥有参考素材/ }).check();
    await page.getByLabel('图片描述', { exact: true }).fill('延续自然光背景，保留商品外形与文字');
    await page.getByRole('button', { name: '准备编辑素材', exact: true }).click();
    await page.getByText('编辑素材已准备', { exact: false }).waitFor();
    assert.equal(state.uploads.length, 2);
    state.cost = 13;
    await page.getByRole('button', { name: '刷新图片配置与价格', exact: true }).click();
    await page.getByText('每次编辑：13 积分', { exact: false }).waitFor();
    assert.equal(await page.getByLabel('图片描述', { exact: true }).inputValue(), '延续自然光背景，保留商品外形与文字');
    assert.equal(state.uploads.length, 2);
    const lostCreateResponse = page.waitForResponse(response => response.url().endsWith('/production-jobs')
      && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'create');
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    const lostCreate = await lostCreateResponse;
    assert.equal(lostCreate.status(), 503);
    assert.equal((await lostCreate.json()).error, '提交结果待确认');
    await page.getByRole('button', { name: '刷新进度', exact: true }).waitFor();
    assert.equal(state.creates.length, 1);
    assert.equal(state.creates[0].input.mode, 'outpaint');
    assert.equal(state.creates[0].input.confirmed_model_version, version);
    assert.equal(state.creates[0].input.confirmed_credit_cost, 13);
    assert.match(state.creates[0].input.mask_image, /\/object\/authenticated\/materials\//);
    await page.reload(); await page.getByRole('button', { name: '图片生成', exact: true }).click();
    await page.getByRole('button', { name: '刷新进度', exact: true }).waitFor();
    assert.equal(state.creates.length, 1); assert.equal(state.uploads.length, 2);
    console.log('PASS 真实画布扩图与透明掩码、私有两素材、确认版本和费用、关页恢复原UUID零重发');
    state.job = null; await page.evaluate(id => localStorage.removeItem(`shopro:production:${id}:image:workbench`), uid);
    await page.reload(); await page.getByRole('button', { name: '图片生成', exact: true }).click();
    await page.getByRole('button', { name: '局部重绘', exact: true }).click();
    await page.getByLabel('选择编辑原图', { exact: true }).setInputFiles({ name: '自有商品.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.getByRole('checkbox', { name: /我拥有参考素材/ }).check();
    await page.getByLabel('重绘区域宽度（%）', { exact: true }).fill('20');
    await page.getByLabel('重绘区域高度（%）', { exact: true }).fill('25');
    await page.getByRole('button', { name: '准备编辑素材', exact: true }).click();
    await page.getByText('编辑素材已准备', { exact: false }).waitFor();
    await page.getByLabel('重绘区域宽度（%）', { exact: true }).fill('30');
    assert.equal(await page.getByText('编辑素材已准备', { exact: false }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '生成图片', exact: true }).isDisabled(), true);
    await page.screenshot({ path: '.volcengine-build/image-editing-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log('PASS 可键盘指定局部掩码、改区域失效旧准备、390px无溢出');
    state.editing = false; await page.reload(); await page.getByRole('button', { name: '图片生成', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '扩图', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '局部重绘', exact: true }).isDisabled(), true);
    console.log('PASS 缺图片编辑能力明确禁用，文本生成仍可使用');
    state.job = null; state.holdCreate = true;
    await page.getByLabel('图片描述', { exact: true }).fill('固定原账号的图片请求');
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await held;
    const helper = await context.newPage(); await helper.goto(`${base}/landing`);
    const other = '99999999-9999-4999-8999-999999999999';
    await helper.evaluate(value => {
      localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
      const channel = new BroadcastChannel('sb-ui-fixture-auth-token'); channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
    }, { ...session, user: { ...session.user, id: other }, access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: other, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture` });
    await helper.close();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="图片描述"]')?.value === '');
    assert.equal(await page.getByLabel('图片描述', { exact: true }).inputValue(), '');
    releaseCreate(); await released;
    assert.equal(await page.getByText('任务已保存，关闭页面后仍会继续处理', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '刷新进度', exact: true }).count(), 0);
    assert.equal(await page.evaluate(id => !!localStorage.getItem(`shopro:production:${id}:image:workbench`), uid), true);
    console.log('PASS 原账号JWT固定、迟到创建回执不污染新账号或弹成功、原回执保留待恢复');
    assert.deepEqual(state.errors, []);
  }
} finally { releaseCreate(); await context.close(); await browser.close(); }
