import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const channel = process.env.CASH_TEST_CHANNEL || 'alipay';
const uid = '11111111-1111-4111-8111-111111111111', customer = '22222222-2222-4222-8222-222222222222';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let allowed = true, failRefund = true, refundSuccess = false, failBudget = true, rejectBudget = false;
  let budget = 0;
  const refunds = [], mutations = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/operations')) {
      if (body.action === 'access') data = { root: true, grants: [], permissions: allowed
        ? ['orders:read', 'refunds:write', 'customers:read', 'budgets:write', 'jobs:read', 'audit:read', 'operators:write'] : [] };
      if (body.action === 'list') data = { items: body.domain === 'orders'
        ? [{ id: customer, order_no: 'order-1', total_amount: 10, refunded_amount: 0, plan_name: '专业版', status: 'paid', pay_channel: channel }]
        : body.domain === 'customers' ? [{ id: customer, username: '真实客户', email: 'customer@example.com', credit_balance: -5, daily_credit_budget: budget, plan_status: 'active' }] : [],
        total: ['orders', 'customers'].includes(body.domain) ? 1 : 0, page: body.page, observed_at: new Date().toISOString() };
      if (body.action === 'mutate') {
        mutations.push(body);
        if (rejectBudget) { status = 409; data = { error: '预算版本已变化，请刷新后重试', outcome: 'rejected' }; }
        else { budget = body.payload.amount;
          status = failBudget ? 503 : 200; data = failBudget ? { error: '操作受理待确认', outcome: 'unknown' } : { daily_credit_budget: budget }; }
      }
    } else if (path.endsWith('/alipay-trade-ops') || path.endsWith('/wechat-trade-ops')) {
      assert.ok(path.endsWith(`/${channel}-trade-ops`));
      refunds.push(body);
      if (body.action === 'refund' && failRefund) { status = 503; data = { code: 1, message: '退款受理待确认', outcome: 'unknown' }; }
      else data = { code: 0, data: { refund_status: refundSuccess ? 'success' : 'unknown', request_key: body.request_key } };
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试运营', invite_code: 'TEST' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版' } };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/operations');
  await page.getByRole('button', { name: '申请退款', exact: true }).click();
  await page.getByLabel('退款金额', { exact: false }).fill('3.33');
  await page.getByLabel('退款原因', { exact: true }).fill('用户退订');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('退款受理待确认', { exact: true }).waitFor();
  assert.equal(refunds.length, 1); assert.equal(refunds[0].refund_amount, '3.33');
  assert.equal(await page.evaluate(uid => JSON.parse(localStorage.getItem(`shopro-operator-request-${uid}`)).channel, uid), channel);
  assert.equal(await page.getByRole('button', { name: '确认并提交', exact: true }).isEnabled(), false);
  await page.reload(); failRefund = false;
  await page.getByRole('button', { name: '按原参数恢复', exact: true }).click();
  await page.getByText('原退款已登记，资金结果待确认；请稍后核对原申请', { exact: true }).waitFor();
  assert.deepEqual(refunds[0], refunds[1]);
  assert.equal(await page.getByRole('button', { name: '申请退款', exact: true }).isEnabled(), false);
  refundSuccess = true;
  await page.getByRole('button', { name: '核对原退款', exact: true }).click();
  await page.getByText('退款已到账，权益回收已入账', { exact: true }).waitFor();
  assert.equal(refunds[2].request_key, refunds[0].request_key);
  assert.equal(await page.evaluate(uid => localStorage.getItem(`shopro-operator-request-${uid}`), uid), null);
  console.log('PASS 退款503锁定参数，刷新后同UUID恢复；未知不允许新申请，核对成功清理原回执');

  await page.getByRole('button', { name: '客户与预算', exact: true }).click();
  await page.getByRole('button', { name: '设置日预算', exact: true }).click();
  await page.getByLabel('日积分预算', { exact: true }).fill('25');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('操作受理待确认', { exact: true }).waitFor();
  await page.reload(); failBudget = false;
  await page.getByRole('button', { name: '按原参数恢复', exact: true }).click();
  await page.getByText('运营操作已生效', { exact: true }).waitFor();
  assert.deepEqual(mutations[0], mutations[1]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/operations-mobile.png', fullPage: true });
  console.log('PASS 预算变更503刷新按原版本/原UUID恢复，390px表格内部滚动，无页面横向溢出');
  await page.getByRole('button', { name: '客户与预算', exact: true }).click();
  await page.getByRole('button', { name: '设置日预算', exact: true }).click();
  await page.getByLabel('日积分预算', { exact: true }).fill('26');
  rejectBudget = true;
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('预算版本已变化，请刷新后重试', { exact: true }).waitFor();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(uid => localStorage.getItem(`shopro-operator-request-${uid}`), uid), null);
  assert.equal(await page.getByRole('button', { name: '设置日预算', exact: true }).isEnabled(), true);
  console.log('PASS 预算确定拒绝后释放本地申请锁，保持原服务器预算并允许刷新后重试');
  allowed = false; await page.reload();
  await page.getByText('当前账号没有运营权限，请联系系统管理员分配角色与客户范围。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '申请退款', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS 服务端撤销权限后页面不显示运营数据或资金按钮，真实浏览器无运行错误');
} finally { await browser.close(); }
