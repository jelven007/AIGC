import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', second = '33333333-3333-4333-8333-333333333333', source = '44444444-4444-4444-8444-444444444444';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const natural = [{ id: source, project_id: project, title: '正式商品作品', platform: 'douyin', video_id: 'official-id', view_count: 321,
  like_count: 0, comment_count: null, share_count: 2, collected_at: new Date().toISOString(), published_at: new Date().toISOString() }];
const report = { project_count: 2, completed_count: 2, natural_count: 1, projects: [{ id: project, title: '正式商品作品', status: 'completed' }],
  natural, natural_totals: Object.fromEntries(['view_count', 'like_count', 'comment_count', 'share_count'].map(field => [field,
    { value: natural[0][field], observed: natural[0][field] === null ? 0 : 1, total: 1 }])),
  delivery: [{ source_id: source, source_name: '真实授权采集', currency: 'CNY', impressions: 1000, clicks: 100, conversions: 10, spend_minor: 5000,
    gmv_minor: 15000, refunds_minor: 1000, net_revenue_minor: 14000, ctr: .1, cvr: .1, roas: 2.8, cpa_minor: 500, profit_roi: null,
    buckets: 1, since: '2026-10-01', until: '2026-10-21', received_at: new Date().toISOString() }],
  creation_trend: [{ day: '2026-10-21', created: 2, completed: 2 }], style_distribution: [], duration_distribution: [],
  sync_issues: [], generated_at: new Date().toISOString() };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', acceptDownloads: true });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const submissions = [], experiments = [], errors = [];
  let failReport = false, failCreate = true, adviceCalls = 0;
  await context.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = {}; try { body = request.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (request.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/measurements')) {
      if (body.action === 'report') { status = failReport ? 503 : 200; data = failReport ? { error: '真实观测暂不可用' } : { report }; }
      else if (body.action === 'projects') data = { projects: [{ id: project, title: '正式商品作品', status: 'completed' }, { id: second, title: '新文案作品', status: 'completed' }] };
      else if (body.action === 'advice-price') data = { cost: 10 };
      else if (body.action === 'experiments') data = { experiments };
      else if (body.action === 'sources') data = { sources: [{ id: source, name: '真实授权采集', enabled: true, authorization_reference: '真实供应商授权编号' }], admin: false };
      else if (body.action === 'experiment-create') {
        submissions.push(body.specification);
        let exp = experiments.find(e => e.request_key === body.specification.request_key);
        if (!exp) { exp = { ...body.specification, id: crypto.randomUUID(), status: 'draft', inference_reason: '实验尚未结案，结果只供观察',
          variants: body.specification.variants.map((v, i) => ({ ...v, id: crypto.randomUUID(), label: i ? 'B' : 'A', assigned: 0, impressions: 0, clicks: 0, conversions: 0,
            ctr: null, cvr: null, interval: null, uplift: null, adjusted_p_value: null, recommended: false })) }; experiments.unshift(exp); }
        status = failCreate ? 503 : 201; data = failCreate ? { error: '实验创建响应待确认' } : { experiment: exp };
      } else if (body.action === 'experiment-start') { experiments[0].status = 'running'; data = { experiment: experiments[0] }; }
      else if (body.action === 'experiment-close') { status = 409; data = { error: '需等待窗口结束及24小时回流' }; }
      else throw new Error('Unexpected measurement action ' + body.action);
    } else if (path.includes('/ai-assistant')) { adviceCalls++; status = 503; data = { code: 1, message: '真实模型暂不可用' }; }
    else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/data-feedback', '/analytics', '/data-dashboard']) {
    await page.goto(base + path);
    await page.getByText('2.80倍', { exact: true }).waitFor();
    const text = await page.locator('main').innerText();
    assert.ok(text.includes('321')); assert.ok(text.includes('10.00%'));
    assert.ok(!text.includes('+18.4%')); assert.ok(!text.includes('行业均值')); assert.ok(!text.includes('优化闭环完成'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadEvent, bytes = await readFile(await download.path());
  await writeFile('.volcengine-build/measurement-browser.xlsx', bytes);
  const workbook = JSON.parse(execFileSync('python3', ['tests/xlsx_reader.py'], { input: bytes }));
  const [columns, values] = workbook['授权投放与交易'];
  assert.equal(values[columns.indexOf('CVR')], .1);
  assert.equal(values[columns.indexOf('ROAS')], 2.8);
  failReport = true; await page.getByRole('button', { name: '刷新报告', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '真实观测暂不可用' }).waitFor();
  assert.equal(await page.getByText('2.80倍', { exact: true }).count(), 0);
  failReport = false;
  await page.goto(`${base}/analytics?projectId=${project}`);
  await page.getByLabel('创意背景', { exact: true }).fill('保持真实商品事实，调整开场文案。');
  await page.getByRole('button', { name: '生成创意建议 · 10积分', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '真实模型暂不可用' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '带入剪辑', exact: true }).count(), 0);
  assert.equal(adviceCalls, 1);
  console.log('PASS 三看板同口径、390px布局、Excel真实CTR/CVR/ROAS、失败无伪造结果且不自动扣费');
  await page.goto(`${base}/ab-test`);
  await page.getByLabel('实验名称', { exact: true }).fill('真实分流实验');
  await page.getByLabel('授权数据源', { exact: true }).selectOption(source);
  await page.getByLabel('投放结束时间', { exact: true }).fill('2026-11-01T12:00');
  await page.getByLabel('变体A作品', { exact: true }).selectOption(project);
  await page.getByLabel('变体B作品', { exact: true }).selectOption(second);
  const created = page.waitForResponse(response => response.url().endsWith('/measurements')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'experiment-create');
  await page.getByRole('button', { name: '创建实验草稿', exact: true }).click();
  await created;
  await page.getByRole('alert').filter({ hasText: '实验创建响应待确认' }).waitFor();
  await page.getByRole('button', { name: '恢复原实验请求', exact: true }).waitFor();
  await page.reload(); failCreate = false;
  const restored = page.waitForResponse(response => response.url().endsWith('/measurements')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'experiment-create');
  await page.getByRole('button', { name: '恢复原实验请求', exact: true }).click();
  await restored;
  await page.getByRole('button', { name: '恢复原实验请求', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '启动实验', exact: true }).waitFor();
  assert.deepEqual(submissions[0], submissions[1]);
  assert.equal(experiments.length, 1);
  await page.getByRole('button', { name: '启动实验', exact: true }).click();
  await page.getByRole('button', { name: '结案并分析', exact: true }).waitFor();
  await page.getByRole('button', { name: '结案并分析', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '需等待窗口结束及24小时回流' }).waitFor();
  assert.equal(await page.getByText('观察到显著改善', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('签名密钥', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/measurement-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS 实验503后刷新原UUID恢复、启动、提前结案拒绝、零样本无结论、普通用户无密钥配置');
} finally { await browser.close(); }
