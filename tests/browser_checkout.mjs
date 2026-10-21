import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', planId = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const calls = [], errors = [], gatewayCalls = [];
  let failLogs = true, failPay = true, price = 10, payMode = 'unknown', orderStatus = 'pending', resultStatus = 'NOT_EXIST';
  const date = '2026-10-22T00:00:00Z';
  const orders = Array.from({ length: 12 }, (_, i) => ({ id: i === 0 ? id : `old-${i}`, order_no: i === 0 ? 'original-order' : `old-order-${i}`,
    status: 'pending', total_amount: 10, pay_channel: 'alipay', plan_snapshot: { name: '真实套餐', credits: 100 },
    refunded_amount: 0, wechat_pay_url: null, created_at: date, paid_at: null, plan_id: planId }));
  await context.route('https://openapi.alipay.com/**', async route => {
    gatewayCalls.push({ method: route.request().method(), body: route.request().postData() });
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>隔离支付收银台</h1>' });
  });
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200, count = 0;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试用户', invite_code: 'TEST' };
    else if (path.includes('/rest/v1/user_plans')) data = { plan_id: 'free', credits_total: 150, credits_used: 100, status: 'active',
      cycle_start: date, cycle_end: '2026-11-22T00:00:00Z', plans: { name: '基础版' } };
    else if (path.includes('/rest/v1/plans')) data = [{ id: 'free', name: '基础版', level: 0, credits: 20, price: 0, features: [] },
      { id: planId, name: '真实套餐', level: 1, credits: 100, price, features: ['真实配置权益'] }];
    else if (path.includes('/rest/v1/credit_logs')) {
      status = failLogs ? 400 : 200; data = failLogs ? { message: '注入读取故障' } : [];
    } else if (path.includes('/rest/v1/cash_refund_receipts')) data = [];
    else if (path.includes('/rest/v1/orders')) {
      if (url.searchParams.has('id')) data = { ...orders[0], status: orderStatus };
      else { const offset = Number(url.searchParams.get('offset') || 0); data = orders.slice(offset, offset + 10); count = orders.length; }
    } else if (path.endsWith('/read_notifications')) data = { items: [], total: 0, unread: 0, unread_all: 0,
      cutoff: date, preferences: { task_success: true, intelligence_success: true } };
    else if (path.endsWith('/alipay-trade-query')) data = { code: 0, data: { local_status: orderStatus, trade_status: resultStatus, amount: '10.00', order_no: 'original-order' } };
    else if (path.endsWith('/alipay-payment-order') || path.endsWith('/create-payment-order')) {
      calls.push({ path, body });
      const receipt = { order_id: id, order_no: 'original-order', local_status: orderStatus, plan_name: '真实套餐', amount: body.expected_amount };
      if (failPay) { status = payMode === 'rejected' ? 409 : 503; data = { code: 1, message: payMode === 'rejected'
        ? '套餐价格已变更，请刷新套餐后重新确认' : '支付请求回执待确认', outcome: payMode, data: payMode === 'unknown' ? receipt : null }; }
      else {
        if (path.endsWith('/create-payment-order')) {
          orders[0].pay_channel = 'wechat'; orders[0].wechat_pay_url = 'weixin://wxpay/bizpayurl?pr=real-order';
          orders[0].total_amount = Number(body.expected_amount);
        }
        data = { code: 0, data: { ...receipt, wechat_pay_url: 'weixin://wxpay/bizpayurl?pr=real-order',
          payment_html: '<form method="post" action="https://openapi.alipay.com/gateway.do"><input type="hidden" name="sign" value="server-signature"><script>window.untrustedScriptRan=true</script></form>' } };
      }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Content-Range': `0-${Math.max(0, data.length - 1)}/${count}`, 'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  await page.goto(base + '/credits?tab=logs');
  await page.getByRole('alert').filter({ hasText: '积分流水读取失败' }).waitFor();
  assert.equal(await page.getByText('暂无积分记录', { exact: true }).count(), 0);
  failLogs = false; await page.getByRole('button', { name: '重试流水读取', exact: true }).click();
  await page.getByText('暂无积分记录', { exact: true }).waitFor();
  assert.equal(await page.getByText(/演示|智能空气炸锅/).count(), 0);
  await page.getByRole('tab', { name: '套餐概览 · 我的资产', exact: true }).click();
  await page.getByText('已使用 67%', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '订单记录', exact: true }).click();
  await page.getByText('共 12 条订单', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('old-order-11', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '套餐对比 · 尊享特权', exact: true }).click();
  await page.getByRole('button', { name: '选择套餐', exact: true }).click();
  await page.getByRole('button', { name: '确认支付 ¥10.00', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '支付请求回执待确认' }).waitFor();
  assert.equal(await page.getByLabel('支付渠道', { exact: true }).isEnabled(), false);
  await page.screenshot({ path: '.volcengine-build/checkout-unknown-mobile.png' });
  await page.reload(); price = 15;
  await page.getByRole('button', { name: '恢复原支付请求', exact: true }).click();
  await page.getByRole('dialog').getByText('¥10.00', { exact: true }).waitFor();
  failPay = false;
  await page.getByRole('dialog').getByRole('button', { name: '恢复原支付请求', exact: true }).click();
  await page.getByRole('heading', { name: '隔离支付收银台' }).waitFor();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].body.expected_credits, 100);
  assert.equal(gatewayCalls[0].method, 'POST'); assert.ok(gatewayCalls[0].body.includes('sign=server-signature'));
  console.log('PASS 真实空流水/失败重试、含加油包总额67%使用率、真实订单分页、503刷新同UUID/原价格/渠道恢复及支付宝POST');
  await page.goto(base + '/alipay-return?order_no=original-order');
  await page.getByText('正在确认支付结果…', { exact: true }).waitFor();
  assert.equal(await page.getByText('支付未完成', { exact: true }).count(), 0);
  orderStatus = 'refunded';
  await page.getByText('订单已退款', { exact: true }).waitFor();
  console.log('PASS 支付宝NOT_EXIST不伪报取消，退款终态不伪报付款成功');
  await page.goto(base + '/credits?tab=plans');
  orderStatus = 'paid';
  await page.getByRole('button', { name: '恢复原支付请求', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复原支付请求', exact: true }).click();
  await page.getByRole('heading', { name: '订单详情', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('shopro:checkout:11111111-1111-4111-8111-111111111111')), null);
  await page.goto(base + '/credits?tab=plans');
  await page.getByRole('button', { name: '选择套餐', exact: true }).click();
  await page.getByLabel('支付渠道', { exact: true }).selectOption('wechat');
  failPay = true; payMode = 'rejected'; price = 20;
  await page.getByRole('button', { name: '确认支付 ¥15.00', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '套餐价格已变更' }).waitFor();
  await page.getByRole('button', { name: '返回套餐重新选择', exact: true }).click();
  await page.getByRole('button', { name: '选择套餐', exact: true }).click();
  await page.getByLabel('支付渠道', { exact: true }).selectOption('wechat');
  failPay = false; orderStatus = 'pending';
  await page.getByRole('button', { name: '确认支付 ¥20.00', exact: true }).click();
  await page.getByRole('heading', { name: '订单详情', exact: true }).waitFor();
  await page.getByAltText('QR Code', { exact: true }).waitFor();
  assert.equal(calls.at(-1).body.expected_amount, '20.00'); assert.ok(calls.at(-1).path.endsWith('/create-payment-order'));
  assert.notEqual(calls.at(-1).body.request_key, calls[0].body.request_key);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/checkout-wechat-mobile.png', fullPage: true });
  console.log('PASS 终态恢复移除待核对请求，价格冲突返回实时套餐重选，微信服务端二维码/订单与390px展示');
  await page.goto(base + '/credits?tab=plans');
  await page.getByRole('heading', { name: '积分与套餐', exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shopro:open-credits-dialog')));
  await page.getByRole('dialog').getByText('积分管理与充值', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').getByText(/兑换|到账|10积分 = 1元/).count(), 0);
  await page.getByRole('button', { name: '查看积分流水', exact: true }).click();
  await page.getByText('暂无积分记录', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS 全局积分不足事件保留真实余额与流水导航，不显示虚假兑换/赠分');
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const publicPage = await publicContext.newPage(), scripts = [];
  publicPage.on('request', request => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname); });
  await publicPage.goto(base + '/landing', { waitUntil: 'domcontentloaded' });
  await publicPage.locator('h1').first().waitFor();
  assert.ok(!scripts.some(path => /MainLayout|PaymentDialog|VideoEditPage|xlsx|MeasurementDashboard/.test(path)));
  await publicPage.getByRole('button', { name: '查看实际套餐', exact: true }).click();
  await publicPage.waitForURL(/\/login\?redirect=/);
  await publicContext.close();
  console.log('PASS 未登录首页不加载业务布局/支付/编辑/导出模块，购买先登录');
} catch (error) {
  if (page && !page.isClosed()) {
    console.log({ url: page.url(), headings: await page.locator('h1,h2').allTextContents(), alerts: await page.getByRole('alert').allTextContents() });
    await page.screenshot({ path: '.volcengine-build/checkout-failure.png' });
  }
  throw error;
} finally { await browser.close(); }
