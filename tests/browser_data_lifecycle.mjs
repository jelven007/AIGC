import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const voice = { id, name: '我的原声音', requires_verification: false, revoked_at: null, provider_deleted_at: null };
  let failRevoke = true, failDelete = true;
  let entries = [{ id, title: '私有知识标题', content: { text: '待删除的私有知识片段' }, embedding_text: '待删除的私有知识片段',
    content_hash: 'a'.repeat(64), indexed: true, tags: [], category: '脚本', created_at: new Date().toISOString() }];
  const jobs = [{ id, kind: 'knowledge_search', status: 'completed', credit_cost: 1, created_at: new Date().toISOString(),
    result: { query: '私有查询', version_id: id, results: [{ entry_id: id, content_hash: 'a'.repeat(64),
      title: '私有知识标题', content: '待删除的私有知识片段', similarity: 1 }] } }];
  const revocations = [], deletions = [], errors = [];
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/production-jobs')) {
      if (body.action === 'list') data = { jobs: [] };
      else if (body.action === 'voices') data = { voices: [voice] };
      else if (body.action === 'media-prices') data = { costs: { tts: 2, asr: 2, voice_clone: 10, avatar: 10, lipsync: 10 } };
      else if (body.action === 'revoke-voice') {
        revocations.push(body); voice.revoked_at = '2026-10-22T00:00:00Z';
        status = failRevoke ? 503 : 200;
        data = failRevoke ? { error: '撤销响应待确认' } : { voice };
      } else throw new Error('unexpected media action');
    } else if (path.endsWith('/knowledge-base')) {
      if (body.action === 'catalog') data = { entries, prices: { knowledge_index: 2, knowledge_search: 1 } };
      else if (body.action === 'jobs') data = { jobs };
      else if (body.action === 'delete') {
        deletions.push(body); status = failDelete ? 503 : 200;
        if (!failDelete) { entries = []; jobs[0].result.results = []; }
        data = failDelete ? { error: '知识删除响应待确认' } : { deleted: true, entry_id: id };
      } else throw new Error('unexpected knowledge action');
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版' } };
    await route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', cause => errors.push(cause.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${base}/avatars`);
  await page.getByRole('heading', { name: '我的声纹', exact: true }).waitFor();
  const voiceSelect = page.getByLabel('克隆声纹', { exact: true });
  await voiceSelect.selectOption(id);
  await page.getByRole('button', { name: '撤销「我的原声音」', exact: true }).click();
  await page.getByRole('button', { name: '恢复原声纹撤销', exact: true }).waitFor();
  assert.equal(revocations.length, 1);
  await page.reload();
  await page.getByRole('button', { name: '恢复原声纹撤销', exact: true }).waitFor();
  failRevoke = false;
  await page.getByRole('button', { name: '恢复原声纹撤销', exact: true }).click();
  await page.getByRole('button', { name: '恢复原声纹撤销', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(revocations[0], revocations[1]);
  assert.equal(await page.getByLabel('克隆声纹', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '撤销「我的原声音」', exact: true }).count(), 0);
  await page.getByText('已撤销 · 供应商删除待确认', { exact: true }).waitFor();
  voice.provider_deleted_at = '2026-10-22T01:00:00Z';
  await page.getByRole('button', { name: '刷新任务', exact: true }).click();
  await page.getByText('已撤销 · 供应商声纹已删除', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/voice-revocation-mobile.png', fullPage: true });
  console.log('PASS 390px撤销确认、503刷新后同UUID恢复、撤销音色移除、后台删除回执展示');
  await page.goto(`${base}/knowledge`);
  await page.getByText('检索我的知识 · 1/200条', { exact: true }).waitFor();
  await page.getByRole('button', { name: '携带引用创作脚本', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '知识删除响应待确认' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '携带引用创作脚本', exact: true }).isEnabled(), true);
  failDelete = false;
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByText('检索我的知识 · 0/200条', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '携带引用创作脚本', exact: true }).isEnabled(), false);
  assert.equal(await page.getByText('待删除的私有知识片段', { exact: true }).count(), 0);
  assert.deepEqual(deletions[0], deletions[1]); assert.equal(deletions[0].entry_id, id);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.volcengine-build/knowledge-deleted-mobile.png', fullPage: true });
  console.log('PASS 知识删除失联可重试同条目，成功移除正文/检索结果并禁用引用创作');
} finally { await browser.close(); }
