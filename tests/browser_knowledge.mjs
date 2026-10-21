import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const entry = { id, title: '真实洁面话术', content: { text: '根据真实实验记录说明洁面体验' }, embedding_text: '根据真实实验记录说明洁面体验',
  content_hash: 'a'.repeat(64), tags: [], category: '短视频脚本', indexed: false, created_at: new Date().toISOString() };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let entries = [], jobs = [], failCreate = true, failIntegrate = true;
  const submissions = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/knowledge-base')) {
      if (body.action === 'catalog') data = { entries, prices: { knowledge_index: 2, knowledge_search: 1 } };
      else if (body.action === 'jobs') data = { jobs };
      else if (body.action === 'create') {
        submissions.push(body);
        if (!jobs.some(job => job.request_key === body.request_key)) jobs.unshift({ id: crypto.randomUUID(), request_key: body.request_key,
          kind: body.kind, status: 'pending', result: null, credit_cost: 2, created_at: new Date().toISOString() });
        status = failCreate ? 503 : 202; data = failCreate ? { error: '知识创建回执待确认' } : { job: jobs[0] };
      }
    } else if (path.endsWith('/text-generation')) {
      status = failIntegrate ? 503 : 200; data = failIntegrate ? { error: '文本模型不可用' } : { choices: [{ message: { content: '依据{实际资料}整理脚本结构。' } }] };
    } else if (path.endsWith('/knowledge_entries') && req.method() === 'POST') { entries = [{ ...entry, title: body.title }]; data = { id }; }
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版' } };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/knowledge');
  await page.getByText('检索我的知识 · 0/200条', { exact: true }).waitFor();
  assert.ok(!(await page.locator('main').innerText()).includes('1280'));
  await page.getByLabel('知识标题', { exact: true }).fill(entry.title);
  await page.getByLabel('知识正文', { exact: true }).fill(entry.embedding_text);
  await page.getByRole('button', { name: 'AI 整理正文', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '文本模型不可用' }).waitFor();
  assert.equal(await page.getByLabel('知识正文', { exact: true }).inputValue(), entry.embedding_text);
  failIntegrate = false;
  await page.getByRole('button', { name: 'AI 整理正文', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '依据{实际资料}整理脚本结构。');
  await page.getByRole('button', { name: '保存知识条目', exact: true }).click();
  await page.getByText('检索我的知识 · 1/200条', { exact: true }).waitFor();
  const firstResponse = page.waitForResponse(response => response.url().endsWith('/knowledge-base') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'create');
  await page.getByRole('button', { name: '建立语义索引 · 2积分', exact: true }).click(); await firstResponse;
  await page.getByRole('button', { name: '恢复原知识请求', exact: true }).waitFor();
  await page.reload(); failCreate = false;
  await page.getByRole('button', { name: '恢复原知识请求', exact: true }).click();
  await page.getByRole('button', { name: '恢复原知识请求', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(submissions[0], submissions[1]); assert.equal(jobs.length, 1);
  jobs[0].status = 'completed'; entries[0].indexed = true;
  jobs.unshift({ id, kind: 'knowledge_search', request_key: crypto.randomUUID(), status: 'completed', credit_cost: 1, created_at: new Date().toISOString(),
    result: { query: '清洁体验', version_id: id, results: [{ entry_id: id, title: entry.title, content: entry.embedding_text, content_hash: 'a'.repeat(64), similarity: .91 }] } });
  await page.getByRole('button', { name: '刷新知识库', exact: true }).click();
  await page.getByRole('button', { name: '携带引用创作脚本', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/knowledge-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '携带引用创作脚本', exact: true }).click();
  await page.getByRole('button', { name: '移除知识引用', exact: true }).waitFor();
  assert.ok((await page.locator('main').innerText()).includes(id));
  assert.equal(await page.getByText('官方旗舰店活动，今天下单直接买一发二！点击左下角赶紧抢吧！', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '移除知识引用', exact: true }).click();
  await page.getByRole('button', { name: '移除知识引用', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS 390px空库、真实整理失败保留正文/成功待保存、索引503刷新同UUID恢复、来源引用带入脚本、无默认假结果');
} finally { await browser.close(); }
