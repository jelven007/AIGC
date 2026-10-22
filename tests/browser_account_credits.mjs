import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const first = '11111111-1111-4111-8111-111111111111', second = '99999999-9999-4999-8999-999999999999';
const sessionFor = (id, phone) => ({ access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id, phone, email: `${id === first ? 'first' : 'second'}@example.com`, created_at: '2026-10-01T00:00:00Z', app_metadata: {}, user_metadata: {} } });
const state = { failCredits: true, overrides: {}, reads: [], errors: [], holdCredit: false, heldCredit: false,
  holdNotification: false, heldNotification: false, notifications: [], holdVerify: false, heldVerify: false,
  failSend: true, unknownSend: false, failVerify: true, otp: [], verifies: [], mismatch: false };
let releaseCredit, releaseNotification, releaseVerify;
const creditGate = new Promise(resolve => { releaseCredit = resolve; });
const notificationGate = new Promise(resolve => { releaseNotification = resolve; });
const verifyGate = new Promise(resolve => { releaseVerify = resolve; });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await context.addInitScript(value => {
  if (!localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
}, sessionFor(first));
async function reply(route, data, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
}
await context.route(`${backend}/**`, async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  let id = first, body = {};
  try { id = JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub; } catch {}
  try { body = req.postDataJSON() || {}; } catch {}
  let data = [], status = 200;
  if (req.method() === 'OPTIONS') data = {};
  else if (path.includes('/auth/')) data = sessionFor(id).user;
  else if (path.endsWith('/rpc/get_my_credits')) {
    state.reads.push({ id, body });
    data = creditSnapshot(id, id === first ? { plan_name: '创作套餐A', ...state.overrides } : { credits_used: 900, credits_left: 100, plan_name: '第二账号套餐' });
    if (state.holdCredit && id === first) { state.heldCredit = true; await creditGate; }
    if (state.failCredits) { status = 503; data = { message: 'temporary outage' }; }
  } else if (path.endsWith('/profiles')) data = { id, username: id === first ? '第一位用户' : '第二位用户', role: 'user' };
  else if (path.endsWith('/plans')) data = [{ id: creditSnapshot(id).plan_id, name: '创作套餐A', level: 1, price: 100, credits: 1000, features: [] }];
  else if (path.endsWith('/rpc/read_notifications')) data = {
    items: [{ id: `notification-${id}`, title: id === first ? '第一账号通知' : '第二账号通知', body: '已完成任务', category: 'jobs',
      level: 'success', action_path: '/task-queue', source_id: 'job', read_at: null, created_at: new Date().toISOString() }],
    total: 1, unread: 1, unread_all: 1, cutoff: new Date().toISOString(), preferences: { task_success: true, intelligence_success: true },
  };
  else if (path.endsWith('/rpc/mutate_notifications')) {
    state.notifications.push({ id, body });
    if (state.holdNotification) { state.heldNotification = true; await notificationGate; }
    status = 503; data = { message: '原账号通知写入失败' };
  } else if (path.endsWith('/model-settings')) data = { configs: [] };
  else if (path.endsWith('/batch-video-jobs')) data = body.action === 'quote'
    ? { unit_cost: 10, pipeline_costs: { video: 10, tts: 3, subtitles: 5, render: 0 } } : { batches: [] };
  else if (path.endsWith('/video-jobs') || path.endsWith('/production-jobs')) data = { jobs: [] };
  await reply(route, data, status);
});
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', error => state.errors.push(error.message));
async function switchAccount(id) {
  const helper = await context.newPage(); await helper.goto(`${base}/landing`);
  await helper.evaluate(value => {
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
    const channel = new BroadcastChannel('sb-ui-fixture-auth-token');
    channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
  }, sessionFor(id));
  await helper.close();
}
try {
  await page.goto(`${base}/batch-create`);
  await page.getByRole('alert').filter({ hasText: '套餐权益暂时无法核验' }).waitFor();
  assert.equal(await page.getByText('需升级套餐后解锁', { exact: true }).count(), 0);
  assert.equal(state.reads.length, 2, '多个消费者共享一个初始请求及一次重试');
  state.failCredits = false;
  await page.getByRole('button', { name: '重试权益核验', exact: true }).click();
  await page.getByRole('heading', { name: '批量生成工作台', exact: true }).waitFor();
  assert.equal(state.reads.length, 3, '套餐名不含pro/专业仍按真实等级通过');
  await page.goto(`${base}/credits?tab=overview`);
  await page.getByText('当前套餐：创作套餐A', { exact: true }).waitFor();
  state.overrides = { expires_at: '2026-01-01T00:00:00Z', entitlement_active: false, plan_level: 0, credits_used: 289, credits_left: 711 };
  await page.getByRole('button', { name: '刷新余额与权益', exact: true }).click();
  await page.getByText('已过期', { exact: true }).waitFor();
  await page.getByText('剩余 711 积分', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '套餐对比 · 尊享特权', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '当前使用中', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '选择套餐', exact: true }).isEnabled(), true);
  await page.goto(`${base}/batch-create`);
  await page.getByText('需升级套餐后解锁', { exact: true }).waitFor();
  console.log('PASS 积分共享请求/失败不假降级、自定义名称按等级通过、到期仍保留真实余额且可以续购');

  await page.goto(`${base}/credits?tab=overview`);
  const serverTime = new Date(Date.now() + 86400000);
  state.overrides = { server_time: serverTime.toISOString(), expires_at: new Date(serverTime.getTime() + 3000).toISOString(), entitlement_active: true, plan_level: 1 };
  await page.getByRole('button', { name: '刷新余额与权益', exact: true }).click();
  await page.getByText('生效中', { exact: true }).waitFor();
  await page.goto(`${base}/batch-create`);
  await page.getByRole('heading', { name: '批量生成工作台', exact: true }).waitFor();
  await page.getByText('需升级套餐后解锁', { exact: true }).waitFor();
  await page.goto(`${base}/credits?tab=overview`);
  await page.getByText('当前套餐：创作套餐A', { exact: true }).waitFor();
  state.holdCredit = true; state.overrides = {};
  await page.getByRole('button', { name: '刷新余额与权益', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button') && [...document.querySelectorAll('button')].some(button => button.textContent === '刷新余额与权益' && button.disabled));
  await switchAccount(second);
  await page.getByText('当前套餐：第二账号套餐', { exact: true }).waitFor();
  assert.equal(state.heldCredit, true);
  releaseCredit(); state.holdCredit = false;
  await page.getByRole('button', { name: '刷新余额与权益', exact: true }).click();
  await page.getByText('剩余 100 积分', { exact: true }).waitFor();
  assert.equal(await page.getByText('当前套餐：创作套餐A', { exact: true }).count(), 0);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '刷新余额与权益' && !button.disabled));
  await page.screenshot({ path: '.volcengine-build/iteration33-credits-390.png', fullPage: true });
  console.log('PASS 服务端时钟偏差/在页到期自动拒绝、共享缓存取消旧账号请求、迟到余额不会覆盖新账号');

  await switchAccount(first);
  await page.goto(`${base}/notifications`);
  await page.getByRole('heading', { name: '第一账号通知', exact: false }).waitFor();
  state.holdNotification = true;
  await page.getByRole('button', { name: '全部标记已读', exact: true }).click();
  await switchAccount(second);
  await page.getByRole('heading', { name: '第二账号通知', exact: false }).waitFor();
  releaseNotification(); state.holdNotification = false;
  assert.equal(state.heldNotification, true);
  assert.equal(state.notifications[0].id, first);
  assert.equal(await page.getByText('原账号通知写入失败', { exact: true }).count(), 0);
  await page.getByRole('link', { name: '查看详情', exact: true }).click();
  await page.getByRole('heading', { name: /任务/ }).first().waitFor();
  assert.equal(await page.getByText('原账号通知写入失败', { exact: true }).count(), 0);
  console.log('PASS 通知读写固定原账号令牌、账号切换后失败无旧提示、查看详情离页不弹迟到错误');

  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await anonymous.route('https://legal-fixture.example/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>隔离测试协议资源</h1>' }));
  await anonymous.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = {}, status = 200;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.endsWith('/otp')) {
      state.otp.push(body);
      if (state.failSend) { state.failSend = false; status = 400; data = { message: '短信服务暂不可用' }; }
      else if (state.unknownSend) { state.unknownSend = false; status = 503; data = { message: '发送响应丢失' }; }
    } else if (path.endsWith('/verify')) {
      state.verifies.push(body);
      if (state.holdVerify) { state.heldVerify = true; await verifyGate; }
      data = sessionFor(first, state.mismatch ? '8613900139000' : body.phone.slice(1));
      if (state.failVerify) { state.failVerify = false; status = 400; data = { message: '验证码错误' }; }
    } else if (path.endsWith('/user')) data = sessionFor(first, '8613800138000').user;
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(first);
    else if (path.endsWith('/profiles')) data = { id: first, username: '已验证手机用户', role: 'user' };
    else if (path.endsWith('/plans')) data = [];
    await reply(route, data, status);
  });
  const guest = await anonymous.newPage(); guest.setDefaultTimeout(15000);
  await guest.goto(`${base}/login?mode=register&invite=first123456789ab&redirect=${encodeURIComponent('/credits?tab=plans')}`);
  const [legal] = await Promise.all([guest.waitForEvent('popup'), guest.getByRole('link', { name: '《用户协议》', exact: true }).click()]);
  await legal.getByRole('heading', { name: '隔离测试协议资源', exact: true }).waitFor();
  assert.equal(await guest.getByRole('checkbox').isChecked(), false); await legal.close();
  await guest.getByRole('button', { name: '手机号验证码注册', exact: true }).click();
  await guest.getByRole('checkbox').check();
  await guest.getByLabel('手机号', { exact: true }).fill('12345678901');
  await guest.getByRole('button', { name: '获取验证码', exact: true }).click();
  await guest.getByRole('alert').filter({ hasText: '请输入有效手机号' }).waitFor();
  assert.equal(state.otp.length, 0);
  await guest.getByLabel('手机号', { exact: true }).fill('+86 138 0013 8000');
  await guest.getByRole('button', { name: '获取验证码', exact: true }).click();
  await guest.getByText('短信服务暂不可用', { exact: true }).waitFor();
  assert.equal(await guest.getByLabel('手机号', { exact: true }).inputValue(), '+86 138 0013 8000');
  state.unknownSend = true;
  await guest.getByRole('button', { name: '获取验证码', exact: true }).click();
  await guest.getByLabel('验证码', { exact: true }).waitFor();
  await guest.getByText('验证码发送结果暂未确认；若已收到可继续验证，或等待60秒后重发', { exact: true }).waitFor();
  assert.equal(await guest.getByRole('button', { name: /s 后重发/ }).isDisabled(), true);
  assert.equal(await guest.getByText('验证码已发送，请注意查收', { exact: true }).count(), 0);
  assert.equal(await guest.getByLabel('手机号', { exact: true }).isDisabled(), true);
  assert.equal(state.otp.length, 2);
  assert.equal(state.otp.at(-1).phone, '+8613800138000');
  assert.equal(state.otp.at(-1).create_user, true);
  assert.equal(state.otp.at(-1).data.invited_by_code, 'FIRST123456789AB');
  await guest.getByLabel('验证码', { exact: true }).fill('a12345');
  await guest.getByRole('button', { name: '验证并登录', exact: true }).click();
  await guest.getByText('请输入6位数字验证码', { exact: true }).waitFor();
  assert.equal(state.verifies.length, 0);
  await guest.getByLabel('验证码', { exact: true }).fill('123456');
  await guest.getByRole('button', { name: '验证并登录', exact: true }).click();
  await guest.getByText('验证码错误', { exact: true }).waitFor();
  assert.equal(await guest.getByLabel('验证码', { exact: true }).inputValue(), '123456');
  state.mismatch = true;
  await guest.getByRole('button', { name: '验证并登录', exact: true }).click();
  await guest.getByText('登录会话回执不完整，请重试或联系支持', { exact: true }).waitFor();
  assert.equal(await guest.evaluate(() => localStorage.getItem('sb-ui-fixture-auth-token')), null);
  state.mismatch = false;
  await guest.screenshot({ path: '.volcengine-build/iteration33-sms-390.png', fullPage: true });
  await guest.getByRole('button', { name: '验证并登录', exact: true }).click();
  await guest.getByRole('heading', { name: '积分与套餐', exact: true }).waitFor();
  assert.match(guest.url(), /\/credits\?tab=plans$/);
  assert.equal(state.verifies.at(-1).phone, '+8613800138000');
  console.log('PASS 正式协议资源可打开且不代勾选、手机/OTP格式、失败保留输入、锁定原号码、邀请码新注册、错误会话不登录、成功保留redirect');
  await anonymous.close();

  const cancelled = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await cancelled.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (route.request().method() === 'OPTIONS') data = {};
    else if (path.endsWith('/otp')) { state.otp.push(route.request().postDataJSON()); }
    else if (path.endsWith('/verify')) { state.heldVerify = true; await verifyGate; data = sessionFor(first, '14155552671'); }
    await reply(route, data);
  });
  const cancelPage = await cancelled.newPage();
  await cancelPage.goto(`${base}/login?mode=phone`);
  await cancelPage.getByLabel('手机号', { exact: true }).fill('+14155552671');
  await cancelPage.getByRole('button', { name: '获取验证码', exact: true }).click();
  await cancelPage.getByLabel('验证码', { exact: true }).fill('123456');
  assert.equal(state.otp.at(-1).create_user, false);
  state.holdVerify = true;
  await cancelPage.getByRole('button', { name: '验证并登录', exact: true }).click();
  await cancelPage.getByRole('button', { name: '返回注册', exact: true }).click();
  assert.equal(state.heldVerify, true);
  releaseVerify();
  await cancelPage.getByRole('heading', { name: '创建账号', exact: true }).waitFor();
  assert.equal(await cancelPage.evaluate(() => localStorage.getItem('sb-ui-fixture-auth-token')), null);
  await cancelled.close();
  console.log('PASS 国际E.164已有账号登录不创建用户、退出短信页面后验证晚响应不建立全局会话');
  assert.deepEqual(state.errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
} finally { releaseCredit(); releaseNotification(); releaseVerify(); await browser.close(); }
