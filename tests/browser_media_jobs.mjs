/** 390px真实页面验证媒体回执失联恢复、识别、克隆授权、未知状态及数字人入口。 */
import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const submissions = [], errors = [], jobs = [];
  let fail = true, terminal = false, image;
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/production-jobs')) {
      if (body.action === 'create') {
        submissions.push(body);
        if (!jobs.some(job => job.request_key === body.request_key)) jobs.unshift({
          id: crypto.randomUUID(), request_key: body.request_key, kind: body.kind, status: 'pending',
          progress: 0, result: null, credit_cost: body.kind === 'voice_clone' ? 10 : 2 });
        status = fail ? 503 : 202; data = fail ? { error: '提交结果待确认' } : { job: jobs.find(job => job.request_key === body.request_key) };
      } else if (body.action === 'list') {
        data = { jobs: jobs.map(job => terminal ? { ...job, status: job.kind === 'voice_clone' ? 'unknown' : 'completed',
          result: job.kind === 'asr' ? { text: '真实转录正文' } : { url: 'https://download.example/audio.mp3' },
          error_message: job.kind === 'voice_clone' ? '供应商受理结果待核对，禁止重复提交' : null } : job) };
      } else if (body.action === 'voices') data = { voices: [] };
      else if (body.action === 'media-prices') data = { costs: { tts: 2, asr: 2, voice_clone: 10, avatar: 10, lipsync: 10 } };
      else throw new Error('unexpected action ' + body.action);
    } else if (path.includes('/storage/v1/object/materials/')) {
      data = { Key: path.slice('/storage/v1/object/'.length), Id: crypto.randomUUID() };
      image = path;
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/avatars`);
  await page.getByRole('heading', { name: '语音与数字人工作台' }).waitFor();
  await page.getByLabel('配音文本', { exact: true }).fill('商品口播，验证失联刷新恢复。');
  await page.getByRole('button', { name: '提交生成配音任务', exact: true }).click();
  await page.getByRole('button', { name: '恢复原媒体任务', exact: true }).waitFor();
  await page.getByText('提交结果待确认', { exact: true }).waitFor();
  assert.equal(submissions.length, 1);
  await page.reload();
  await page.getByRole('button', { name: '恢复原媒体任务', exact: true }).waitFor();
  fail = false;
  await page.getByRole('button', { name: '恢复原媒体任务', exact: true }).click();
  await page.getByRole('button', { name: '恢复原媒体任务', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(submissions[0], submissions[1]);
  console.log('PASS 配音提交失联、刷新恢复同一请求且保留参数');

  await page.getByLabel('媒体任务类型').selectOption('asr');
  await page.getByLabel('上传口播音频').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF-audio') });
  await page.getByRole('button', { name: '提交识别音频任务', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '提交识别音频任务' && !button.disabled));
  await page.getByLabel('媒体任务类型').selectOption('voice_clone');
  await page.getByLabel('声纹名称', { exact: true }).fill('我的声音');
  assert.equal(await page.getByRole('button', { name: '提交克隆声纹任务', exact: true }).isEnabled(), false);
  await page.getByText('我已取得声音及人物形象的使用授权。', { exact: true }).click();
  await page.getByRole('button', { name: '提交克隆声纹任务', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '提交克隆声纹任务' && !button.disabled));
  terminal = true;
  await page.getByRole('button', { name: '刷新任务', exact: true }).click();
  await page.getByLabel('语音识别结果', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('语音识别结果').inputValue(), '真实转录正文');
  await page.getByText('供应商受理结果待核对，禁止重复提交', { exact: true }).waitFor();
  assert.equal(submissions.at(-1).input.consent, true);
  assert.ok(image.includes(uid));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.volcengine-build/media-mobile.png', fullPage: true });
  console.log('PASS 私有上传、识别结果、克隆授权必选、未知原任务保留及390px布局');
} finally { await browser.close(); }
