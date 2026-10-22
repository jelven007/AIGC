import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const order = { id, order_no: 'a'.repeat(32), status: 'pending', total_amount: 10, refunded_amount: 0, pay_channel: 'wechat',
    created_at: new Date().toISOString(), paid_at: null, plan_id: null,
    wechat_pay_url: 'weixin://wxpay/bizpayurl?pr=original',
    wechat_expires_at: new Date(Date.now() + 1800000).toISOString(), wechat_close_requested_at: null };
  const calls = [], errors = [];
  let failClose = true, payDuringClose = false;
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试用户' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    else if (path.includes('/rest/v1/orders')) data = order;
    else if (path.endsWith('/wechat-trade-ops')) {
      calls.push(body);
      if (body.action === 'close') {
        order.wechat_close_requested_at = new Date().toISOString();
        if (failClose) { status = 503; data = { code: 1, message: '关闭结果待确认', outcome: 'unknown' }; }
      }
      if (body.action === 'query' && payDuringClose) { order.status = 'paid'; order.paid_at = new Date().toISOString(); }
      if (status === 200) data = { code: 0, data: { local_status: order.status, checking: order.status === 'pending' } };
    } else if (path.endsWith('/read_notifications')) data = { items: [], total: 0, unread: 0, unread_all: 0, preferences: {} };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/order/${id}`);
  await page.getByRole('heading', { name: '订单详情', exact: true }).waitFor();
  await page.getByAltText('QR Code', { exact: true }).waitFor();
  await page.getByText(/剩余 \d+分\d+秒/).waitFor();
  await page.getByRole('button', { name: '核对支付结果', exact: true }).waitFor();
  order.wechat_expires_at = new Date(Date.now() - 1000).toISOString();
  await page.getByRole('button', { name: '核对支付结果', exact: true }).click();
  await page.getByText('二维码已到期，后台正在核对原订单', { exact: true }).waitFor();
  assert.equal(await page.getByAltText('QR Code', { exact: true }).count(), 0);
  assert.equal(await page.getByText('已取消', { exact: true }).count(), 0);
  assert.ok(calls.every(call => call.order_no === order.order_no));
  console.log('PASS 微信原二维码倒计时，到期隐藏二维码且不伪报取消，本人查单只使用原订单');
  await page.getByRole('button', { name: '关闭原订单', exact: true }).click();
  await page.getByRole('button', { name: '确认关闭原订单', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '关闭结果待确认' }).waitFor();
  assert.equal(calls.at(-1).action, 'close');
  await page.reload();
  await page.getByText('原订单关闭中，请核对最终支付结果', { exact: true }).waitFor();
  assert.equal(await page.getByAltText('QR Code', { exact: true }).count(), 0);
  await page.screenshot({ path: '.volcengine-build/wechat-close-mobile.png', fullPage: true });
  payDuringClose = true;
  await page.getByRole('button', { name: '核对支付结果', exact: true }).click();
  await page.getByText('支付成功，套餐权益已自动开通', { exact: true }).waitFor();
  assert.equal(await page.getByText('已取消', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '关闭原订单', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS 关单503与刷新保留原关闭状态，竞争付款核对后展示已支付，390px无溢出/运行错误');
} finally { await browser.close(); }
