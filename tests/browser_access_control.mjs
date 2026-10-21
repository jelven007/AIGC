/** 本地页面 + API夹具；不创建线上密钥、团队或发送邀请。 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => {
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
    localStorage.setItem('shopro_open_api_keys_cache', JSON.stringify([{ id: 'fake-key', name: '不能出现的本地Key' }]));
    localStorage.setItem('shopro_team_space_store', JSON.stringify({ team: { name: '不能出现的本地团队' } }));
  }, session);
  let listFail = true, createFail = true, revokeFail = true, inviteFail = true, team = null;
  const key = { id: 'key', name: '正式服务', key_prefix: 'ak_live_fixture', scopes: ['video:create', 'video:read'],
    rate_limit: 100, total_calls: 0, is_active: true, expires_at: '2027-01-01' };
  let keys = [], members = [], shared = [];
  const calls = [];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    calls.push({ path, method: request.method(), body });
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/api-keys')) {
      if (body.action === 'list') { data = listFail ? { error: '密钥服务暂时不可用' } : { keys }; status = listFail ? 503 : 200; }
      if (body.action === 'create') {
        status = createFail ? 503 : 201;
        data = createFail ? { error: '密钥保存失败' } : { key, raw_key: `ak_live_${'a'.repeat(64)}` };
        if (!createFail) keys = [key];
      }
      if (body.action === 'revoke') {
        status = revokeFail ? 503 : 200; data = revokeFail ? { error: '密钥撤销失败' } : { ok: true };
        if (!revokeFail) keys = keys.map(item => ({ ...item, is_active: false }));
      }
    } else if (path.endsWith('/team-space')) {
      if (body.action === 'get') data = { team, members };
      if (body.action === 'create') {
        team = { id: 'team', name: body.name, owner_id: uid, max_members: 5 };
        members = [{ id: 'owner', user_id: uid, role: 'owner' }]; data = { result: team };
      }
      if (body.action === 'invite') {
        status = inviteFail ? 409 : 200; data = inviteFail ? { error: '邀请保存失败' } : { result: { token: 'b'.repeat(48) } };
      }
    } else if (path.endsWith('/material-assets')) {
      if (body.action === 'shared') data = { materials: shared };
      if (body.action === 'share') { shared = [{ id: 'mat', user_id: uid, name: '私有商品素材', url: `${backend}/file.png` }]; data = { ok: true }; }
      if (body.action === 'unshare') { shared = []; data = { ok: true }; }
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '本地测试', invite_code: 'TESTUSER', role: 'user' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 10, plans: { name: '免费版' } };
    else if (path.includes('/rest/v1/materials')) data = [{ id: 'mat', user_id: uid, name: '私有商品素材', url: `${backend}/file.png` }];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/open-api`);
  await page.getByRole('alert').filter({ hasText: '密钥服务暂时不可用' }).waitFor();
  assert.equal(await page.getByText('不能出现的本地Key').count(), 0);
  listFail = false; await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('还没有 API Key', { exact: true }).waitFor();
  await page.getByRole('button', { name: '创建 Key', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('正式服务');
  await page.getByRole('button', { name: '生成密钥', exact: true }).click();
  await page.getByText('密钥保存失败', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('新 API Key').count(), 0);
  assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), '正式服务');
  createFail = false; await page.getByRole('button', { name: '生成密钥', exact: true }).click();
  await page.getByLabel('新 API Key').waitFor();
  assert.match(await page.getByLabel('新 API Key').inputValue(), /^ak_live_/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '撤销 正式服务', exact: true }).click();
  await page.getByText('密钥撤销失败', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '撤销 正式服务', exact: true }).count(), 1);
  revokeFail = false; await page.getByRole('button', { name: '撤销 正式服务', exact: true }).click();
  await page.getByText('已停用或过期', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/access-keys-mobile.png', fullPage: true });
  console.log('PASS 密钥页服务故障/空列表、创建失败保留表单、只在服务确认后显示密钥、撤销失败保留有效状态');
  await page.goto(`${base}/team`);
  await page.getByText('还没有团队', { exact: true }).waitFor();
  assert.equal(await page.getByText('不能出现的本地团队').count(), 0);
  await page.getByRole('button', { name: '创建团队', exact: true }).click();
  await page.getByLabel('团队名称', { exact: true }).fill('真实团队');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('heading', { name: '真实团队', exact: true }).waitFor();
  await page.getByLabel('邮箱', { exact: true }).fill('colleague@example.com');
  await page.getByRole('button', { name: '生成邀请链接', exact: true }).click();
  await page.getByText('邀请保存失败', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('邀请链接', { exact: true }).count(), 0);
  inviteFail = false; await page.getByRole('button', { name: '生成邀请链接', exact: true }).click();
  await page.getByLabel('邀请链接', { exact: true }).waitFor();
  assert.match(await page.getByLabel('邀请链接', { exact: true }).inputValue(), /\/team\?token=/);
  assert.equal(await page.getByText('1/5 位成员', { exact: false }).count(), 1);
  await page.getByLabel('选择个人素材', { exact: true }).click();
  await page.getByRole('option', { name: '私有商品素材', exact: true }).click();
  await page.getByRole('button', { name: '共享', exact: true }).click();
  await page.getByRole('link', { name: '私有商品素材', exact: true }).waitFor();
  await page.getByRole('button', { name: '撤销共享', exact: true }).click();
  await page.getByText('尚无共享素材', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/access-team-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(calls.some(call => call.method !== 'GET' && /\/rest\/v1\/(api_keys|teams|team_members|team_invitations)/.test(call.path)), false);
  console.log('PASS 团队页无本地假数据、真实创建、邀请失败不冒报/成功不自动加成员、共享撤销与移动端布局');
} finally { await browser.close(); }
