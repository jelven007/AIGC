import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditSnapshot } from './browser_credit_fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const session = {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {} },
};
const date = '2026-10-31T00:00:00Z';
const plan = { id: planId, name: '创作套餐', level: 1, price: '20.00', credits: 100, features: [], limits: {}, is_popular: false };
const log = (id, action) => ({
  id, user_id: uid, type: 'purchase', action, amount: 100, credits_after: 100,
  created_at: date, description: action === 'plan_purchase' ? '实际套餐入账' : '实际加油包入账',
});
async function fixture(options = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const state = { catalog: [{ ...plan }], logs: [log('plan-log', 'plan_purchase'), log('booster-log', 'booster_purchase')],
    failCatalog: false, catalogReads: 0, creditReads: 0, queries: [], ...options };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(session => {
    window.__SHOPRO_RUNTIME__ = { backendUrl: 'https://ui-fixture.example', backendAnonKey: 'fixture' };
    localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(session));
  }, session);
  await context.route('https://ui-fixture.example/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data = [], status = 200, count = 0;
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/profiles')) data = { id: uid, username: '视频创作者', role: 'user' };
    else if (path.endsWith('/rpc/get_my_credits')) {
      state.creditReads++;
      data = creditSnapshot(uid, { plan_name: '创作套餐' });
    } else if (path.endsWith('/plans')) {
      state.catalogReads++;
      if (state.holdCatalog) await gate;
      status = state.failCatalog ? 400 : 200;
      data = state.failCatalog ? { message: '套餐目录暂不可用' } : state.catalog;
    } else if (path.endsWith('/credit_logs')) {
      state.queries.push(url.searchParams.toString());
      let rows = state.logs;
      for (const field of ['type', 'action']) {
        const filter = url.searchParams.get(field);
        if (filter?.startsWith('eq.')) rows = rows.filter(row => row[field] === filter.slice(3));
      }
      count = rows.length;
      const offset = Number(url.searchParams.get('offset') || 0);
      data = rows.slice(offset, offset + Number(url.searchParams.get('limit') || 10));
    } else if (path.includes('/functions/')) { status = 503; data = { error: '隔离验证未配置该服务' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Content-Range': `0-${Math.max(0, data.length - 1)}/${count}`, 'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } }).catch(() => {});
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, state, errors, close: async () => { release(); await context.close(); await browser.close(); } };
}

test('purchase filters use ledger action and display both real purchase categories', async () => {
  const f = await fixture(), { page } = f;
  try {
    await page.goto(`${base}/credits?tab=logs`);
    await page.getByRole('row').filter({ hasText: '实际套餐入账' }).waitFor();
    const filter = page.getByRole('combobox');
    await filter.click();
    await page.getByRole('option', { name: '套餐开通', exact: true }).click();
    await page.getByText('实际套餐入账', { exact: true }).waitFor();
    assert.equal(await page.getByText('实际加油包入账', { exact: true }).count(), 0);
    assert.match(f.state.queries.at(-1), /action=eq.plan_purchase/);
    await filter.click();
    await page.getByRole('option', { name: '加油包购买', exact: true }).click();
    await page.getByText('实际加油包入账', { exact: true }).waitFor();
    assert.equal(await page.getByText('实际套餐入账', { exact: true }).count(), 0);
    await filter.click();
    await page.getByRole('option', { name: '全部类型', exact: true }).click();
    await page.getByRole('row').filter({ hasText: '实际套餐入账' }).getByText('套餐开通', { exact: true }).waitFor();
    await page.getByRole('row').filter({ hasText: '实际加油包入账' }).getByText('加油包购买', { exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('account overview remains usable while the separate catalog is pending', async () => {
  const f = await fixture({ holdCatalog: true });
  try {
    await f.page.goto(`${base}/credits?tab=overview`);
    await f.page.getByText('当前套餐：创作套餐', { exact: true }).waitFor();
    await f.page.getByText('剩余 1,000 积分', { exact: true }).waitFor();
    assert.ok(f.state.catalogReads > 0 && f.state.creditReads > 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('decimal zero prices render free and internal administrator grants are not sales offers', async () => {
  const f = await fixture({ catalog: [
    { ...plan, id: '33333333-3333-4333-8333-333333333333', name: '免费版', level: 0, price: '0.00', credits: 20 },
    { ...plan, id: '44444444-4444-4444-8444-444444444444', name: '自托管管理员', level: 3, price: '0.00', credits: 1000000 },
  ] });
  try {
    await f.page.goto(`${base}/credits?tab=plans`);
    await f.page.getByText('免费', { exact: true }).waitFor();
    assert.equal(await f.page.getByRole('heading', { name: '自托管管理员', exact: true }).count(), 0);
    await f.page.getByText('暂未配置付费套餐，请联系管理员配置套餐价格与权益。', { exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('refresh re-reads current catalog prices and recovers after a catalog failure', async () => {
  const f = await fixture({ failCatalog: true });
  try {
    await f.page.goto(`${base}/credits?tab=plans`);
    await f.page.getByRole('alert').filter({ hasText: '套餐目录读取失败' }).waitFor();
    f.state.failCatalog = false;
    f.state.catalog[0].price = '35.00';
    await f.page.getByRole('button', { name: '刷新余额与权益', exact: true }).click();
    await f.page.getByRole('button', { name: '选择套餐', exact: true }).click();
    await f.page.getByRole('dialog').getByText('¥35.00', { exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a shortened ledger returns from an empty trailing page without trapping pagination', async () => {
  const f = await fixture({ logs: Array.from({ length: 12 }, (_, i) => ({
    ...log(`log-${i}`, 'plan_purchase'), description: `真实入账 ${i}`,
  })) });
  try {
    await f.page.goto(`${base}/credits?tab=logs`);
    await f.page.getByRole('button', { name: '下一页', exact: true }).click();
    await f.page.getByText('真实入账 11', { exact: true }).waitFor();
    f.state.logs = f.state.logs.slice(0, 10);
    await f.page.evaluate(() => window.dispatchEvent(new Event('credits_changed')));
    await f.page.getByText('真实入账 0', { exact: true }).waitFor();
    await f.page.getByText('第 1 页', { exact: true }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: '下一页', exact: true }).isEnabled(), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
