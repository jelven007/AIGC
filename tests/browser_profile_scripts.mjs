import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
import { deflateSync } from 'node:zlib';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', otherId = '99999999-9999-4999-8999-999999999999';
const productId = '22222222-2222-4222-8222-222222222222';
const sessionFor = id => ({ access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id, email: id === uid ? 'first@example.com' : 'second@example.com', created_at: '2026-10-01T00:00:00Z', app_metadata: {}, user_metadata: {} } });
function imageBytes() {
  const chunk = (type, payload) => {
    const data = Buffer.concat([Buffer.from(type), payload]), output = Buffer.alloc(12 + payload.length);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    output.writeUInt32BE(payload.length); data.copy(output, 4); output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
    return output;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 30, 60, 90, 30, 60, 90, 0, 30, 60, 90, 30, 60, 90]))), chunk('IEND', Buffer.alloc(0))]);
}
const png = imageBytes();
const scenes = [
  { order: 1, scene: '真实商品外观', visual: '展示已登记商品外观', dialogue: '这是确认后的商品描述。', duration: 5, prompt: 'Show the actual registered product in natural light.', layer: 'selling_point' },
  { order: 2, scene: '实际使用场景', visual: '展示商品使用过程', dialogue: '查看实际使用方法。', duration: 5, prompt: 'Show the actual product being used in a realistic setting.', layer: 'cta' },
];
const responseText = `## 分镜脚本\n\`\`\`json\n${JSON.stringify(scenes)}\n\`\`\`\n## AIGC Prompt\n\`\`\`prompt\nActual product video prompt.\n\`\`\``;
const profiles = Object.fromEntries([uid, otherId].map(id => [id, { id, username: id === uid ? '第一位用户' : '第二位用户',
  notification_enabled: false, role: 'user', created_at: '2026-10-01T00:00:00Z', avatar_url: null }]));
const state = { errors: [], forbidden: [], reads: [], held: [], holdOld: true, failProfile: false, failOverview: false,
  failNotification: true, failAvatarSave: true, uploads: [], assets: [], failText: false, text: responseText,
  scriptPosts: [], scripts: [], knowledgePosts: [], knowledge: [], failScriptResponse: true, batches: [] };
let releaseOld, oldReady;
const oldReleased = new Promise(resolve => { releaseOld = resolve; });
const requestsReady = new Promise(resolve => { oldReady = resolve; });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await context.addInitScript(value => {
  if (!localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value));
}, sessionFor(uid));
await context.route(`${backend}/**`, async route => {
  const req = route.request(), parsed = new URL(req.url()), path = parsed.pathname;
  const auth = req.headers().authorization || '';
  let id = uid;
  try { id = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url')).sub || uid; } catch {}
  let body = {}; try { body = req.postDataJSON() || {}; } catch {}
  state.reads.push({ path, method: req.method(), id, params: Object.fromEntries(parsed.searchParams) });
  let data = [], status = 200, contentType = 'application/json';
  if (req.method() === 'OPTIONS') data = {};
  else if (path.includes('/auth/v1/logout')) { status = 204; data = null; }
  else if (path.includes('/auth/')) data = sessionFor(id).user;
  else if (path.includes('/rest/v1/profiles')) {
    if (req.method() === 'POST') { state.forbidden.push('profile-insert'); status = 403; data = {}; }
    else if (req.method() === 'PATCH') {
      assert.equal(parsed.searchParams.get('id'), `eq.${id}`);
      if ('notification_enabled' in body && state.failNotification) { state.failNotification = false; status = 503; data = { message: 'save failed' }; }
      else if ('avatar_url' in body && state.failAvatarSave) { state.failAvatarSave = false; status = 503; data = { message: '头像保存暂时失败' }; }
      else { Object.assign(profiles[id], body); data = profiles[id]; }
    } else {
      data = { ...profiles[id] };
      if (id === uid && state.holdOld) { state.held.push('profile'); if (state.held.length >= 2) oldReady(); await oldReleased; }
      if (state.failProfile) { status = 503; data = { message: 'read failed' }; }
    }
  } else if (path.endsWith('/rpc/get_my_profile_overview')) {
    data = { videos: id === uid ? 1106 : 3, completed: id === uid ? 1105 : 2, materials: 4, products: 1, published: 1,
      timezone: body.p_timezone, activity: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, count: i === 29 ? (id === uid ? 1106 : 3) : 0 })) };
    if (id === uid && state.holdOld) { state.held.push('overview'); if (state.held.length >= 2) oldReady(); await oldReleased; }
    if (state.failOverview) { status = 503; data = { message: 'overview failed' }; }
  } else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(id);
  else if (path.includes('/storage/v1/object/sign/') && req.method() === 'POST') data = { signedURL: path.replace('/storage/v1', '') + '?token=fixture' };
  else if (path.includes('/storage/v1/object/') && req.method() === 'POST') {
    state.uploads.push(path); data = { Key: path.split('/object/')[1], Id: crypto.randomUUID() };
  } else if (path.includes('/storage/v1/object/')) { contentType = 'image/png'; data = png; }
  else if (path.endsWith('/material-assets')) {
    if (body.action === 'register') {
      let material = state.assets.find(item => item.upload_key === body.request_key);
      if (!material) { material = { id: crypto.randomUUID(), upload_key: body.request_key, user_id: id, name: body.input.name, type: body.input.type,
        url: `${backend}/storage/v1/object/authenticated/materials/${id}/uploads/${body.request_key}.${body.input.extension}`, created_at: '2026-10-22T00:00:00Z' };
        state.assets.push(material); }
      data = { material };
    } else data = { materials: state.assets.filter(item => item.user_id === id), total: state.assets.filter(item => item.user_id === id).length };
  } else if (path.endsWith('/text-generation')) {
    if (state.failText) { status = 503; data = { error: '文本服务暂时不可用' }; }
    else {
      contentType = 'text/event-stream';
      data = [state.text.slice(0, 90), state.text.slice(90)].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    }
  } else if (path.endsWith('/rest/v1/scripts') || path.endsWith('/rest/v1/knowledge_entries')) {
    const scripts = path.endsWith('/scripts'), rows = scripts ? state.scripts : state.knowledge;
    if (req.method() === 'POST') {
      (scripts ? state.scriptPosts : state.knowledgePosts).push(body);
      const existing = rows.find(row => row.id === body.id);
      if (existing) { status = 409; data = { code: '23505', message: 'existing' }; }
      else { data = { ...body, created_at: '2026-10-22T00:00:00Z' }; rows.push(data); }
      if (scripts && state.failScriptResponse) { state.failScriptResponse = false; status = 503; data = { message: 'response lost' }; }
    } else data = rows.find(row => `eq.${row.id}` === parsed.searchParams.get('id') && row.user_id === id) || null;
  } else if (path.endsWith('/product-management')) data = { products: [{ id: productId, user_id: id, name: '实际商品', category: '数码电器', price: 12 }], total: 1, offset: 0 };
  else if (path.endsWith('/rest/v1/products')) data = [{ id: productId, user_id: id, name: '实际商品', category: '数码电器', price: 12 }];
  else if (path.endsWith('/model-settings')) data = { configs: [{ slot: 'video.ArkSeedance', category: 'video', name: '已配置模型', provider: 'ArkSeedance', enabled: true }] };
  else if (path.endsWith('/batch-video-jobs')) {
    if (body.action === 'quote') data = { unit_cost: 10, max_items: 50, pipeline_costs: { video: 10, tts: 3, subtitles: 5, render: 0 } };
    else if (body.action === 'create') {
      state.batches.push(body);
      data = { batch: { id: crypto.randomUUID(), name: body.name, status: 'pending', provider: body.provider, created_at: '2026-10-22T00:00:00Z',
        total_count: 1, completed_count: 0, failed_count: 0, cancelled_count: 0, queued_count: 1, running_count: 0, attention_count: 0,
        reserved_credits: body.budget, settled_credits: 0, refunded_credits: 0, progress: 0, items: [] } };
    } else data = { batches: [] };
  } else if (path.endsWith('/video-jobs') || path.endsWith('/production-jobs')) data = { jobs: [] };
  await route.fulfill({ status, contentType, body: status === 204 ? undefined : contentType === 'application/json' ? JSON.stringify(data) : data,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
});
const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => state.errors.push(error.message));
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
  await page.goto(`${base}/profile`);
  await page.waitForFunction(() => document.body.textContent.includes('创作概览'));
  await Promise.race([requestsReady, new Promise((_, reject) => setTimeout(() => reject(new Error('旧账号请求未启动')), 15000))]);
  await switchAccount(otherId);
  await page.getByRole('heading', { name: '第二位用户', exact: true }).waitFor();
  const projectCard = page.getByText('视频项目', { exact: true }).locator('..');
  assert.match(await projectCard.textContent(), /3/);
  state.holdOld = false; releaseOld();
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  await page.getByRole('button', { name: '刷新概览', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '第一位用户', exact: true }).count(), 0);
  assert.match(await projectCard.textContent(), /3/);
  assert.equal(await page.getByLabel('2026-10-30：3 个视频项目', { exact: true }).count(), 1);
  state.failOverview = true;
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '创作概览读取失败' }).waitFor();
  assert.match(await projectCard.textContent(), /3/);
  state.failOverview = false;
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  const notification = page.getByRole('switch', { name: '消息通知', exact: true });
  await notification.click();
  await page.getByText('通知偏好保存失败，请重试', { exact: true }).waitFor();
  assert.equal(await notification.getAttribute('aria-checked'), 'false');
  await notification.click();
  await page.getByText('通知已开启', { exact: true }).waitFor();
  assert.equal(await notification.getAttribute('aria-checked'), 'true');
  console.log('PASS 跨标签身份切换、迟到旧资料/概览隔离、真实统计与查询失败保留数据、通知失败无伪成功');

  await page.getByRole('button', { name: '编辑资料', exact: true }).last().click();
  await page.getByLabel('用户名', { exact: true }).fill('已保存用户');
  await page.getByLabel('选择个人头像', { exact: true }).setInputFiles({ name: '自有头像.png', mimeType: 'image/png', buffer: png });
  const rights = page.getByRole('checkbox', { name: /我拥有头像图片的使用权/ });
  await rights.waitFor();
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
  await rights.check(); await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('头像保存暂时失败', { exact: false }).waitFor();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('heading', { name: '已保存用户', exact: true }).waitFor();
  assert.equal(state.uploads.length, 1);
  assert.match(profiles[otherId].avatar_url, /\/object\/authenticated\/materials\//);
  await page.getByRole('img', { name: '头像', exact: true }).waitFor();
  assert.match(await page.getByRole('img', { name: '头像', exact: true }).getAttribute('src'), /\/object\/sign\//);
  await page.getByRole('button', { name: /^账号安全/ }).click();
  await page.getByRole('dialog').getByText('登录邮箱：second@example.com', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/profile-production-mobile.png', fullPage: true });
  state.failProfile = true; await page.reload();
  await page.getByRole('alert').filter({ hasText: '个人资料读取失败' }).waitFor();
  assert.deepEqual(state.forbidden, []);
  state.failProfile = false; await page.getByRole('button', { name: '重试个人资料', exact: true }).click();
  await page.getByRole('heading', { name: '已保存用户', exact: true }).waitFor();
  console.log('PASS 头像真实登记、保存故障重试不重复上传、稳定引用/签名展示、资料读取失败不自动插入、会话信息和390px');

  await page.goto(`${base}/script`);
  await page.getByPlaceholder('例：无线降噪耳机 Pro', { exact: true }).fill('实际商品');
  const selling = page.getByPlaceholder('输入卖点后按 Enter', { exact: true });
  await selling.fill('已确认商品事实'); await selling.press('Enter');
  await page.getByPlaceholder('例：18-35岁爱好音乐的都市白领', { exact: true }).fill('确认后的目标用户');
  state.failText = true;
  await page.getByRole('button', { name: 'AI 一键生成脚本', exact: true }).click();
  await page.getByText('文本服务暂时不可用', { exact: true }).waitFor();
  assert.equal(await page.getByText('脚本生成完成', { exact: false }).count(), 0);
  state.failText = false;
  await page.getByRole('button', { name: 'AI 一键生成脚本', exact: true }).click();
  await page.getByText('脚本生成完成，请检查画面、台词和未标注的结构', { exact: true }).waitFor();
  await page.getByPlaceholder('场景名称', { exact: true }).first().waitFor();
  assert.equal(await page.getByPlaceholder('场景名称', { exact: true }).first().inputValue(), '真实商品外观');
  const prompt = page.getByPlaceholder('Prompt 文案...', { exact: true });
  assert.equal(await prompt.inputValue(), 'Actual product video prompt.');
  state.text = '```json\n[{"visual":"缺少正文"}]\n```';
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByText('模型分镜格式不正确，请重试', { exact: true }).waitFor();
  assert.equal(await page.getByPlaceholder('场景名称', { exact: true }).first().inputValue(), '真实商品外观');
  assert.equal(await prompt.inputValue(), 'Actual product video prompt.');
  state.text = responseText;
  await page.getByRole('button', { name: '保存并回写知识库', exact: true }).click();
  await page.getByText('脚本保存结果未确认，请重试原内容', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '恢复原脚本保存', exact: true }).click();
  await page.getByText('已恢复1份原保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存并回写知识库', exact: true }).click();
  await page.getByText('脚本已保存到知识库，请前往知识库建立语义索引', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存并回写知识库', exact: true }).click();
  assert.equal(state.scriptPosts.length, 1); assert.equal(state.knowledgePosts.length, 1);
  await page.getByRole('button', { name: '应用到视频生成', exact: true }).click();
  await page.getByPlaceholder('描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频').waitFor();
  assert.equal(await page.getByPlaceholder('描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频').inputValue(), 'Actual product video prompt.');
  await switchAccount(uid);
  await page.getByPlaceholder('描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频').waitFor();
  assert.equal(await page.getByPlaceholder('描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频').inputValue(), '');
  await switchAccount(otherId);
  await page.goto(`${base}/script`);
  await page.getByPlaceholder('场景名称', { exact: true }).first().waitFor();
  assert.equal(await page.getByPlaceholder('场景名称', { exact: true }).first().inputValue(), '真实商品外观');
  console.log('PASS 实际SSE正文解码、合法/无效分镜与失败保留、原UUID保存恢复/不重复知识记录、Prompt传入视频、跨账号路由状态清除和草稿恢复');

  await page.getByRole('button', { name: '生成多镜头配音成片', exact: true }).click();
  await page.getByText('已载入 实际商品 的分镜要求。请选择对应商品、填写音色并确认台词和预算。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加商品', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择实际商品', exact: true }).check();
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  assert.equal(await page.getByLabel('目标语言配音正文（必填）', { exact: true }).inputValue(), scenes.map(scene => scene.dialogue).join('\n'));
  await page.getByLabel('供应商音色ID', { exact: true }).fill('confirmed-voice');
  await page.getByRole('button', { name: '确认预算并创建批次', exact: true }).click();
  await page.getByText('批次已保存，当前预占 28 积分', { exact: true }).waitFor();
  assert.deepEqual(state.batches[0].pipeline.shots, scenes.map(scene => scene.prompt));
  assert.equal(state.batches[0].overrides[productId].narration, scenes.map(scene => scene.dialogue).join('\n'));
  assert.equal(state.batches[0].settings.duration, 5);
  assert.equal(state.batches[0].budget, 28);
  assert.equal(await page.getByText('视频生成完成', { exact: false }).count(), 0);
  await page.goto(`${base}/video/create`);
  await page.getByRole('button', { name: '分镜编辑', exact: true }).click();
  await page.getByRole('heading', { name: '分镜与成片工作台', exact: true }).waitFor();
  await page.getByRole('button', { name: '素材与作品', exact: true }).click();
  await page.getByRole('button', { name: '素材库', exact: true }).click();
  await page.getByRole('heading', { name: '自有头像.png', exact: true }).waitFor();
  await page.getByRole('button', { name: '多镜头成片', exact: true }).click();
  await page.getByRole('heading', { name: '批量生成工作台', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log('PASS 确认脚本到后台多镜头任务、真实台词/镜头/预算传递、首页分镜入口复用真实素材/成片组件和390px');
  assert.deepEqual(state.errors, []);
} finally { releaseOld(); await context.close(); await browser.close(); }
