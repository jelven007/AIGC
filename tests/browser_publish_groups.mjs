/** 在真实 React 页面验证多账号确认与断线恢复，仅使用隔离API夹具。 */
import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const uid = '11111111-1111-4111-8111-111111111111', projectId = crypto.randomUUID();
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const source = `${backend}/storage/v1/object/authenticated/materials/${uid}/video.mp4`;
const batchItem = process.env.BATCH_PUBLISH ? crypto.randomUUID() : null, batchKey = crypto.randomUUID();
const accounts = [{ id: crypto.randomUUID(), platform: 'tiktok', display_name: '主账号', status: 'active' },
  { id: crypto.randomUUID(), platform: 'douyin', display_name: '门店账号', status: 'active' }];
const session = { access_token: `header.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture-only', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const context = await browser.newContext();
  await context.addInitScript(session => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session)), session);
  let group = null, reveal = false, attempts = [], legacyAttempts = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    let body;
    try { body = request.postDataJSON(); } catch {}
    let reply = [], status = 200;
    if (request.method() === 'OPTIONS') reply = {};
    else if (url.pathname.includes('/auth/')) reply = session.user;
    else if (url.pathname.includes('/storage/v1/object/sign/')) reply = { signedURL: `/object/sign/materials/${uid}/video.mp4?token=fixture` };
    else if (url.pathname.endsWith('/platform-accounts')) {
      if (body.action === 'list') reply = { platforms: [{ id: 'tiktok', name: 'TikTok', enabled: true }, { id: 'douyin', name: '抖音', enabled: true }], connections: accounts };
      else if (body.action === 'creator') {
        const account = accounts.find(item => item.id === body.connection_id);
        reply = { ...account, privacy_level_options: account.platform === 'tiktok' ? ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'] : ['0', '1', '2'],
          max_video_post_duration_sec: 60, comment_disabled: true, duet_disabled: true, stitch_disabled: true };
      }
    } else if (url.pathname.endsWith('/platform-publish')) {
      if (body.action === 'list') reply = { tasks: reveal && group ? group.tasks : [], groups: reveal && group ? [group] : [] };
      else if (body.action === 'query_group') reply = { group: reveal ? group : null };
      else if (body.action === 'query') reply = { task: null };
      else if (body.action === 'create_group') {
        attempts.push(body);
        group ||= { id: crypto.randomUUID(), request_key: body.request_key, request: body, created_at: new Date().toISOString(),
          tasks: body.targets.map(target => ({ id: crypto.randomUUID(), group_id: 'group', connection_id: target.connection_id,
            title: body.title, platform: accounts.find(account => account.id === target.connection_id).platform,
            status: 'draft', scheduled_at: null, platform_url: null, error_message: null })) };
        for (const task of group.tasks) task.group_id = group.id;
        if (attempts.length === 1) { status = 503; reply = { error: '发布组结果待核对，请按原请求标识查询' }; }
        else { reveal = true; reply = { group }; }
      } else if (body.action === 'create') {
        legacyAttempts.push(body); reply = { task: { id: crypto.randomUUID(), status: 'draft' } };
      } else if (body.action === 'cancel') {
        group.tasks.find(task => task.id === body.task_id).status = 'cancelled'; reply = { ok: true };
      }
    } else if (url.pathname.includes('/rest/v1/profiles')) reply = { id: uid, username: '本地测试', role: 'user' };
    else if (url.pathname.includes('/rest/v1/video_projects')) reply = [{ id: projectId, user_id: uid, title: '确认成片', status: 'completed', duration: 2, video_url: source }];
    else if (url.pathname.endsWith('/rpc/get_my_credits')) reply = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    else if (url.pathname.includes('/rest/v1/rpc/')) reply = {};
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/publish${batchItem ? `?projectId=${projectId}&batchItemId=${batchItem}&batchRequestKey=${batchKey}` : ''}`);
  await page.getByRole('heading', { name: '创建发布组' }).waitFor();
  await page.getByRole('combobox').first().selectOption(projectId);
  await page.getByRole('checkbox', { name: 'tiktok · 主账号', exact: true }).check();
  await page.getByRole('checkbox', { name: 'douyin · 门店账号', exact: true }).check();
  const primary = page.getByRole('group', { name: '主账号', exact: true });
  const store = page.getByRole('group', { name: '门店账号', exact: true });
  await primary.getByRole('combobox').selectOption('SELF_ONLY');
  await store.getByRole('combobox').selectOption('0');
  assert.equal(await primary.getByRole('checkbox', { name: '关闭评论', exact: true }).isEnabled(), false);
  await primary.getByRole('checkbox', { name: /我已预览/ }).check();
  assert.equal(await page.getByRole('button', { name: '提交到 2 个账号' }).isEnabled(), false);
  await store.getByRole('checkbox', { name: /我已预览/ }).check();
  await page.getByLabel('标题', { exact: true }).fill('确认的新标题');
  assert.equal(await primary.getByRole('checkbox', { name: /我已预览/ }).isChecked(), false);
  assert.equal(await store.getByRole('checkbox', { name: /我已预览/ }).isChecked(), false);
  await primary.getByRole('checkbox', { name: /我已预览/ }).check();
  await store.getByRole('checkbox', { name: /我已预览/ }).check();
  console.log('PASS 多账号分别确认与平台权限限制，共用内容改变撤销已有确认');
  await page.getByRole('button', { name: '提交到 2 个账号' }).click();
  await page.getByRole('button', { name: '按原参数重试' }).waitFor();
  assert.equal(attempts.length, 1); assert.equal(attempts[0].targets.length, 2);
  assert.equal(attempts[0].source_url, source);
  if (batchItem) {
    assert.equal(attempts[0].batch_item_id, batchItem);
    assert.equal(attempts[0].request_key, batchKey);
  }
  assert.equal(await page.getByLabel('标题', { exact: true }).isEnabled(), false);
  await page.reload();
  await page.getByRole('button', { name: '按原参数重试' }).waitFor();
  await page.getByRole('button', { name: '按原参数重试' }).click();
  await page.getByText('0/2 个账号已发布', { exact: false }).waitFor();
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(await page.evaluate(uid => localStorage.getItem(`shopro:publish:${uid}`), uid), null);
  console.log('PASS 提交结果未知锁定原参数，刷新后原UUID重试恢复整组');
  await page.getByRole('region', { name: '发布记录' }).getByRole('button', { name: '取消', exact: true }).first().click();
  await page.getByText('已取消', { exact: true }).waitFor();
  assert.equal(group.tasks.filter(task => task.status === 'cancelled').length, 1);
  assert.equal(group.tasks.filter(task => task.status === 'draft').length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await store.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.publish-mobile.local', type: 'png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.publish-desktop.local', fullPage: true, type: 'png' });
  console.log('PASS 分项取消保留其他账号，移动端无横向溢出');

  const oldKey = crypto.randomUUID();
  await page.evaluate(({ uid, oldKey, projectId, connection_id }) => localStorage.setItem(`shopro:publish:${uid}`, JSON.stringify({
    request_key: oldKey, form: { project_id: projectId, connection_id, title: '升级前标题', description: '', tags: '',
      scheduled_at: '', privacy_level: 'SELF_ONLY', consent: true, disable_comment: true, disable_duet: true,
      disable_stitch: true, brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true },
  })), { uid, oldKey, projectId, connection_id: accounts[0].id });
  await page.reload();
  await page.getByRole('button', { name: '按原参数重试' }).click();
  await page.getByRole('button', { name: '提交到 1 个账号' }).waitFor();
  assert.equal(legacyAttempts.length, 1); assert.equal(legacyAttempts[0].request_key, oldKey);
  assert.equal(legacyAttempts[0].title, '升级前标题'); assert.equal(attempts.length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS 升级前单账号未知请求保持旧action与UUID，不重复派发成组');
  await context.close();
} finally { await browser.close(); }
