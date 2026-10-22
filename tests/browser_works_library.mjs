import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', second = '99999999-9999-4999-8999-999999999999';
const sessionFor = id => ({ access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id, email: id === uid ? 'test_user@example.com' : 'second@example.com', app_metadata: {}, user_metadata: {} } });
const session = sessionFor(uid), videoBytes = await readFile('.volcengine-build/library-test.mp4');
function wave() {
  const rate = 16000, samples = rate * 2, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
const audioBytes = wave(), url = `${backend}/storage/v1/object/authenticated/videos/${uid}/Shopro.mp4`;
const projects = Array.from({ length: 25 }, (_, i) => ({ id: `${String(i + 2).padStart(8, '0')}-2222-4222-8222-222222222222`,
  user_id: uid, title: `实际作品${i + 1}`, status: 'completed', prompt_text: '原生成提示词', aspect_ratio: '16:9',
  video_style: 'ArkSeedance', duration: 2, created_at: '2026-10-21T12:00:00Z', thumbnail_url: null,
  video_url: i === 1 ? null : url, product: { category: '数码电器' } }));
const state = { uploads: [], registers: [], reads: [], errors: [], forbidden: [], assets: [], failList: false, failRegister: true, failText: true };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', acceptDownloads: true });
await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
await context.route(`${backend}/**`, async route => {
  const req = route.request(), parsed = new URL(req.url()), path = parsed.pathname, auth = req.headers().authorization || '';
  const currentId = auth.includes(sessionFor(second).access_token) ? second : uid;
  let body = {}; try { body = req.postDataJSON() || {}; } catch {}
  let data = [], status = 200, type = 'application/json', count;
  if (req.method() === 'OPTIONS') data = {};
  else if (path.includes('/auth/')) data = sessionFor(currentId).user;
  else if (path.includes('/storage/v1/object/sign/') && req.method() === 'POST') {
    data = { signedURL: path.replace('/storage/v1', '') + '?token=fixture' };
  } else if (path.includes('/storage/v1/object/') && req.method() === 'POST') {
    state.uploads.push(req.url()); data = { Key: path.split('/object/')[1], Id: crypto.randomUUID() };
  } else if (path.includes('/storage/v1/object/')) {
    assert.ok(path.includes('/sign/'), '媒体读取必须使用签名地址');
    type = path.endsWith('.wav') ? 'audio/wav' : 'video/mp4'; data = type === 'audio/wav' ? audioBytes : videoBytes;
  } else if (path.endsWith('/material-assets')) {
    if (body.action === 'list') {
      state.reads.push(body);
      let assets = state.assets.filter(item => item.user_id === currentId && (!body.type || item.type === body.type)
        && (!body.search || item.name.includes(body.search)));
      count = assets.length; data = { materials: assets.slice(body.offset, body.offset + body.limit), total: count };
      if (state.failList) { status = 503; data = { error: '素材列表读取失败' }; }
    } else if (body.action === 'register') {
      state.registers.push(body);
      let material = state.assets.find(item => item.upload_key === body.request_key);
      if (!material) {
        material = { id: crypto.randomUUID(), user_id: currentId, name: body.input.name, type: body.input.type, upload_key: body.request_key,
          created_at: '2026-10-22T12:00:00Z', duration_sec: body.input.duration_sec, size: body.input.size,
          url: `${backend}/storage/v1/object/sign/materials/${currentId}/uploads/${body.request_key}.${body.input.extension}?token=fixture` };
        state.assets.unshift(material);
      }
      if (state.failRegister) { state.failRegister = false; status = 503; data = { error: '素材登记结果待确认，请恢复原请求' }; }
      else data = { material };
    } else if (body.action === 'delete') {
      state.assets = state.assets.filter(item => item.id !== body.material_id); data = { ok: true };
    } else throw new Error('未知素材操作');
  } else if (path.endsWith('/text-generation')) {
    if (state.failText) { status = 503; data = { error: '文本供应商暂时不可用' }; }
    else { type = 'text/event-stream'; data = 'data: {"choices":[{"delta":{"content":"实际返回的画面提示词"}}]}\n\ndata: [DONE]\n\n'; }
  } else if (path.includes('/rest/v1/video_projects')) {
    state.reads.push({ method: req.method(), params: Object.fromEntries(parsed.searchParams) });
    assert.equal(parsed.searchParams.get('user_id'), `eq.${currentId}`);
    if (req.method() === 'POST') { state.forbidden.push('seed-project'); status = 403; data = {}; }
    else if (req.method() === 'PATCH') {
      const project = projects.find(item => `eq.${item.id}` === parsed.searchParams.get('id'));
      Object.assign(project, body); data = [{ id: project.id }];
    } else {
      let rows = projects.filter(item => item.user_id === currentId);
      const match = parsed.searchParams.get('title');
      if (match) rows = rows.filter(item => item.title.includes(match.replace(/^ilike\.\*/, '').replace(/\*$/, '').replace(/^ilike\.%/, '').replace(/%$/, '')));
      if (parsed.searchParams.get('video_url')) rows = rows.filter(item => item.video_url);
      if (parsed.searchParams.get('status') && parsed.searchParams.get('status') !== 'eq.completed') rows = [];
      count = rows.length; const offset = Number(parsed.searchParams.get('offset') || 0), limit = Number(parsed.searchParams.get('limit') || 40);
      data = rows.slice(offset, offset + limit);
      if (state.failList) { status = 503; data = { message: 'down' }; }
    }
  } else if (path.includes('/rest/v1/materials') && req.method() === 'POST') { state.forbidden.push('seed-material'); status = 403; data = {}; }
  else if (path.includes('/rest/v1/profiles')) data = { id: currentId, username: '测试', invite_code: 'TEST' };
  else if (path.includes('/rest/v1/user_plans')) data = { credits_total: 100, credits_used: 0, plans: { name: '专业版' } };
  else if (path.endsWith('/model-settings')) data = { configs: [] };
  else if (path.endsWith('/video-jobs') || path.endsWith('/production-jobs')) data = { jobs: [] };
  await route.fulfill({ status, contentType: type, body: type === 'application/json' ? JSON.stringify(data) : data,
    headers: { ...(count === undefined ? {} : { 'Content-Range': `0-23/${count}` }), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
});
const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => state.errors.push(error.message));
try {
  await page.goto(`${base}/works`);
  await page.getByRole('heading', { name: '实际作品1', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 24);
  const missing = page.locator('article').filter({ has: page.getByRole('heading', { name: '实际作品2', exact: true }) });
  assert.equal(await missing.getByRole('button', { name: '预览', exact: true }).isDisabled(), true);
  assert.equal(await missing.getByRole('link', { name: '发布', exact: true }).count(), 0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('heading', { name: '实际作品25', exact: true }).waitFor();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  const first = page.locator('article').filter({ has: page.getByRole('heading', { name: '实际作品1', exact: true }) });
  await first.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('dialog').locator('video').waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] video')?.readyState >= 2);
  assert.equal(await page.getByRole('dialog').locator('video').getAttribute('src'), url.replace('/authenticated/', '/sign/') + '?token=fixture');
  await page.keyboard.press('Escape');
  await first.getByRole('button', { name: '标题', exact: true }).click();
  await page.getByLabel('作品标题', { exact: true }).fill('已修改的真实标题');
  await page.getByRole('button', { name: '保存标题', exact: true }).click();
  await page.getByRole('heading', { name: '已修改的真实标题', exact: true }).waitFor();
  assert.equal(projects[0].prompt_text, '原生成提示词');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/works-library-mobile.png' });
  console.log('PASS 真实作品分页、缺成片禁止预览/发布、签名成片实际解码、标题持久显示与390px');

  await page.getByRole('button', { name: '素材库', exact: true }).click();
  assert.equal(await page.getByLabel('上传授权素材', { exact: true }).isDisabled(), true);
  await page.getByLabel('我已获得这些素材的使用权', { exact: true }).check();
  await page.getByLabel('上传授权素材', { exact: true }).setInputFiles([
    { name: '原上传.wav', mimeType: 'audio/wav', buffer: audioBytes }, { name: '无效.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') }]);
  await page.getByRole('alert').filter({ hasText: '2 个素材未确认' }).waitFor();
  assert.equal(await page.getByText('已登记 2 个素材', { exact: true }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: '恢复原素材上传', exact: true }).click();
  await page.getByText('已恢复1个原素材登记', { exact: true }).waitFor();
  await page.getByRole('button', { name: '素材库', exact: true }).click();
  await page.getByRole('heading', { name: '原上传.wav', exact: true }).waitFor();
  assert.equal(state.uploads.length, 1); assert.equal(new Set(state.registers.map(item => item.request_key)).size, 1);
  assert.equal(state.registers[0].input.duration_sec, 2);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('dialog').locator('audio').waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] audio')?.readyState >= 2);
  await page.keyboard.press('Escape');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  assert.deepEqual(await readFile(await (await downloadEvent).path()), audioBytes);
  state.failList = true;
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '素材列表读取失败' }).waitFor();
  state.failList = false;
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'detached' });
  console.log('PASS 批量上传真实计数、使用权确认、响应丢失后原UUID恢复、音频解码与实际下载、列表故障重试');

  await page.goto(`${base}/video/create`);
  await page.getByRole('heading', { name: '我的创作参考', exact: true }).waitFor();
  await page.getByText('正在读取最近作品…', { exact: true }).waitFor({ state: 'detached' });
  assert.ok(await page.locator('video').count() > 0);
  assert.ok((await page.locator('video').evaluateAll(nodes => nodes.map(node => node.src))).every(source => !source.includes('CreatOK')));
  assert.equal(await page.getByLabel('上传视频参考视频', { exact: true }).isDisabled(), true);
  await page.getByLabel('我拥有参考素材的使用权', { exact: true }).check();
  await page.getByLabel('上传视频参考视频', { exact: true }).setInputFiles({ name: '实际参考.mp4', mimeType: 'video/mp4', buffer: videoBytes });
  await page.getByText('参考素材已登记，可在素材库管理', { exact: true }).waitFor();
  assert.equal(state.registers.at(-1).input.type, 'video');
  assert.equal(state.registers.at(-1).input.duration_sec, 2);
  const input = page.getByPlaceholder('描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频');
  await input.fill('我的原始描述');
  await page.getByRole('button', { name: '提示词增强', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '文本供应商暂时不可用' }).waitFor();
  assert.equal(await input.inputValue(), '我的原始描述');
  assert.equal(await page.getByText('提示词已增强', { exact: true }).count(), 0);
  state.failText = false;
  await page.getByRole('button', { name: '提示词增强', exact: true }).click();
  await page.getByText('提示词已增强', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), '实际返回的画面提示词');
  assert.deepEqual(state.forbidden, []);
  console.log('PASS 首页当前用户真实成片、进入测试账号不造数据、文本失败保留输入与完整流成功');

  await page.goto(`${base}/works`);
  const other = await context.newPage(); await other.goto(base);
  await other.evaluate(value => {
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
    const channel = new BroadcastChannel('sb-ui-fixture-auth-token');
    channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
  }, sessionFor(second));
  await page.getByText('还没有视频作品', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '已修改的真实标题', exact: true }).count(), 0);
  await other.close();
  assert.deepEqual(state.errors, []);
  console.log('PASS 浏览器跨标签账号切换清空旧作品，重新按新用户读取');

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), landing = await publicContext.newPage();
  await landing.goto(`${base}/landing`);
  await landing.getByRole('heading', { name: /让商品内容/ }).waitFor();
  assert.equal(await landing.locator('video').count(), 0);
  assert.equal(await landing.getByRole('button', { name: '播放演示视频', exact: true }).count(), 0);
  assert.equal(await landing.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await landing.getByRole('button', { name: '查看创作流程', exact: true }).click();
  await landing.screenshot({ path: '.volcengine-build/landing-production-mobile.png', fullPage: true });
  await publicContext.close();
  console.log('PASS 公开页面功能/流程入口、无旧宣传媒体和模拟互动、390px');
} finally { await context.close(); await browser.close(); }
