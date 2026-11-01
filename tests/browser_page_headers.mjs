import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { creditSnapshot } from './browser_credit_fixture.mjs';
import { verifyAvatarToolbar } from './browser_avatar_toolbar_checks.mjs';
import { measureActionButtons, verifyActionButtons } from './browser_button_height_checks.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const baseline = process.env.PAGE_HEADER_BASELINE === '1';
const buttonBaseline = process.env.BUTTON_HEIGHT_BASELINE === '1';
const routes = [
  ['/settings/models', '模型接口'], ['/settings/integrations', '第三方集成'],
  ['/products', '商品管理'], ['/avatars', '数字人库'], ['/video/create', '工作台'],
  ['/video/edit', '视频剪辑'], ['/product-selection', '智能选品'], ['/works', '作品素材'],
  ['/ai-toolbox', 'AI工具箱'], ['/export-formats', '跨平台导出'], ['/data-feedback', '多平台分析'],
  ['/team', '团队协作'], ['/open-api', '开放平台'], ['/operations', '运营控制台'], ['/support', '帮助与工单'],
  ['/knowledge', '提示词知识库'], ['/script', '视频分镜脚本'], ['/style-copy', '爆款风格复刻'],
  ['/live-highlight', '直播高光切片'], ['/emotion-analysis', '口播台词优化'],
  ['/competitor', '竞品爆款监控'], ['/analytics', '作品改进优化'],
  ['/profile', '个人中心'], ['/credits', '积分与套餐'], ['/invite', '邀请有礼'],
  ['/activities', '活动奖励'], ['/notifications', '消息通知'],
  ['/templates', '视频模板库'], ['/prompt-templates', '提示词模板库'], ['/materials', '素材库'],
  ['/multilang', '多语言视频脚本'], ['/batch-create', '批量生成工作台'], ['/task-queue', '任务中心'],
  ['/llm-cache', 'LLM 响应缓存'], ['/personalize', 'AI 个性化微调'], ['/trending-patterns', '行业爆款特征库'],
  ['/publish', '跨平台发布'], ['/ab-test', 'A/B 对照实验'], ['/data-dashboard', '数据看板与报表'],
];
const uid = '11111111-1111-4111-8111-111111111111';
const session = {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'creator@example.com', app_metadata: { role: 'admin' }, user_metadata: {} },
};
const emptyReport = {
  project_count: 0, completed_count: 0, projects: [], natural: [], delivery: [], natural_count: 0,
  style_distribution: [], duration_distribution: [], creation_trend: [], sync_issues: [], generated_at: new Date().toISOString(),
  natural_totals: Object.fromEntries(['view_count', 'like_count', 'comment_count', 'share_count']
    .map(key => [key, { value: null, observed: 0, total: 0 }])),
};
async function fixture(browser, width, admin = true, touch = false, authenticated = true) {
  const identity = structuredClone(session);
  if (!admin) identity.user.app_metadata.role = 'user';
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', hasTouch: touch });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(({ identity, authenticated }) => {
    window.__SHOPRO_RUNTIME__ = { backendUrl: 'https://ui-fixture.example', backendAnonKey: 'fixture' };
    if (authenticated) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(identity));
  }, { identity, authenticated });
  const requests = [];
  await context.route('https://ui-fixture.example/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    requests.push({ path, body });
    let data = [];
    if (path.includes('/auth/')) data = identity.user;
    else if (path.endsWith('/profiles')) data = { id: uid, username: '创作者', role: identity.user.app_metadata.role };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { plan_level: 3, configured_plan_level: 3 });
    else if (path.endsWith('/rpc/read_notifications')) data = { items: [], total: 0, unread: 0, unread_all: 0,
      cutoff: new Date().toISOString(), preferences: { task_success: true, intelligence_success: true } };
    else if (path.endsWith('/rpc/get_my_invitations')) data = { items: [], total: 0, completed: 0, credits: 0, legacy: 0, invite_code: 'CREATOR123456789' };
    else if (path.endsWith('/rpc/get_my_activities')) data = { items: [], server_time: new Date().toISOString(), checkin_timezone: 'UTC' };
    else if (path.endsWith('/product-management')) data = { products: [], total: 0, offset: 0 };
    else if (path.endsWith('/model-settings')) data = body.action === 'import-legacy' ? { imported: 0, skipped: 0 } : { configs: [] };
    else if (path.endsWith('/platform-accounts')) data = { apps: [], platforms: [], connections: [] };
    else if (path.endsWith('/platform-publish')) data = { tasks: [], groups: [] };
    else if (path.endsWith('/batch-video-jobs')) data = { batches: [] };
    else if (path.endsWith('/media-jobs')) data = { jobs: [], voices: [], cost: 1, prices: {} };
    else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) data = { jobs: [], voices: [], costs: {}, cost: 1, prices: {} };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    else if (path.endsWith('/api-keys')) data = { keys: [] };
    else if (path.endsWith('/team-space')) data = { team: null, members: [] };
    else if (path.endsWith('/market-intelligence')) data = { targets: [], sources: [], prices: {}, jobs: [] };
    else if (path.endsWith('/knowledge-base')) data = { documents: [], jobs: [], prices: {}, namespaces: [] };
    else if (path.endsWith('/measurements')) data = { report: emptyReport, projects: [], cost: 1, sources: [], experiments: [] };
    else if (path.endsWith('/operations')) data = body.action === 'access'
      ? { root: true, permissions: ['orders:read'], grants: [] }
      : { items: [], total: 0, page: 1, page_size: 20, observed_at: new Date().toISOString() };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, errors, requests, close: () => context.close() };
}
async function geometry(page) {
  return page.locator('main').evaluate(main => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const title = main.querySelector('h1'), header = title.closest('[data-page-header]') || title.parentElement;
    const actions = header.querySelector('[data-page-actions]');
    const topbar = document.querySelector('.app-shell > div > header');
    const brand = [...document.querySelectorAll('.app-sidebar-brand')].find(e => e.getBoundingClientRect().width > 0);
    const media = main.querySelector('#media-jobs');
    const editor = main.querySelector(':scope > .video-editor');
    const libraryActions = main.querySelector('[data-library-actions]');
    return { main: rect(main), title: rect(title), titleText: title.textContent, header: rect(header), actions: actions && rect(actions),
      topbar: topbar && rect(topbar), brand: brand && rect(brand), media: media && rect(media),
      editor: editor && rect(editor), mainGroupLabel: [...document.querySelectorAll('nav p')].some(e => e.textContent.trim() === '主要功能'),
      libraryActions: libraryActions && rect(libraryActions),
      description: header.querySelector('.page-description') && rect(header.querySelector('.page-description')),
      controls: actions ? [...actions.querySelectorAll('[data-slot="button"]')].filter(e => e.getBoundingClientRect().width > 0)
        .map(e => ({ ...rect(e), name: e.getAttribute('aria-label') || e.textContent.trim(),
          font: getComputedStyle(e).fontSize, radius: getComputedStyle(e).borderRadius })) : [],
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
}
for (const width of [1440, 1024, 390, 320]) {
  test(`menu page title origins and action controls align at ${width}px`, async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
    const f = await fixture(browser, width), records = [];
    try {
      for (const [path, title] of routes) {
        await f.page.goto(`${base}${path}`);
        await f.page.locator('main h1').first().waitFor();
        // Permission resolution and reduced-motion make these geometry checks stable.
        if (path === '/operations') await f.page.getByRole('button', { name: '刷新', exact: true }).waitFor();
        const g = await geometry(f.page);
        records.push({ path, ...g });
        if (process.env.PAGE_HEADER_SCREENSHOTS && ['/settings/models', '/settings/integrations', '/products', '/avatars', '/video/create', '/video/edit', '/script'].includes(path)) {
          await f.page.screenshot({ path: join(process.env.PAGE_HEADER_SCREENSHOTS,
            `${title}-${baseline ? 'before' : 'after'}-${width}.png`), fullPage: path !== '/video/edit' });
        }
        if (baseline) continue;
        const inset = width >= 768 ? 24 : 16;
        const topInset = width >= 768 ? 16 : 12;
        assert.ok(Math.abs(g.title.x - g.main.x - inset) < 1, `${path} title x: ${JSON.stringify(g)}`);
        assert.ok(Math.abs(g.title.y - g.main.y - topInset) < 1, `${path} title y: ${JSON.stringify(g)}`);
        assert.equal(g.topbar?.height, 48, `${path} shared topbar height`);
        if (g.brand) assert.equal(g.brand.height, 48, `${path} sidebar brand matches topbar`);
        assert.equal(g.mainGroupLabel, false, `${path} obsolete menu group heading`);
        if (process.env.PAGE_HEADER_BEFORE) {
          const before = JSON.parse(readFileSync(join(process.env.PAGE_HEADER_BEFORE, `geometry-before-${width}.json`)))
            .find(row => row.path === path);
          const ratio = g.header.height / before.header.height;
          assert.ok(ratio >= 0.6 && ratio <= 0.8, `${path} header ratio ${ratio.toFixed(3)}: ${g.header.height}/${before.header.height}`);
        }
        assert.equal(g.titleText, title, `${path} primary title`);
        assert.equal(g.overflow, false, `${path} horizontal overflow`);
        if (g.description) assert.ok(Math.abs(g.description.y - g.title.bottom - 2) < 1, `${path} description gap`);
        if (g.media) {
          assert.ok(Math.abs(g.media.width - g.header.width) < 1, `${path} workbench matches page width`);
          assert.ok(Math.abs(g.libraryActions.right - g.header.right) < 1, `${path} upload aligns right`);
          assert.ok(g.libraryActions.y >= g.media.bottom, `${path} upload belongs below workbench`);
        }
        if (g.editor) assert.ok(Math.abs(g.editor.bottom - 1000) < 1, `${path} editor fits below topbar`);
        if (g.actions) {
          if (width >= 768) {
            assert.ok(Math.abs(g.actions.y - g.title.y) < 1, `${path} actions should start at the title top`);
            assert.ok(Math.abs(g.actions.right - g.main.right + inset) < 1, `${path} actions should align to the content right edge`);
          } else {
            assert.ok(Math.abs(g.actions.y - (g.description?.bottom || g.title.bottom) - 4) < 1, `${path} compact mobile action gap`);
            if (path === '/avatars') assert.ok(Math.abs(g.actions.right - g.header.right) < 1, `${path} library switch aligns right`);
            else assert.ok(Math.abs(g.actions.x - g.title.x) < 1, `${path} mobile action row aligns left`);
          }
          for (const control of g.controls) {
            assert.equal(control.height, 32, `${path} ${control.name} button height`);
            assert.equal(control.font, '14px', `${path} ${control.name} button font`);
            assert.equal(control.radius, '8px', `${path} ${control.name} button radius`);
            assert.ok(control.right <= g.main.right - inset + 1, `${path} ${control.name} fits content`);
          }
        }
      }
      if (process.env.PAGE_HEADER_SCREENSHOTS) writeFileSync(join(process.env.PAGE_HEADER_SCREENSHOTS,
        `geometry-${baseline ? 'before' : 'after'}-${width}.json`), JSON.stringify(records, null, 2));
      assert.deepEqual(f.errors, [], 'No rendered route should crash');
    } finally { await f.close(); await browser.close(); }
  });
}
test('avatar toolbar heights match the library selector and all controls align', async () => {
  if (baseline) return;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const [width, touch] of [[1440, false], [1024, false], [390, false], [320, false], [390, true], [320, true]]) {
      const f = await fixture(browser, width, true, touch);
      try {
        await f.page.goto(`${base}/avatars`);
        const result = await verifyAvatarToolbar(f.page, width, touch);
        if (process.env.AVATAR_TOOLBAR_EVIDENCE) {
          await f.page.screenshot({ path: join(process.env.AVATAR_TOOLBAR_EVIDENCE, `avatar-${width}-${touch ? 'touch' : 'mouse'}.png`), fullPage: true });
          writeFileSync(join(process.env.AVATAR_TOOLBAR_EVIDENCE, `avatar-${width}-${touch ? 'touch' : 'mouse'}.json`), JSON.stringify(result, null, 2));
        }
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    }
  } finally { await browser.close(); }
});
test('header controls still open creation dialogs, navigate and refresh the current scope', async () => {
  if (baseline) return;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const f = await fixture(browser, 390);
  try {
    const p = f.page, actions = () => p.locator('[data-page-actions]').first();
    await p.goto(`${base}/products`);
    await actions().getByRole('button', { name: '添加商品', exact: true }).click();
    await p.getByRole('dialog').waitFor();
    await p.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await p.goto(`${base}/avatars`);
    await p.locator('[data-library-actions]').getByRole('button', { name: '上传头像', exact: true }).click();
    await p.getByRole('dialog').waitFor();
    await p.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    const templates = actions().getByRole('button', { name: '视频模板库', exact: true });
    await templates.focus();
    await p.keyboard.press('Enter');
    assert.equal(await templates.getAttribute('aria-pressed'), 'true');
    assert.equal(await p.getByRole('button', { name: '上传头像', exact: true }).count(), 0);
    await actions().getByRole('button', { name: '数字人库', exact: true }).click();
    await p.getByRole('button', { name: '上传头像', exact: true }).waitFor();
    assert.equal(await p.locator('[data-page-header] h1').textContent(), '数字人库');
    await p.goto(`${base}/video/create`);
    await actions().getByRole('button', { name: '图片生成', exact: true }).click();
    assert.equal(await actions().getByRole('button', { name: '图片生成', exact: true }).getAttribute('aria-pressed'), 'true');
    await actions().getByRole('button', { name: '分镜编辑', exact: true }).click();
    await p.getByRole('heading', { name: '分镜与成片工作台', exact: true }).waitFor();
    assert.equal(await p.locator('[data-page-header] h1').first().textContent(), '工作台');
    await p.goto(`${base}/open-api`);
    await actions().getByRole('button', { name: '创建 Key', exact: true }).click();
    await p.getByRole('dialog').waitFor();
    await p.goto(`${base}/script`);
    await actions().getByRole('button', { name: '从知识库选取资料', exact: true }).click();
    await p.waitForURL(`${base}/knowledge`);
    for (const scope of ['models', 'integrations']) {
      await p.goto(`${base}/settings/${scope}`);
      await p.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
      const before = f.requests.filter(r => r.path.endsWith('/model-settings') && r.body.scope === scope).length;
      await actions().getByRole('button', { name: '刷新', exact: true }).click();
      await p.waitForFunction(() => !document.body.textContent.includes('正在加载配置'));
      assert.ok(f.requests.filter(r => r.path.endsWith('/model-settings') && r.body.scope === scope).length > before);
    }
    await p.goto(`${base}/video/edit`);
    await p.getByRole('button', { name: '重命名', exact: true }).click();
    await p.getByRole('dialog', { name: '保存剪辑项目', exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); await browser.close(); }
});
test('touchscreen header controls retain 44px targets and wrap within the viewport', async () => {
  if (baseline) return;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const f = await fixture(browser, 320, true, true);
  try {
    for (const path of ['/settings/integrations', '/products', '/video/create', '/video/edit', '/credits']) {
      await f.page.goto(`${base}${path}`);
      await f.page.locator('main h1').first().waitFor();
      const g = await geometry(f.page);
      for (const control of g.controls) {
        assert.equal(control.height, 44, `${path} ${control.name} touch target`);
        assert.ok(control.right <= 304, `${path} ${control.name} fits touch viewport`);
      }
      assert.equal(g.overflow, false, path);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); await browser.close(); }
});
test('non-admin configuration pages use the same title position without admin actions', async () => {
  if (baseline) return;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const f = await fixture(browser, 1440, false);
  try {
    for (const scope of ['models', 'integrations']) {
      await f.page.goto(`${base}/settings/${scope}`);
      await f.page.locator('main h1').waitFor();
      const g = await geometry(f.page);
      assert.ok(Math.abs(g.title.x - g.main.x - 24) < 1);
      assert.ok(Math.abs(g.title.y - g.main.y - 16) < 1);
      assert.equal(await f.page.locator('main [data-page-actions]').count(), 0);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); await browser.close(); }
});
test('all page and dialog action buttons follow the desktop and touchscreen height limits', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const records = [];
  try {
    for (const [width, touch] of [[1440, false], [1024, false], [390, true], [320, true]]) {
      const f = await fixture(browser, width, true, touch);
      try {
        const check = async scope => {
          const buttons = buttonBaseline ? await measureActionButtons(f.page) : await verifyActionButtons(f.page, touch, scope);
          records.push({ width, touch, scope, buttons });
        };
        for (const [path] of routes) {
          await f.page.goto(`${base}${path}`);
          await f.page.locator('main h1').first().waitFor();
          if (path === '/operations') await f.page.getByRole('button', { name: '刷新', exact: true }).waitFor();
          await check(path);
        }
        for (const [path, name] of [['/products', '添加商品'], ['/avatars', '上传头像'], ['/open-api', '创建 Key'], ['/video/edit', '重命名']]) {
          await f.page.goto(`${base}${path}`);
          await f.page.getByRole('button', { name, exact: true }).click();
          await f.page.getByRole('dialog').waitFor();
          await check(`${path}:dialog`);
          await f.page.keyboard.press('Escape');
        }
        await f.page.goto(`${base}/video/create`);
        for (const name of ['图片生成', '分镜编辑', '视频生成']) {
          await f.page.locator('[data-page-actions]').getByRole('button', { name, exact: true }).click();
          await check(`/video/create:${name}`);
        }
        for (const name of ['视频生成', '图片生成']) {
          await f.page.locator('[data-page-actions]').getByRole('button', { name, exact: true }).click();
          await f.page.locator('.workspace-spec-button:visible').click();
          await check(`/video/create:${name}:参数`);
          await f.page.getByRole('button', { name: '1:1', exact: true }).click();
          await f.page.locator('.workspace-spec-button:visible').click();
        }
        await f.page.goto(`${base}/video/edit`);
        for (const name of ['效果 (E)', '字幕 (T)', 'AI工具 (I)', '资源库 (S)']) {
          await f.page.getByRole('button', { name, exact: true }).click();
          await check(`/video/edit:${name}`);
          if (name === 'AI工具 (I)') {
            const tools = await f.page.locator('button[aria-description]').evaluateAll(buttons => buttons.map(button => ({
              name: button.getAttribute('aria-label'), height: button.clientHeight, content: button.scrollHeight,
            })));
            assert.ok(tools.length > 0);
            assert.ok(tools.every(tool => tool.content <= tool.height), `AI tool text exceeds button height: ${JSON.stringify(tools)}`);
          }
          if (name === '效果 (E)') {
            for (const tab of ['特效贴纸', '转场']) {
              await f.page.getByRole('button', { name: tab, exact: true }).click();
              await check(`/video/edit:${tab}`);
            }
          }
        }
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
      const anonymous = await fixture(browser, width, true, touch, false);
      try {
        for (const path of ['/login?mode=login', '/auth/reset', '/landing']) {
          await anonymous.page.goto(`${base}${path}`);
          await anonymous.page.locator('button:visible, [data-slot="button"]:visible').first().waitFor();
          const buttons = buttonBaseline ? await measureActionButtons(anonymous.page) : await verifyActionButtons(anonymous.page, touch, path);
          records.push({ width, touch, scope: path, buttons });
        }
        assert.deepEqual(anonymous.errors, []);
      } finally { await anonymous.close(); }
    }
  } finally {
    if (process.env.BUTTON_HEIGHT_EVIDENCE) writeFileSync(process.env.BUTTON_HEIGHT_EVIDENCE, JSON.stringify(records, null, 2));
    await browser.close();
  }
});
