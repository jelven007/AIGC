import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197', backend = 'https://ui-fixture.example';
const uid = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333';
const canvasId = '22222222-2222-4222-8222-222222222222';
function sessionFor(id) {
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Date.now() / 1000 + 3600 })).toString('base64url')}.fixture`,
    refresh_token: 'fixture', token_type: 'bearer', expires_at: Date.now() / 1000 + 3600, expires_in: 3600,
    user: { id, email: `${id}@example.com`, app_metadata: {}, user_metadata: {} } };
}
async function fixture() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(session => {
    if (!localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
  }, sessionFor(uid));
  const state = { errors: [], writes: [], creates: [], jobs: [], failSave: false, lostCreate: false,
    lostJob: false, materials: [], project: { id: canvasId, user_id: uid, title: '测试创作画布', revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      document: { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } };
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let id = uid; try { id = JSON.parse(Buffer.from((req.headers().authorization || '').split('.')[1], 'base64url')).sub; } catch {}
    let data = [], status = 200;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = sessionFor(id).user;
    else if (path.includes('/profiles')) data = { id, username: '画布测试', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(id);
    else if (path.includes('/credit_costs')) data = { cost: 10 };
    else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'image.primary', category: 'image', name: '测试图片模型', enabled: true,
      version_id: '44444444-4444-4444-8444-444444444444', image_capabilities: { reference: true, mask: true } }] };
    else if (path.includes('/object/sign/') && req.method() === 'POST') data = { signedURL: path.replace('/storage/v1', '') + '?token=fixture' };
    else if (path.includes('/storage/v1/object/')) {
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
    } else if (path.endsWith('/material-assets')) {
      const materials = state.materials.filter(m => !body.type || m.type === body.type);
      data = { materials, total: materials.length };
    }
    else if (path.includes('/canvas_projects')) data = id === uid && (!url.searchParams.has('id') || url.searchParams.get('id') === `eq.${state.project.id}`) ? [state.project] : [];
    else if (path.endsWith('/rpc/create_canvas_project')) {
      state.creates.push(body); state.project = { ...state.project, id: body.p_id, title: body.p_title, document: body.p_document, revision: 1 };
      status = state.lostCreate ? 503 : 200; data = state.lostCreate ? { message: '创建待确认' } : state.project;
    } else if (path.endsWith('/rpc/save_canvas_project')) {
      state.writes.push({ id, body });
      if (state.failSave) { status = 503; data = { message: '保存服务暂时不可用' }; }
      else if (body.p_revision !== state.project.revision) { status = 409; data = { message: '版本冲突' }; }
      else { state.project = { ...state.project, title: body.p_title, document: body.p_document, revision: state.project.revision + 1 }; data = state.project; }
    } else if (path.endsWith('/production-jobs')) {
      if (body.action === 'create') {
        state.jobs.push({ ...body, id: crypto.randomUUID(), status: 'running', progress: 25, result: null });
        data = { job: state.jobs.at(-1) };
        if (state.lostJob) { state.lostJob = false; status = 503; data = { error: '图片提交结果待确认' }; }
      } else if (body.action === 'query') data = { job: state.jobs.at(-1) };
      else data = { jobs: [] };
    } else if (path.endsWith('/video-jobs')) data = { jobs: [] };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', e => state.errors.push(e.message));
  return { page, context, state, close: async () => { await context.close(); await browser.close(); } };
}
async function save(f) {
  await f.page.getByRole('button', { name: '保存画布', exact: true }).click();
  await f.page.getByText('已保存', { exact: true }).waitFor();
}
test('canvas edits, real drag, one-step undo, grouping and refresh preserve the document', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/canvas/${canvasId}`);
    await f.page.getByLabel('画布名称', { exact: true }).waitFor();
    await f.page.getByRole('button', { name: '添加文字', exact: true }).click();
    await f.page.getByLabel('文字内容', { exact: true }).fill('清晨的咖啡与柔和阳光');
    await save(f);
    const original = structuredClone(f.state.project.document.nodes[0].position);
    const header = f.page.locator('.canvas-node-header').first(), box = await header.boundingBox(); assert.ok(box);
    await f.page.mouse.move(box.x + 80, box.y + 20); await f.page.mouse.down();
    await f.page.mouse.move(box.x + 165, box.y + 95, { steps: 12 }); await f.page.mouse.up();
    await save(f); const moved = structuredClone(f.state.project.document.nodes[0].position);
    assert.ok(moved.x > original.x + 70); assert.ok(moved.y > original.y + 60);
    await f.page.getByRole('button', { name: '撤销', exact: true }).click(); await save(f);
    assert.deepEqual(f.state.project.document.nodes[0].position, original);
    await f.page.getByRole('button', { name: '重做', exact: true }).click(); await save(f);
    assert.deepEqual(f.state.project.document.nodes[0].position, moved);
    await f.page.getByRole('button', { name: '复制节点', exact: true }).click(); await save(f);
    assert.equal(f.state.project.document.nodes.length, 2);
    await f.page.getByRole('button', { name: '分组选中节点', exact: true }).click(); await save(f);
    assert.equal(f.state.project.document.nodes.filter(n => n.type === 'group').length, 1);
    await f.page.reload(); await f.page.getByLabel('画布名称', { exact: true }).waitFor(); await save(f);
    assert.ok(f.state.project.document.nodes.some(n => n.data.text === '清晨的咖啡与柔和阳光'));
    await f.page.getByRole('button', { name: '适应全部节点', exact: true }).click();
    await f.page.screenshot({ path: '/tmp/aigc-canvas-desktop.png' });
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('failed save keeps local draft; a second tab conflict can export and save another canvas', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/canvas/${canvasId}`);
    await f.page.getByRole('button', { name: '添加文字', exact: true }).click();
    await f.page.getByLabel('文字内容').fill('保留我的本地编辑');
    f.state.failSave = true;
    await f.page.getByRole('button', { name: '保存画布', exact: true }).click();
    await f.page.getByText('保存失败', { exact: true }).waitFor();
    const draft = await f.page.evaluate(({ uid, canvasId }) => JSON.parse(localStorage.getItem(`aigc:canvas-draft:${uid}:${canvasId}`)), { uid, canvasId });
    assert.equal(draft.document.nodes[0].data.text, '保留我的本地编辑');
    f.state.failSave = false; await save(f);
    await f.page.addInitScript(({ uid, canvasId }) => {
      const key = `aigc:canvas-draft:${uid}:${canvasId}`, value = JSON.parse(localStorage.getItem(key));
      if (value) { value.baseRevision = 1; localStorage.setItem(key, JSON.stringify(value)); }
    }, { uid, canvasId });
    await f.page.reload(); await f.page.getByLabel('画布名称').waitFor();
    assert.equal(await f.page.getByRole('button', { name: '重载云端', exact: true }).count(), 0);
    await f.page.locator('.canvas-node-header').first().click();
    const second = await f.context.newPage(); await second.goto(`${base}/canvas/${canvasId}`);
    await second.getByLabel('画布名称').waitFor();
    await f.page.getByLabel('文字内容').fill('第一页已保存的新内容'); await save(f);
    await second.locator('.canvas-node-header').first().click();
    await second.getByLabel('文字内容').fill('第二页的冲突内容');
    await second.getByRole('button', { name: '保存画布', exact: true }).click();
    await second.getByRole('button', { name: '重载云端', exact: true }).waitFor();
    assert.equal(f.state.project.document.nodes[0].data.text, '第一页已保存的新内容');
    const download = second.waitForEvent('download');
    await second.getByRole('button', { name: '导出工程', exact: true }).click(); await download;
    await second.getByRole('button', { name: '另存画布副本', exact: true }).click();
    await second.waitForURL(url => !url.pathname.endsWith(canvasId));
    assert.equal(f.state.creates.length, 1);
    assert.equal(f.state.creates[0].p_document.nodes[0].data.text, '第二页的冲突内容');
    await second.close(); assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('a node added beside a group stays outside its bounds and can be selected', async () => {
  const f = await fixture();
  try {
    f.state.project.document.nodes = [
      { id: 'group-area', type: 'group', position: { x: 0, y: 0 }, width: 900, height: 700, data: { name: '已有分组' } },
      { id: 'group-text', type: 'text', parentId: 'group-area', extent: 'parent', position: { x: 200, y: 180 },
        data: { name: '分组文字', text: '分组中的已有内容' } },
    ];
    await f.page.goto(`${base}/canvas/${canvasId}`);
    await f.page.getByRole('button', { name: '添加图片', exact: true }).click();
    await save(f);
    const image = f.state.project.document.nodes.find(n => n.type === 'image');
    assert.ok(image.position.x >= 900 || image.position.y >= 700 || image.position.x + 280 <= 0 || image.position.y + 300 <= 0,
      'the inserted node must not be hidden inside the existing group');
    await f.page.getByRole('button', { name: '适应全部节点', exact: true }).click();
    await f.page.locator('.react-flow__node-image .canvas-node-header').click();
    await f.page.getByLabel('图片描述', { exact: true }).waitFor();
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('connected text drives a real image request, lost response restores UUID and completed result survives reload', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/canvas/${canvasId}`);
    await f.page.getByRole('button', { name: '添加文字', exact: true }).click();
    await f.page.getByLabel('文字内容').fill('连接的提示词快照');
    await f.page.getByRole('button', { name: '添加图片', exact: true }).click();
    await f.page.getByLabel('图片描述').fill('不应使用的本节点描述');
    const options = await f.page.getByLabel('文字来源').locator('option').evaluateAll(items => items.map(i => i.value));
    await f.page.getByLabel('文字来源').selectOption(options[1]);
    f.state.lostJob = true;
    await f.page.getByRole('button', { name: '生成图片', exact: true }).click();
    await f.page.getByRole('button', { name: '刷新任务进度', exact: true }).waitFor();
    await f.page.getByRole('button', { name: '刷新任务进度', exact: true }).click();
    await f.page.getByText('生成中 25%', { exact: true }).waitFor();
    assert.equal(f.state.jobs.length, 1); assert.equal(f.state.jobs[0].input.prompt, '连接的提示词快照');
    assert.equal(f.state.jobs[0].project_id, undefined);
    const original = f.state.jobs[0].request_key;
    await save(f);
    await f.page.reload();
    await f.page.getByText('生成中 25%', { exact: true }).waitFor();
    await f.page.locator('.react-flow__node-image .canvas-node-header').click();
    f.state.jobs[0].status = 'completed'; f.state.jobs[0].progress = 100;
    f.state.jobs[0].result = { url: `${backend}/storage/v1/object/authenticated/materials/${uid}/generated.png` };
    await f.page.getByRole('button', { name: '刷新任务进度', exact: true }).click();
    await f.page.locator('.canvas-node-image img').waitFor(); await save(f);
    assert.equal(f.state.project.document.nodes.find(n => n.type === 'image').data.task.request_key, original);
    assert.equal(f.state.project.document.nodes.find(n => n.type === 'image').data.task.status, 'completed');
    assert.equal(f.state.jobs.length, 1);
    await f.page.reload(); await f.page.locator('.canvas-node-image img').waitFor();
    assert.equal(await f.page.evaluate(({ uid, canvasId }) => localStorage.getItem(`aigc:canvas-image:${uid}:${canvasId}`), { uid, canvasId }), null);
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('dragging ports creates one input; deleting a running node never revives it', async () => {
  const f = await fixture();
  try {
    f.state.project.document.nodes = [
      { id: 'text-source', type: 'text', position: { x: 80, y: 180 }, data: { name: '创意描述', text: '真实连线输入' } },
      { id: 'image-target', type: 'image', position: { x: 450, y: 180 }, data: { name: '生成画面', prompt: '', size: '1024x1024', quality: 'medium' } },
    ];
    await f.page.goto(`${base}/canvas/${canvasId}`);
    const source = f.page.locator('.react-flow__node-text .react-flow__handle.source'), target = f.page.locator('.react-flow__node-image .react-flow__handle.target');
    const from = await source.boundingBox(), to = await target.boundingBox(); assert.ok(from && to);
    await f.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await f.page.mouse.down();
    await f.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 }); await f.page.mouse.up();
    await save(f); assert.equal(f.state.project.document.edges.length, 1);
    await f.page.locator('.react-flow__node-image .canvas-node-header').click();
    await f.page.screenshot({ path: '/tmp/aigc-canvas-connected.png' });
    await f.page.getByRole('button', { name: '生成图片', exact: true }).click();
    await f.page.getByText('生成中 25%', { exact: true }).waitFor(); await save(f);
    await f.page.getByRole('button', { name: '删除节点', exact: true }).click(); await save(f);
    assert.equal(f.state.project.document.nodes.length, 1); assert.equal(f.state.project.document.edges.length, 0);
    f.state.jobs[0].status = 'completed'; f.state.jobs[0].result = { url: `${backend}/storage/v1/object/authenticated/materials/${uid}/deleted-result.png` };
    await f.page.reload(); await f.page.getByLabel('画布名称').waitFor();
    await f.page.waitForFunction(({ uid, canvasId }) => localStorage.getItem(`aigc:canvas-image:${uid}:${canvasId}`) === null, { uid, canvasId });
    assert.equal(await f.page.locator('.react-flow__node-image').count(), 0);
    assert.equal(f.state.jobs.length, 1); assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('mobile drawers and controls fit 320px; input focus does not trigger canvas shortcuts', async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${base}/canvas/${canvasId}`);
    for (const width of [1440, 1024, 390, 320]) {
      await f.page.setViewportSize({ width, height: 844 });
      await f.page.getByRole('button', { name: '添加文字', exact: true }).waitFor();
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const bounds = await f.page.locator('.canvas-stage').boundingBox(); assert.ok(bounds.height > 500);
      if (width < 768) {
        const box = await f.page.getByRole('button', { name: '添加文字', exact: true }).boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify({ width, box }));
      }
    }
    await f.page.getByRole('button', { name: '添加文字', exact: true }).click();
    const input = f.page.getByLabel('文字内容'); await input.fill('手机抽屉中的文字');
    await input.press('Control+d'); await input.press('Delete');
    assert.equal(await f.page.locator('.react-flow__node-text').count(), 1);
    await f.page.screenshot({ path: '/tmp/aigc-canvas-mobile-inspector.png' });
    await f.page.getByRole('dialog').getByRole('button', { name: '关闭侧栏', exact: true }).click();
    await save(f); assert.equal(f.state.project.document.nodes[0].data.text, '手机抽屉中的文字');
    await f.page.getByRole('button', { name: '打开素材库', exact: true }).click();
    await f.page.getByRole('heading', { name: '素材库', exact: true }).waitFor();
    await f.page.screenshot({ path: '/tmp/aigc-canvas-mobile.png' });
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('new canvas recovers a lost creation receipt and a changed account cannot read old canvas', async () => {
  const f = await fixture();
  try {
    f.state.lostCreate = true;
    await f.page.goto(`${base}/canvas`);
    await f.page.getByRole('button', { name: '新建画布', exact: true }).click();
    await f.page.getByLabel('画布名称').waitFor();
    assert.equal(f.state.creates.length, 1);
    assert.ok(f.page.url().endsWith(f.state.creates[0].p_id));
    await f.page.getByRole('button', { name: '添加文字', exact: true }).click();
    await f.page.getByLabel('文字内容').fill('原账号的私有内容'); await save(f);
    const helper = await f.context.newPage(); await helper.goto(`${base}/landing`);
    await helper.evaluate(session => {
      localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
      const channel = new BroadcastChannel('sb-ui-fixture-auth-token'); channel.postMessage({ event: 'SIGNED_IN', session }); channel.close();
    }, sessionFor(other));
    await helper.close();
    await f.page.getByRole('alert').getByText('画布不存在或无权访问', { exact: true }).waitFor();
    assert.equal(await f.page.locator('.canvas-node-text').count(), 0);
    assert.ok(f.state.writes.every(w => w.id === uid)); assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
test('owned library media creates all media node types and passes checked references into the video workbench', async () => {
  const f = await fixture();
  try {
    f.state.materials = ['image', 'video', 'audio'].map(type => ({ id: crypto.randomUUID(), user_id: uid, name: `私有${type}`, type,
      url: `${backend}/storage/v1/object/authenticated/materials/${uid}/${type}.${type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'mp3'}` }));
    await f.page.goto(`${base}/canvas/${canvasId}`);
    for (const [type, label] of [['image', '图片'], ['video', '视频'], ['audio', '音频']]) {
      await f.page.getByRole('button', { name: `添加${label}`, exact: true }).click();
      await f.page.getByRole('button', { name: '选择或上传素材', exact: true }).click();
      await f.page.getByRole('button', { name: `使用私有${type}`, exact: true }).click();
      await save(f);
      assert.ok(f.state.project.document.nodes.some(n => n.type === type && n.data.materialId));
    }
    await f.page.locator('.react-flow__node-image .canvas-node-header').click();
    await f.page.getByRole('button', { name: '用于视频创作', exact: true }).click();
    await f.page.waitForURL('**/video/create');
    await f.page.getByRole('button', { name: '移除视频参考图片', exact: true }).waitFor();
    const src = await f.page.getByAltText('Ref Image').getAttribute('src');
    assert.ok(src.includes('/object/sign/materials/') && src.includes(uid));
    assert.equal(f.state.jobs.length, 0); assert.deepEqual(f.state.errors, []);
  } finally { await f.close(); }
});
