import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333';
const projectId = '22222222-2222-4222-8222-222222222222';
function sessionFor(id) {
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
    refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
    user: { id, email: `${id}@example.com`, app_metadata: {}, user_metadata: {} } };
}
async function fixture({ draft = null, lostCreate = false } = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: ['--disable-breakpad', '--disable-crash-reporter', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', permissions: ['microphone'] });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(({ session, uid, draft }) => {
    if (!localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
    if (draft && !localStorage.getItem(`video-editor-draft-${uid}`)) localStorage.setItem(`video-editor-draft-${uid}`, JSON.stringify(draft));
  }, { session: sessionFor(uid), uid, draft });
  const state = { reads: 0, writes: [], creates: [], errors: [], project: { id: projectId, user_id: uid, title: '空剪辑工程',
    status: 'draft', duration: 6, video_url: null, thumbnail_url: null, materials: [], style_data: { duration: 6, tracks: [] } } };
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    const token = request.headers().authorization?.replace(/^Bearer /, '') || '';
    const id = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub : uid;
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = sessionFor(id).user;
    else if (path.includes('/rest/v1/profiles')) data = { id, username: id === uid ? '原账号' : '新账号', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(id);
    else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) data = { jobs: [] };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'video.Wan3', provider: 'Wan3', name: '实际目录名称', category: 'video', enabled: true }] };
    else if (path.endsWith('/batch-video-jobs')) data = body.action === 'quote' ? { unit_cost: 10, max_items: 50 } : { batches: [] };
    else if (path.endsWith('/product-management')) {
      if (body.limit > 100) { status = 400; data = { error: '分页参数非法' }; }
      else data = { products: [{ id: projectId, name: id === uid ? '原账号商品' : '新账号商品', category: '家居用品' }], total: 1, offset: 0 };
    }
    else if (path.includes('/rest/v1/products')) data = [{ id: projectId, name: id === uid ? '原账号商品' : '新账号商品', category: '家居用品' }];
    else if (path.includes('/rest/v1/video_projects')) {
      if (request.method() === 'POST') {
        state.creates.push(body);
        if (state.creates.length === 1) {
          Object.assign(state.project, body);
          status = lostCreate ? 503 : 201;
          data = lostCreate ? { message: '工程创建响应待核对' } : [state.project];
        } else data = [];
      } else if (request.method() === 'PATCH') { state.writes.push({ id, body }); Object.assign(state.project, body); data = [state.project]; }
      else if (url.searchParams.has('id')) { state.reads++; data = id === uid ? [state.project] : []; }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => state.errors.push(error.message));
  const switchAccount = async () => {
    const helper = await context.newPage(); await helper.goto(`${base}/landing`);
    await helper.evaluate(value => {
      localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
      const channel = new BroadcastChannel('sb-ui-fixture-auth-token');
      channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
    }, sessionFor(other));
    await helper.close();
  };
  return { page, context, state, switchAccount, close: async () => { await context.close(); await browser.close(); } };
}
async function save(f) {
  const response = f.page.waitForResponse(value => value.url().includes('/rest/v1/video_projects') && value.request().method() === 'PATCH');
  await f.page.getByRole('button', { name: '保存项目', exact: true }).click();
  assert.equal((await response).status(), 200);
  await f.page.getByText('剪辑项目已成功保存', { exact: true }).last().waitFor();
}
test('first subtitle can undo and redo, save original project and restore after reload', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/video/edit?importId=${projectId}`);
    await f.page.getByText('空剪辑工程', { exact: true }).first().waitFor();
    await f.page.getByRole('button', { name: /文本.*T|字幕.*T/ }).click();
    const input = f.page.getByPlaceholder('输入文本内容，回车添加…');
    await input.fill('第一条字幕'); await input.press('Enter');
    await f.page.getByText('已添加字幕文本到时间轴：第一条字幕', { exact: true }).waitFor();
    await f.page.locator('button[title="撤销 Ctrl+Z"]').click();
    await f.page.getByText('撤销成功', { exact: true }).waitFor();
    await save(f);
    assert.equal(f.state.writes.at(-1).body.style_data.tracks.length, 0);
    await f.page.locator('button[title="重做 Ctrl+Y"]').click();
    await f.page.getByText('重做成功', { exact: true }).waitFor();
    await save(f);
    await f.page.waitForFunction(({ uid }) => JSON.parse(localStorage.getItem(`video-editor-draft-${uid}`))?.tracks.length === 1, { uid });
    assert.equal(f.state.writes.at(-1).body.style_data.tracks[0].name, '第一条字幕');
    await f.page.reload();
    await f.page.getByText('空剪辑工程', { exact: true }).first().waitFor();
    await save(f);
    assert.equal(f.state.writes.at(-1).body.style_data.tracks.length, 1);
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('brand new empty workspace keeps a baseline for its first undo', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/video/edit`);
    await f.page.getByRole('button', { name: /文本.*T|字幕.*T/ }).click();
    const input = f.page.getByPlaceholder('输入文本内容，回车添加…');
    await input.fill('第一条新建字幕'); await input.press('Enter');
    await f.page.getByText('已添加字幕文本到时间轴：第一条新建字幕', { exact: true }).waitFor();
    await f.page.locator('button[title="撤销 Ctrl+Z"]').click();
    await f.page.getByText('撤销成功', { exact: true }).waitFor();
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('matching local draft restores full aspect and transform before any autosave', async () => {
  const draft = { importId: projectId, projectTitle: '未丢失本地工程', duration: 5, tracks: [{ id: 'text-local',
    type: 'text', trackId: 'text', name: '本地字幕', text: '本地字幕', start: 0, duration: 5 }],
    editorAspect: 'aspect-[9/16]', scale: [130], opacity: [70], volume: [20] };
  const f = await fixture({ draft });
  try {
    await f.page.goto(`${base}/video/edit?importId=${projectId}`);
    await f.page.getByText('未丢失本地工程', { exact: true }).first().waitFor();
    await save(f);
    assert.equal(f.state.reads, 0);
    const saved = f.state.writes.at(-1).body.style_data;
    assert.equal(saved.editorAspect, 'aspect-[9/16]');
    assert.deepEqual(saved.scale, [130]); assert.deepEqual(saved.opacity, [70]); assert.deepEqual(saved.volume, [20]);
    assert.equal(saved.tracks[0].id, 'text-local'); assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('batch account switch clears selected products and old form', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/batch-create`);
    await f.page.getByRole('button', { name: '添加商品', exact: true }).click();
    await f.page.getByLabel('选择原账号商品', { exact: true }).check();
    await f.page.getByRole('button', { name: '确认添加', exact: true }).click();
    await f.page.locator('#batch-name').fill('原账号私有批次');
    await f.page.getByRole('button', { name: '移除原账号商品', exact: true }).waitFor();
    await f.switchAccount();
    await f.page.waitForFunction(() => document.querySelector('#batch-name')?.value === '商品视频批次');
    assert.equal(await f.page.getByRole('button', { name: '移除原账号商品', exact: true }).count(), 0);
    await f.page.getByRole('button', { name: '添加商品', exact: true }).click();
    await f.page.getByLabel('选择新账号商品', { exact: true }).waitFor();
    assert.equal(await f.page.getByLabel('选择原账号商品', { exact: true }).count(), 0);
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('lost create restores original UUID and keeps its saved timeline', async () => {
  const f = await fixture({ lostCreate: true });
  try {
    await f.page.goto(`${base}/video/edit`);
    await f.page.getByRole('button', { name: /文本.*T|字幕.*T/ }).click();
    const input = f.page.getByPlaceholder('输入文本内容，回车添加…');
    await input.fill('原创建字幕'); await input.press('Enter');
    await f.page.getByText('已添加字幕文本到时间轴：原创建字幕', { exact: true }).waitFor();
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click();
    await f.page.getByRole('alert').getByText('工程创建响应待核对', { exact: true }).waitFor();
    const original = f.state.creates[0].id;
    const receipt = await f.page.evaluate(uid => JSON.parse(localStorage.getItem(`video-editor-draft-${uid}`)), uid);
    assert.equal(receipt.importId, original); assert.equal(receipt.pendingCreate, true);
    await f.page.reload();
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click();
    await f.page.getByText('新剪辑项目已创建并成功保存', { exact: true }).waitFor();
    assert.equal(f.state.creates.length, 2);
    assert.equal(f.state.creates[1].id, original);
    assert.equal(f.state.writes.at(-1).body.style_data.tracks[0].name, '原创建字幕');
    assert.equal(f.state.writes.at(-1).body.status, undefined);
    assert.ok(f.page.url().endsWith(`importId=${original}`));
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('storage full prevents a new engineering create and shows an actionable error', async () => {
  const f = await fixture();
  try {
    await f.context.addInitScript(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('video-editor-draft-')) throw new DOMException('full', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    });
    await f.page.goto(`${base}/video/edit`);
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click();
    await f.page.getByRole('alert').getByText(/剪辑草稿无法保存/).waitFor();
    assert.equal(f.state.creates.length, 0);
    assert.equal(f.state.writes.length, 0);
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('editor account switch removes the old project and preserves its private local draft', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/video/edit?importId=${projectId}`);
    await f.page.getByText('空剪辑工程', { exact: true }).first().waitFor();
    await f.page.getByRole('button', { name: /文本.*T|字幕.*T/ }).click();
    const input = f.page.getByPlaceholder('输入文本内容，回车添加…');
    await input.fill('原账号私有字幕'); await input.press('Enter');
    await f.page.getByText('已添加字幕文本到时间轴：原账号私有字幕', { exact: true }).waitFor();
    await f.switchAccount();
    await f.page.getByRole('alert').getByText('工程不存在或无权访问', { exact: true }).waitFor();
    assert.equal(await f.page.getByText('空剪辑工程', { exact: true }).count(), 0);
    const original = await f.page.evaluate(uid => JSON.parse(localStorage.getItem(`video-editor-draft-${uid}`)), uid);
    assert.equal(original.tracks[0].name, '原账号私有字幕');
    assert.ok(f.state.writes.every(write => write.id === uid));
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('a real continuous font slider drag can undo in one step and redo its preview', async () => {
  const f = await fixture({ draft: { importId: projectId, projectTitle: '连续操作工程', duration: 5,
    tracks: [{ id: 'text-local', type: 'text', trackId: 'text', name: '拖动字幕预览', start: 0, duration: 5, fontSize: 18 }] } });
  try {
    await f.page.goto(`${base}/video/edit?importId=${projectId}`);
    await f.page.getByText('连续操作工程', { exact: true }).first().waitFor();
    const slider = f.page.getByText('文字字号', { exact: true }).locator('..').locator('..').getByRole('slider');
    await slider.scrollIntoViewIfNeeded();
    const bounds = await slider.boundingBox(); assert.ok(bounds);
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await f.page.mouse.move(x, y); await f.page.mouse.down();
    await f.page.mouse.move(x + 45, y, { steps: 10 }); await f.page.mouse.up();
    await save(f);
    const changed = f.state.writes.at(-1).body.style_data.tracks[0].fontSize;
    assert.ok(changed > 18);
    await f.page.locator('button[title="撤销 Ctrl+Z"]').click();
    await save(f); assert.equal(f.state.writes.at(-1).body.style_data.tracks[0].fontSize, 18);
    await f.page.locator('button[title="重做 Ctrl+Y"]').click();
    await save(f); assert.equal(f.state.writes.at(-1).body.style_data.tracks[0].fontSize, changed);
    await f.page.screenshot({ path: '.volcengine-build/editor-state-desktop.png' });
    await f.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const caption = f.page.locator('div.pointer-events-none > span').filter({ hasText: '拖动字幕预览' });
    const captionWidth = await caption.evaluate(span => ({
      width: span.getBoundingClientRect().width, canvas: span.parentElement.parentElement.clientWidth,
    }));
    assert.ok(captionWidth.width >= captionWidth.canvas * .6, JSON.stringify(captionWidth));
    await f.page.getByText('剪辑项目已成功保存', { exact: true }).last().waitFor({ state: 'hidden' });
    await f.page.screenshot({ path: '.volcengine-build/editor-state-mobile.png' });
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('home model name follows the actual catalog and changing accounts releases the microphone', async () => {
  const f = await fixture();
  try {
    await f.context.addInitScript(() => {
      const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__recordingStreams = [];
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await getMedia(options); window.__recordingStreams.push(stream); return stream;
      };
    });
    await f.page.goto(`${base}/video/create`);
    await f.page.getByRole('button', { name: /实际目录名称/ }).click();
    assert.equal(await f.page.getByRole('button', { name: /实际目录名称/ }).count(), 2);
    await f.page.getByRole('button', { name: /实际目录名称/ }).last().click();
    await f.page.getByRole('button', { name: '开始视频语音输入', exact: true }).click();
    await f.page.getByRole('button', { name: '停止视频语音输入', exact: true }).waitFor();
    assert.equal(await f.page.evaluate(() => window.__recordingStreams[0].getTracks()[0].readyState), 'live');
    await f.switchAccount();
    await f.page.getByRole('button', { name: '开始视频语音输入', exact: true }).waitFor();
    assert.equal(await f.page.evaluate(() => window.__recordingStreams[0].getTracks()[0].readyState), 'ended');
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
