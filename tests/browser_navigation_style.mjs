/** Real navigation and rendered style regression; credentials come from a private file. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const styleRoutes = [
  '/ai-toolbox', '/product-selection', '/products', '/avatars',
  '/works', '/export-formats', '/data-feedback', '/team', '/open-api',
  '/settings/models', '/settings/integrations', '/operations', '/support',
  '/knowledge', '/script', '/style-copy', '/live-highlight', '/emotion-analysis',
  '/competitor', '/analytics', '/prompt-templates', '/templates', '/materials',
  '/multilang', '/batch-create', '/task-queue', '/notifications', '/profile',
  '/credits', '/invite', '/activities', '/ab-test', '/llm-cache',
  '/personalize', '/trending-patterns', '/publish', '/data-dashboard',
];

export async function verifyNavigationStyle(browser, base, identity, options = {}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], failedResponses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400)
        failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    try {
      await page.goto(`${base}/login?mode=login`);
      await page.getByPlaceholder('请输入用户名或邮箱').fill(identity.username);
      await page.getByPlaceholder('请输入密码').fill(identity.password);
      await page.getByRole('button', { name: /^登\s*录$/, exact: true }).click();
      await page.waitForURL(url => ['/', '/landing', '/video/create'].includes(url.pathname));
      await page.goto(`${base}/products`);
      await page.getByRole('heading', { name: '商品管理', exact: true }).waitFor();
      const sidebar = async () => {
        if (width >= 1024) return page.locator('aside.app-sidebar');
        await page.getByRole('button', { name: '打开导航菜单' }).click();
        return page.getByRole('dialog', { name: '导航菜单' });
      };
      let nav = await sidebar();
      // Click the visible primary label, including the old broken button implementation.
      await nav.getByText('AI工具箱', { exact: true }).click();
      await page.waitForURL('**/ai-toolbox', { timeout: 3000 });
      await page.getByRole('heading', { name: 'AI工具箱', exact: true }).waitFor();
      if (width < 1024) await nav.waitFor({ state: 'hidden' });
      else assert.equal(await nav.getByRole('link', { name: 'AI工具箱', exact: true }).getAttribute('aria-current'), 'page');

      await page.goto(`${base}/products`);
      await page.getByRole('heading', { name: '商品管理', exact: true }).waitFor();
      nav = await sidebar();
      const toggle = nav.getByRole('button', { name: /AI工具箱子菜单/ });
      await toggle.click();
      assert.equal(new URL(page.url()).pathname, '/products', 'Expanding tools must preserve the current page');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await nav.getByRole('link', { name: '视频分镜脚本', exact: true }).waitFor();
      const geometry = await nav.evaluate(node => ({
        width: node.getBoundingClientRect().width,
        labels: [...node.querySelectorAll('.app-nav-label')].map(label => ({
          text: label.textContent, width: label.getBoundingClientRect().width,
          overflow: label.scrollWidth > label.clientWidth,
        })),
      }));
      assert.equal(geometry.width, 168);
      assert.ok(geometry.labels.every(label => !label.overflow));
      assert.equal(await nav.getByText('查看全部工具', { exact: true }).count(), 0);
      await toggle.press('Space');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      const link = nav.getByRole('link', { name: 'AI工具箱', exact: true });
      await link.focus();
      await link.press('Enter');
      await page.waitForURL('**/ai-toolbox');
      if (width < 1024) await nav.waitFor({ state: 'hidden' });

      // Tool entries retain their meaningful icons, and filtering still works.
      const main = page.locator('main');
      await main.getByRole('button', { name: '内容创作', exact: true }).click();
      assert.equal(await main.getByRole('link', { name: /提示词知识库/ }).count(), 0);
      await main.getByRole('button', { name: '全部', exact: true }).click();
      await main.getByPlaceholder('搜索工具…').fill('视频分镜脚本');
      assert.equal(await main.getByRole('link').count(), 1);
      await main.getByRole('link', { name: /视频分镜脚本/ }).click();
      await page.waitForURL('**/script');
      await page.getByRole('heading', { name: '视频分镜脚本', exact: true }).waitFor();

      const workspaceSmoke = [];
      for (const [path, layout] of [['/video/create', 'workspace'], ['/video/edit', 'editor']]) {
        await page.goto(base + path);
        await page.locator(`main[data-layout="${layout}"]`).waitFor();
        await page.waitForLoadState('networkidle');
        assert.equal(new URL(page.url()).pathname, path);
        const render = await page.locator('main').evaluate(main => ({
          layout: main.dataset.layout, width: main.getBoundingClientRect().width,
          headingIcons: main.querySelectorAll('h1 svg,h2 svg,h3 svg,h4 svg').length,
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
        }));
        assert.equal(render.headingIcons, 0, `${path}: heading icon`);
        assert.equal(render.overflow, false, `${path}: viewport overflow`);
        workspaceSmoke.push({ path, ...render });
      }

      const inspected = [], styleProblems = [];
      if (!options.navigationOnly) {
        // The product currently locks its UI to dark mode.
        for (const theme of ['dark']) {
          for (const path of options.routes || styleRoutes) {
            await page.goto(base + path);
            await page.locator('main').waitFor();
            await page.waitForLoadState('networkidle');
            assert.equal(new URL(page.url()).pathname, path, `Route missing: ${path}`);
            const rendered = await page.locator('main').evaluate(main => ({
              headings: [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(node => {
                const css = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                // Catch a separate decorative icon block immediately next to the heading.
                const beside = [node.previousElementSibling, node.parentElement?.previousElementSibling]
                  .filter(Boolean).filter(sibling => !sibling.matches('a,button,[role="button"]')
                    && !sibling.querySelector('a,button,[role="button"]')
                    && !sibling.textContent.trim() && sibling.querySelector('svg')).length;
                return { tag: node.tagName, text: node.textContent.trim(), icons: node.querySelectorAll('svg').length,
                  beside, font: css.fontSize, weight: css.fontWeight, height: rect.height,
                  visible: rect.width > 0 && rect.height > 0 };
              }),
              overflow: document.documentElement.scrollWidth > innerWidth + 2,
              layout: main.dataset.layout,
              theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
            }));
            assert.equal(rendered.theme, theme);
            if (rendered.headings.some(node => node.icons || node.beside)) styleProblems.push(`${path}: title icons remain`);
            if (rendered.overflow) styleProblems.push(`${path}: horizontal overflow`);
            for (const heading of rendered.headings.filter(node => node.tag === 'H1' && node.visible)) {
              if (heading.font !== '24px') styleProblems.push(`${path}: primary title size ${heading.font}`);
              if (heading.weight !== '600') styleProblems.push(`${path}: primary title weight ${heading.weight}`);
            }
            inspected.push({ path, theme, ...rendered });
            if (options.evidenceDir && ['/ai-toolbox', '/products', '/script', '/operations', '/profile'].includes(path)) {
              await page.screenshot({ path: `${options.evidenceDir}/style-${options.environment || 'test'}-${width}-${theme}-${path.slice(1)}.png`,
                mask: [page.locator('header'), page.locator('input[type="email"]')], maskColor: '#24232e' });
            }
          }
        }
      }
      if (options.evidenceDir && !options.navigationOnly) writeFileSync(
        `${options.evidenceDir}/style-inspection-${options.environment || 'development'}-${width}.json`,
        JSON.stringify({ inspected, styleProblems }, null, 2));
      assert.deepEqual(styleProblems, [], styleProblems.join('\n'));
      assert.deepEqual(errors, []);
      assert.deepEqual(failedResponses, []);
      results.push({ width, directNavigation: true, mobileDrawerCloses: width < 1024,
        independentToggle: true, keyboardNavigation: true, toolSearch: true,
        geometry, inspected, workspaceSmoke, pageErrors: 0, failedResponses: 0 });
      console.log(`PASS ${options.environment || 'test'} ${width}px: direct navigation, keyboard, tool filtering; ${inspected.length} page/theme checks`);
    } finally {
      await context.close();
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(process.env.UI_ADMIN_FILE, 'Set UI_ADMIN_FILE to a private credential file before running live UI verification');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const results = await verifyNavigationStyle(browser, process.env.UI_TEST_URL || 'http://127.0.0.1:5173',
      JSON.parse(readFileSync(process.env.UI_ADMIN_FILE, 'utf8')), {
        navigationOnly: process.env.NAVIGATION_ONLY === '1', evidenceDir: process.env.UI_EVIDENCE_DIR,
        ...(process.env.UI_ROUTES ? { routes: process.env.UI_ROUTES.split(',') } : {}),
      });
    if (process.env.UI_RESULT_FILE) writeFileSync(process.env.UI_RESULT_FILE, JSON.stringify({ passed: true, results }, null, 2));
  } finally {
    await browser.close();
  }
}
