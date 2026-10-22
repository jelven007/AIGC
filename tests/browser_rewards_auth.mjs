import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const first = '11111111-1111-4111-8111-111111111111', second = '99999999-9999-4999-8999-999999999999';
const daily = '22222222-2222-4222-8222-222222222222', video = '33333333-3333-4333-8333-333333333333';
const unsupported = '44444444-4444-4444-8444-444444444444';
const sessionFor = id => ({ access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id, email: `${id === first ? 'first' : 'second'}@example.com`, created_at: '2026-10-01T00:00:00Z', app_metadata: {}, user_metadata: {} } });
const state = { failInvite: true, failActivities: true, failClaim: true, holdClaim: false, failReport: true, crash: false,
  failPassword: true, claims: [], receipts: [], reports: [], inviteReads: [], writes: [], auth: [], holdInvite: false, heldInvite: false, errors: [] };
let releaseInvite, releaseClaim;
const inviteGate = new Promise(resolve => { releaseInvite = resolve; });
const claimGate = new Promise(resolve => { releaseClaim = resolve; });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await context.addInitScript(session => {
  if (!localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
    if (window.clipboardFail !== false) throw new Error('denied');
    window.copiedValue = text;
  } } });
}, sessionFor(first));
const activities = id => [
  { id: daily, title: '每日签到', description: '每日一次，原请求可以恢复。', type: 'daily_checkin', reward_credits: 5, max_times: 0,
    completed_times: state.receipts.filter(row => row.user === id).length, eligibility: state.receipts.some(row => row.user === id) ? 'claimed_today' : 'eligible',
    next_claim_at: '2026-10-23T00:00:00Z' },
  { id: video, title: '首次视频', description: '需要后台完成凭证。', type: 'video_first', reward_credits: 10, max_times: 1, completed_times: 0, eligibility: 'video_required' },
  { id: unsupported, title: '加入社区', description: '等待服务端核验。', type: 'join_community', reward_credits: 5, max_times: 1, completed_times: 0, eligibility: 'evidence_required' },
];
await context.route(`${backend}/**`, async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  let id = first, body = {};
  try { id = JSON.parse(Buffer.from((req.headers().authorization || '').split('.')[1], 'base64url')).sub; } catch {}
  try { body = req.postDataJSON() || {}; } catch {}
  let data = [], status = 200;
  if (req.method() === 'OPTIONS') data = {};
  else if (path.endsWith('/auth/v1/user') && req.method() === 'PUT') {
    state.auth.push({ id, body });
    if (state.failPassword) { state.failPassword = false; status = 503; data = { message: '密码暂时无法更新' }; }
    else data = sessionFor(id).user;
  } else if (path.endsWith('/auth/v1/signup')) { state.auth.push({ path, body }); data = { ...sessionFor(first).user, identities: [] }; }
  else if (path.endsWith('/auth/v1/recover')) { state.auth.push({ path, body }); data = {}; }
  else if (path.includes('/auth/')) data = sessionFor(id).user;
  else if (path.endsWith('/rest/v1/profiles')) {
    if (req.method() !== 'GET') { state.writes.push(body); status = 403; data = {}; }
    else data = { id, username: id === first ? '第一位用户' : '第二位用户', role: 'user', notification_enabled: false };
  } else if (path.endsWith('/rest/v1/user_plans')) data = { credits_total: 1000, credits_used: 0, plan: { name: '专业版' } };
  else if (path.endsWith('/rpc/get_my_invitations')) {
    state.inviteReads.push({ id, body });
    if (state.holdInvite && id === first) { state.heldInvite = true; await inviteGate; }
    const total = id === first ? 1105 : 1;
    data = { total, completed: 1, credits: 50, legacy: id === first ? 1104 : 0, invite_code: id === first ? 'FIRST123456789AB' : 'SECOND123456789A',
      items: Array.from({ length: Math.min(20, total - body.p_offset) }, (_, i) => ({
        id: `inv-${id}-${body.p_offset + i}`, created_at: '2026-10-22T00:00:00Z', status: 'completed', reward_credits: 50,
        invitee_label: `${id === first ? '第一' : '第二'}账号受邀用户 ${body.p_offset + i}`, legacy: id === first && i > 0,
        granted_at: i === 0 ? '2026-10-22T00:00:00Z' : null, credited: i === 0 ? 50 : null,
      })) };
    if (state.failInvite) { state.failInvite = false; status = 503; data = { message: 'read failed' }; }
  } else if (path.endsWith('/rpc/get_my_activities')) {
    data = { items: activities(id), server_time: '2026-10-22T00:00:00Z', checkin_timezone: 'UTC' };
    if (state.crash) data.items[0].title = { invalid: 'render crash fixture' };
    if (state.failActivities) { state.failActivities = false; status = 503; data = { message: 'activity failed' }; }
  } else if (path.endsWith('/rpc/claim_activity_reward')) {
    state.claims.push({ id, body });
    let receipt = state.receipts.find(row => row.user === id && row.request_key === body.p_request_key);
    const existing = !!receipt;
    if (!receipt) { receipt = { user: id, request_key: body.p_request_key, reward: 5, balance: 1005 }; state.receipts.push(receipt); }
    data = { ok: true, already_claimed: existing, ...receipt };
    if (state.holdClaim) await claimGate;
    if (state.failClaim) { state.failClaim = false; status = 503; data = { message: 'response lost' }; }
  } else if (path.endsWith('/rpc/report_frontend_error')) {
    state.reports.push({ id, body });
    data = { ok: true, id: 'report-fixture', request_key: body.p_request_key };
    if (state.failReport) { state.failReport = false; status = 503; data = { message: 'report response lost' }; }
  } else if (path.endsWith('/video-jobs') || path.endsWith('/production-jobs')) data = { jobs: [] };
  else if (path.endsWith('/batch-video-jobs')) data = { batches: [] };
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
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
  await page.goto(`${base}/invite`);
  await page.getByRole('alert').filter({ hasText: '邀请记录读取失败' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '复制邀请码', exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('专属邀请链接', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: '刷新邀请', exact: true }).click();
  await page.getByText('1,105', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('第 2 / 56 页', { exact: true }).waitFor();
  await page.getByText('第一账号受邀用户 20', { exact: true }).first().waitFor();
  assert.equal(state.inviteReads.at(-1).body.p_offset, 20);
  await page.getByRole('button', { name: '复制邀请码', exact: true }).click();
  await page.getByText('复制失败，请手动选择并复制', { exact: true }).waitFor();
  assert.equal(await page.getByText('邀请码已复制', { exact: true }).count(), 0);
  await page.evaluate(() => { window.clipboardFail = false; });
  await page.getByRole('button', { name: '复制邀请链接', exact: true }).click();
  await page.getByText('邀请链接已复制', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.copiedValue), `${base}/login?mode=register&invite=FIRST123456789AB`);
  await page.getByRole('button', { name: '生成分享海报', exact: true }).click();
  const poster = page.getByRole('img', { name: /包含专属邀请二维码/ });
  await poster.waitFor();
  assert.deepEqual(await poster.evaluate(image => [image.naturalWidth, image.naturalHeight]), [750, 1100]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '保存海报', exact: true }).click()]);
  await download.saveAs('.volcengine-build/iteration32-invite-poster.png');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('邀请链接已复制', { exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: '.volcengine-build/iteration32-invite-390.png', fullPage: true });
  state.holdInvite = true;
  await page.getByRole('button', { name: '刷新邀请', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('正在读取邀请记录'));
  await switchAccount(second);
  await page.getByLabel('专属邀请链接', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('input[id^="invite-url"]')?.value.includes('SECOND'));
  releaseInvite(); state.holdInvite = false;
  assert.match(await page.getByLabel('专属邀请链接', { exact: true }).inputValue(), /SECOND/);
  assert.equal(await page.getByText('1,105', { exact: true }).count(), 0);
  console.log('PASS 邀请失败未知统计/空链接禁用、完整1105统计与分页、真实剪贴板回执、实际海报PNG下载、跨账号迟到响应隔离');

  await switchAccount(first);
  await page.goto(`${base}/activities`);
  await page.getByRole('alert').filter({ hasText: '活动数据读取失败' }).waitFor();
  await page.getByRole('button', { name: '刷新活动', exact: true }).click();
  await page.getByRole('button', { name: '领取奖励', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '需完成一次视频生成', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '需核验完成凭证', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '领取奖励', exact: true }).click();
  await page.getByText('领取结果尚未确认，请恢复原请求', { exact: true }).waitFor();
  const original = state.claims.at(-1).body.p_request_key;
  await page.reload();
  await page.getByRole('button', { name: '恢复原领取', exact: true }).click();
  await page.getByText('原领取已确认：5 积分已入账', { exact: true }).waitFor();
  assert.equal(state.receipts.filter(row => row.user === first).length, 1);
  assert.equal(state.claims.at(-1).body.p_request_key, original);
  await page.getByRole('button', { name: '今日已签到', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '今日已签到', exact: true }).isDisabled(), true);
  await page.getByText('原领取已确认：5 积分已入账', { exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: '.volcengine-build/iteration32-activities-390.png', fullPage: true });
  await switchAccount(second);
  await page.getByRole('button', { name: '领取奖励', exact: true }).waitFor();
  state.holdClaim = true;
  await page.getByRole('button', { name: '领取奖励', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('领取中'));
  await switchAccount(first);
  await page.getByRole('button', { name: '今日已签到', exact: true }).waitFor();
  releaseClaim(); state.holdClaim = false;
  assert.equal(state.receipts.filter(row => row.user === second).length, 1);
  assert.equal(await page.getByText('已获得 5 积分奖励', { exact: true }).count(), 0);
  console.log('PASS 活动加载失败恢复、真实资格按钮、响应丢失刷新复用原UUID单赠分、当前UTC日禁重领、写入令牌与迟到跨账号提示隔离');

  state.crash = true;
  await page.getByRole('button', { name: '刷新活动', exact: true }).click();
  await page.getByRole('button', { name: '一键上报异常', exact: true }).waitFor();
  await page.getByRole('button', { name: '一键上报异常', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '异常记录尚未确认' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '异常记录已提交', exact: true }).count(), 0);
  await page.getByRole('button', { name: '一键上报异常', exact: true }).click();
  await page.getByRole('button', { name: '异常记录已提交', exact: true }).waitFor();
  assert.equal(state.reports[0].body.p_request_key, state.reports[1].body.p_request_key);
  assert.deepEqual(Object.keys(state.reports[0].body).sort(), ['p_path', 'p_request_key']);
  state.crash = false;
  await page.getByRole('button', { name: '尝试恢复', exact: true }).click();
  await page.getByRole('heading', { name: '活动奖励', exact: true }).waitFor();
  assert.equal(state.writes.length, 0);
  console.log('PASS 真正渲染错误捕获、上报失败无伪成功、重试复用原回执、不传查询参数/堆栈/密码、页面恢复');

  await page.goto(`${base}/auth/reset`);
  await page.getByLabel('新密码', { exact: true }).fill('isolated-password-only');
  await page.getByLabel('再次输入新密码', { exact: true }).fill('isolated-password-only');
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '密码暂时无法更新' }).waitFor();
  assert.equal(await page.getByLabel('新密码', { exact: true }).inputValue(), 'isolated-password-only');
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await page.getByText('密码已更新。', { exact: true }).waitFor();
  assert.equal(state.auth.filter(row => row.id === first).length, 2);
  await switchAccount(second);
  await page.getByLabel('新密码', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('新密码', { exact: true }).inputValue(), '');
  console.log('PASS 密码重置独立入口、更新失败保留输入、当前账号真实成功回执、账号切换重建表单');

  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await anonymous.route(`${backend}/**`, async route => {
    const req = route.request(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') state.auth.push({ path, body });
    const data = path.endsWith('/signup') ? { ...sessionFor(first).user, identities: [] } : {};
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const guest = await anonymous.newPage();
  await guest.goto(`${base}/login?mode=register&invite=first123456789ab`);
  await guest.getByLabel('邮箱账号', { exact: true }).fill('registered@example.com');
  await guest.getByLabel('密码', { exact: true }).fill('isolated-password-only');
  await guest.getByLabel('确认密码', { exact: true }).fill('isolated-password-only');
  await guest.getByRole('checkbox').check();
  await guest.getByRole('button', { name: /立\s*即\s*注\s*册/ }).click();
  await guest.getByText('请查收验证邮件后登录；若邮箱已注册，请直接登录', { exact: true }).waitFor();
  const signup = state.auth.find(row => row.path?.endsWith('/signup'));
  assert.equal(signup.body.data.invited_by_code, 'FIRST123456789AB');
  assert.equal(state.auth.some(row => row.path?.includes('/profiles')), false);
  await guest.goto(`${base}/auth/reset`);
  await guest.getByRole('link', { name: '重新申请重置链接', exact: true }).waitFor();
  await guest.getByRole('link', { name: '重新申请重置链接', exact: true }).click();
  await guest.getByLabel('邮箱地址', { exact: true }).fill('registered@example.com');
  await guest.getByRole('button', { name: /发送重置/ }).click();
  await guest.getByText('重置链接已发送', { exact: true }).waitFor();
  assert.equal(state.auth.some(row => row.path?.endsWith('/recover')), true);
  await anonymous.close();
  console.log('PASS 注册邀请码标准化、已有邮箱不冒充注册成功、无浏览器档案upsert、失效重置会话可重新申请');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  assert.equal(state.errors.every(error => /Objects are not valid as a React child/.test(error)), true, state.errors.join('\n'));
} finally { releaseInvite(); releaseClaim(); await browser.close(); }
