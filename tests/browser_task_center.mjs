/** 真实页面与本地API夹具：不接生产资源，不发送模型生成或发布请求。 */
import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, args: ['--disable-crashpad-for-testing'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let phase = 'normal', rejectCancel = false, rejectQuery = false, malformed = false;
  const calls = [], errors = [];
  const video = (id, status, attention = false) => ({ id, project_id: 'project', provider: 'Wan3', status,
    submission_state: attention ? 'unknown' : 'submitted', billing_state: status === 'failed' ? 'refunded' : 'reserved',
    credit_cost: 10, progress: 23, video_url: null, error_message: attention ? '上游受理待核对' : null,
    needs_attention: attention, created_at: '2026-10-21T04:00:00Z' });
  const videos = [video('video-running', 'processing'), video('video-unknown', 'processing', true), video('video-failed', 'failed')];
  const job = (id, kind, status = 'running', project = null) => ({ id, request_key: id, kind, project_id: project,
    status, progress: 41, phase: 'accepted', credit_cost: kind === 'image' ? 10 : 0,
    result: null, error_message: null, created_at: '2026-10-21T05:00:00Z' });
  const production = [job('image-running', 'image'), job('cover-done', 'image', 'completed', 'project'),
    job('render-failed', 'render', 'failed', 'project'), job('publish-job', 'publish', 'completed')];
  let publishes = [{ id: 'publish-review', job_id: 'publish-job', project_id: 'project', platform: 'douyin',
    title: '审核中的真实作品标题'.repeat(10), status: 'moderating', scheduled_at: null, platform_url: null,
    error_message: '等待审核', created_at: '2026-10-21T06:00:00Z' },
  { id: 'publish-scheduled', job_id: 'scheduled-job', project_id: 'project', platform: 'tiktok',
    title: '定时发布作品', status: 'scheduled', scheduled_at: '2026-10-22T06:00:00Z', platform_url: null,
    error_message: null, created_at: '2026-10-21T07:00:00Z' }];
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {};
    try { body = request.postDataJSON() || {}; } catch {}
    if (request.method() !== 'OPTIONS') calls.push({ path, method: request.method(), body });
    let reply = [], status = 200;
    if (request.method() === 'OPTIONS') reply = {};
    else if (path.includes('/auth/')) reply = session.user;
    else if (path.endsWith('/video-jobs')) {
      if (body.action === 'query') {
        if (rejectQuery) { reply = { error: '视频查询暂时失败' }; status = 503; }
        else reply = { job: { ...videos.find(item => item.id === body.job_id), status: 'completed', progress: 100, billing_state: 'settled',
          video_url: 'https://ui-fixture.example/completed.mp4' } };
      } else reply = { jobs: phase === 'empty' ? [] : videos };
    } else if (path.endsWith('/production-jobs')) {
      if (phase === 'partial') { reply = { error: '图片服务暂时不可用' }; status = 503; }
      else reply = malformed ? { outdated: true }
        : body.action === 'query' ? { job: { ...production.find(item => item.id === body.job_id), status: 'completed', progress: 100,
          result: { url: 'https://ui-fixture.example/completed.png' } } }
          : { jobs: phase === 'empty' ? [] : production };
    } else if (path.endsWith('/platform-publish')) {
      if (body.action === 'cancel') {
        if (rejectCancel) { reply = { error: '任务已经开始执行' }; status = 409; }
        else { publishes = publishes.map(item => item.id === body.task_id ? { ...item, status: 'cancelled' } : item); reply = { ok: true }; }
      } else reply = { tasks: phase === 'empty' ? [] : publishes };
    } else if (path.includes('/rest/v1/profiles')) reply = { id: uid, username: '本地测试', invite_code: 'TESTUSER', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) reply = creditSnapshot(uid, { credits_total: 100, credits_used: 10, credits_left: 90, plan_level: 0, configured_plan_level: 0, plan_name: '免费版' });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const row = id => page.getByRole('article').filter({ hasText: `任务 ID：${id}` });
  const refresh = async () => {
    await page.getByRole('button', { name: '刷新全部', exact: true }).click();
    await page.getByRole('button', { name: '刷新全部', exact: true }).waitFor({ state: 'visible' });
  };
  await page.goto(`${base}/task-queue`);
  await page.getByRole('heading', { name: '任务中心' }).waitFor();
  await row('image-running').waitFor();
  assert.equal(await page.getByRole('article').count(), 8);
  assert.match(await row('video-running').textContent(), /23%/);
  assert.match(await row('image-running').textContent(), /41%/);
  assert.match(await row('video-unknown').textContent(), /待核对/);
  assert.match(await row('video-failed').textContent(), /已返还 10 积分/);
  assert.equal(await row('publish-review').getByText('平台审核中', { exact: true }).count(), 1);
  assert.equal(await row('publish-review').getByRole('button', { name: '取消发布' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '删除任务记录' }).count(), 0);
  console.log('PASS 三来源任务完整展示、真实进度、待核对、计费与发布去重');
  await page.getByRole('group', { name: '任务状态筛选' }).getByRole('button', { name: /^待核对/ }).click();
  assert.equal(await page.getByRole('article').count(), 1);
  await page.getByRole('group', { name: '任务状态筛选' }).getByRole('button', { name: /^全部/ }).click();
  await page.getByLabel('任务类型', { exact: true }).selectOption('render');
  assert.equal(await page.getByRole('article').count(), 1);
  assert.equal(await row('render-failed').getByRole('link', { name: '重新编辑' }).getAttribute('href'), '/video/edit?importId=project');
  await page.getByLabel('任务类型', { exact: true }).selectOption('all');
  await page.getByLabel('搜索任务', { exact: true }).fill('not-existing');
  await page.getByRole('button', { name: '清除筛选' }).click();
  assert.equal(await page.getByRole('article').count(), 8);
  console.log('PASS 类型、状态、搜索筛选与失败工程入口');
  rejectQuery = true;
  await row('video-running').getByRole('button', { name: '刷新状态' }).click();
  await page.getByText('视频查询暂时失败', { exact: true }).waitFor();
  assert.match(await row('video-running').textContent(), /23%/);
  rejectQuery = false;
  await row('video-running').getByRole('button', { name: '刷新状态' }).click();
  await row('video-running').getByText('已完成', { exact: true }).waitFor();
  assert.match(await row('video-running').textContent(), /100%/);
  assert.equal(await row('video-running').getByRole('link', { name: '查看成片' }).getAttribute('href'), 'https://ui-fixture.example/completed.mp4');
  await row('image-running').getByRole('button', { name: '刷新状态' }).click();
  await row('image-running').getByText('已完成', { exact: true }).waitFor();
  console.log('PASS 刷新调用对应新查询接口，失败保留状态，完成后开放结果');
  rejectCancel = true;
  await row('publish-scheduled').getByRole('button', { name: '取消发布' }).click();
  await page.getByText('任务已经开始执行', { exact: true }).waitFor();
  assert.equal(await row('publish-scheduled').getByText('定时发布', { exact: true }).count(), 1);
  rejectCancel = false;
  await row('publish-scheduled').getByRole('button', { name: '取消发布' }).click();
  await row('publish-scheduled').getByText('已取消', { exact: true }).waitFor();
  assert.equal(await row('publish-scheduled').getByRole('button', { name: '取消发布' }).count(), 0);
  console.log('PASS 发布取消由服务端确认，冲突不会冒报成功');
  phase = 'partial'; await refresh();
  await page.getByRole('alert').filter({ hasText: '图片服务暂时不可用' }).waitFor();
  assert.equal(await row('image-running').count(), 1);
  assert.equal(await row('publish-review').count(), 1);
  phase = 'normal'; malformed = true; await refresh();
  await page.getByRole('alert').filter({ hasText: '任务服务返回格式无效' }).waitFor();
  malformed = false; await refresh();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  console.log('PASS 部分接口故障/旧返回格式保留记录，恢复后清除错误');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/task-center-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(calls.some(call => /\/rest\/v1\/(video_jobs|production_jobs)/.test(call.path)), false);
  assert.equal(calls.some(call => call.method === 'DELETE' || ['retry_video_job', 'create', 'run', 'sync'].includes(call.body.action)), false);
  assert.equal(calls.filter(call => call.body.action === 'cancel').length, 2);
  console.log('PASS 移动端无横向溢出，未调用旧重试/删除或收费生成');
  phase = 'empty'; await refresh();
  await page.getByText('暂无后台任务，提交创作后会在这里显示。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 0);
  await context.close();
} finally { await browser.close(); }
