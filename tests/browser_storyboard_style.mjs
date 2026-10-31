import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { creditSnapshot } from './browser_credit_fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const legacyIndustry = String.fromCodePoint(0x7535, 0x5546);
const oldBrand = new RegExp(String.fromCharCode(115, 104, 111, 112, 114, 111) + '(?:[\\s_-]*ai)?', 'i');
const promptSeeds = [...readFileSync('supabase/migrations/00023_ai_service_governance.sql', 'utf8')
  .matchAll(/\('([^']+)', 'script', 'douyin',\s*'([^']+)',\s*true, 'generate_script_four_layer', 1, true, '([AB])'\)/g)]
  .map(([, title, content, variant], i) => ({ id: `seed-${i}`, title, content, variant, is_system: true,
    user_id: null, version: 1, action_key: 'generate_script_four_layer', category: 'script', platform: 'douyin',
    variables: [], use_count: 0 }));
const templates = [legacyIndustry, '教育'].map((industry, i) => ({
  id: `template-${i}`, name: i ? '课程讲解模板' : '产品展示模板', industry, scene: i ? '课程推广' : '产品介绍',
  thumbnail: null, preview_video: null, duration: 5, tags: [], use_count: 0, is_active: true,
}));
const session = {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {} },
};
const draft = {
  productName: '无线降噪耳机 Pro', category: '数码电器', priceRange: '', sellingPoints: ['轻巧便携'],
  audience: '音乐爱好者', platform: 'douyin', videoLength: 25, generated: true,
  promptText: '自然光下展示耳机，镜头由全景缓慢推进至细节。',
  scenes: [{ order: 1, scene: '开场特写', visual: '耳机置于桌面，柔和自然光。',
    dialogue: '让音乐陪伴每一次出发。', prompt: 'Close-up in natural light.', duration: 5, layer: 'hook' }],
};
async function fixture(viewport, signedIn = true) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(({ session, uid, draft, signedIn }) => {
    window.__SHOPRO_RUNTIME__ = { backendUrl: 'https://ui-fixture.example', backendAnonKey: 'fixture' };
    if (signedIn && !localStorage.getItem('sb-ui-fixture-auth-token')) localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
    if (!localStorage.getItem(`script-draft-${uid}`)) localStorage.setItem(`script-draft-${uid}`, JSON.stringify(draft));
  }, { session, uid, draft, signedIn });
  await context.route('https://ui-fixture.example/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/profiles')) data = { id: uid, username: '视频创作者', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid);
    else if (path.endsWith('/production-jobs') || path.endsWith('/video-jobs')) data = { jobs: [] };
    else if (path.endsWith('/material-assets')) data = { materials: [], total: 0 };
    else if (path.endsWith('/model-settings')) data = { configs: [] };
    else if (path.endsWith('/batch-video-jobs')) data = { unit_cost: 10, max_items: 50, batches: [] };
    else if (path.endsWith('/product-management')) data = { products: [], total: 0, offset: 0 };
    else if (path.endsWith('/video_templates')) data = templates;
    else if (path.endsWith('/prompt_templates')) data = promptSeeds;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, errors, close: async () => { await context.close(); await browser.close(); } };
}

test('landing, login and legacy template libraries show the video platform identity', async () => {
  const f = await fixture({ width: 390, height: 844 }), page = f.page;
  try {
    await page.goto(`${base}/landing`);
    assert.equal(await page.title(), '视频生成平台');
    await page.getByRole('heading', { name: /让每一个创意\s*成为视频作品/ }).waitFor();
    assert.equal((await page.locator('body').innerText()).includes(legacyIndustry), false);
    assert.equal(oldBrand.test(await page.locator('body').innerText()), false);
    if (process.env.STORYBOARD_SCREENSHOTS) await page.screenshot({
      path: join(process.env.STORYBOARD_SCREENSHOTS, 'video-platform-landing-mobile.png'), fullPage: true,
    });
    const guest = await fixture({ width: 390, height: 844 }, false);
    try {
      await guest.page.goto(`${base}/login?mode=login`);
      await guest.page.getByText('登录视频生成平台，继续你的创作', { exact: true }).waitFor();
      assert.equal((await guest.page.locator('body').innerText()).includes(legacyIndustry), false);
      assert.equal(oldBrand.test(await guest.page.locator('body').innerText()), false);
      assert.deepEqual(guest.errors, []);
    } finally { await guest.close(); }
    for (const route of ['templates', 'avatars']) {
      await page.goto(`${base}/${route}`);
      if (route === 'avatars') await page.getByRole('button', { name: '视频模板库', exact: true }).click();
      await page.getByText('产品展示模板', { exact: true }).first().waitFor();
      await page.getByRole('button', { name: '产品展示', exact: true }).click();
      assert.equal(await page.getByText('课程讲解模板', { exact: true }).count(), 0);
      assert.equal((await page.locator('body').innerText()).includes(legacyIndustry), false);
    }
    await page.goto(`${base}/prompt-templates`);
    await page.getByText('四层视频脚本-A（叙事节奏）', { exact: true }).waitFor();
    await page.getByText('四层视频脚本-B（场景表达）', { exact: true }).waitFor();
    assert.equal((await page.locator('body').innerText()).includes(legacyIndustry), false);
    assert.equal(oldBrand.test(await page.locator('body').innerText()), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

// 读取真实浏览器颜色，逐层合成透明背景；测试已绘制文本而非CSS类名。
async function readable(locator, label, pseudo = null) {
  const colors = await locator.evaluate((element, pseudo) => {
    const rgba = value => {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
      return [...parts.slice(0, 3), parts[3] ?? 1];
    };
    const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) background = over(rgba(getComputedStyle(node).backgroundColor), background);
    const style = getComputedStyle(element, pseudo);
    return { background, foreground: over(rgba(style.color), background), size: style.fontSize };
  }, pseudo);
  const luminance = color => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const a = luminance(colors.foreground), b = luminance(colors.background);
  const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 ${JSON.stringify(colors)}`);
}
for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390], ['dark', 390]]) {
  test(`home storyboard readable controls, keyboard editing and draft restoration: ${theme} ${width}px`, async () => {
    const f = await fixture({ width, height: width === 390 ? 844 : 1000 }), page = f.page;
    try {
      await page.goto(`${base}/home`);
      await page.getByRole('button', { name: '分镜编辑', exact: true }).click();
      const heading = page.getByRole('heading', { name: '分镜与成片工作台', exact: true });
      await heading.waitFor();
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      const name = page.getByPlaceholder('例：无线降噪耳机 Pro');
      await name.waitFor();
      if (process.env.STORYBOARD_SCREENSHOTS) {
        await heading.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.STORYBOARD_SCREENSHOTS, `storyboard-${theme}-${width}-before.png`) });
      }
      await readable(heading, '工作台标题');
      await readable(name, '已填输入');
      await readable(page.getByPlaceholder('输入卖点后按 Enter'), '占位文字', '::placeholder');
      await readable(page.getByRole('button', { name: '素材与作品', exact: true }), '未选中按钮');
      await readable(page.getByRole('button', { name: '分镜脚本', exact: true }), '选中按钮');
      const description = heading.locator('..').locator('p').first();
      await readable(description, '工作台说明');
      const sceneName = page.getByPlaceholder('场景名称');
      await readable(sceneName, '分镜标题');
      // 先定位编辑控件再按Tab，确保真实键盘焦点和编辑值清晰。
      await sceneName.focus();
      await sceneName.press('Tab');
      const focused = page.locator(':focus');
      assert.equal(await focused.evaluate(element => element.tagName), 'BUTTON');
      assert.ok(await focused.evaluate(element => {
        const style = getComputedStyle(element);
        return style.boxShadow !== 'none' || style.outlineStyle !== 'none';
      }), '场景操作应显示键盘焦点');
      await page.getByRole('button', { name: '展开场景 1', exact: true }).click();
      const visual = page.getByPlaceholder('画面描述...');
      await readable(visual, '画面输入');
      await visual.fill('更新后的镜头画面，保持自然光。');
      const category = page.getByRole('combobox').first();
      await readable(category, '分类选择');
      await category.focus(); await category.press('Space');
      await readable(page.getByRole('option', { name: '数码电器', exact: true }), '下拉选项');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '素材与作品', exact: true }).click();
      await page.getByRole('heading', { name: '作品素材', exact: true }).waitFor();
      await readable(page.getByRole('heading', { name: '作品素材', exact: true }), '作品页标题');
      await page.getByRole('button', { name: '分镜脚本', exact: true }).click();
      assert.equal(await visual.inputValue(), '更新后的镜头画面，保持自然光。');
      await page.getByRole('button', { name: '多镜头成片', exact: true }).click();
      await readable(page.getByRole('button', { name: '素材与作品', exact: true }), '跨视图按钮');
      await page.getByRole('button', { name: '分镜脚本', exact: true }).click();
      assert.equal(await visual.inputValue(), '更新后的镜头画面，保持自然光。');
      await page.waitForFunction(uid => JSON.parse(localStorage.getItem(`script-draft-${uid}`))?.scenes[0].visual === '更新后的镜头画面，保持自然光。', uid);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.STORYBOARD_SCREENSHOTS) {
        await heading.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.STORYBOARD_SCREENSHOTS, `storyboard-${theme}-${width}.png`), fullPage: true });
      }
      await page.reload();
      await page.getByRole('button', { name: '分镜编辑', exact: true }).click();
      assert.equal(await page.getByPlaceholder('场景名称').inputValue(), '开场特写');
      await page.getByRole('button', { name: '展开场景 1', exact: true }).click();
      assert.equal(await visual.inputValue(), '更新后的镜头画面，保持自然光。');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
