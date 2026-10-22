import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
const ticketId = '33333333-3333-4333-8333-333333333333', teamId = '44444444-4444-4444-8444-444444444444';
const now = new Date().toISOString();
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  let fail = true, conflict = false, ticket = null;
  let tenant = { id: teamId, name: '真实团队', owner_id: owner, ops_version: 1, max_members: 5, state: 'active', daily_credit_budget: 0, active_members: 2, daily_reserved: 10, created_at: now };
  const replies = [], requests = [], receipts = new Map(), entries = [], errors = [];
  const customer = { id: owner, username: '真实客户', email: 'customer@example.com', restricted: false, restriction_version: 0, credit_balance: 20, daily_credit_budget: 0, plan_status: 'active' };
  await context.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {}; try { body = route.request().postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (path.includes('/auth/')) data = session.user;
    else if (path.endsWith('/operations')) {
      if (body.action === 'access') data = { root: true, grants: [], permissions: ['orders:read', 'customers:read', 'tickets:read', 'tickets:write', 'tenants:read', 'tenants:write', 'costs:read', 'costs:write', 'risk:read', 'risk:write'] };
      else if (body.action === 'cost_report') data = { totals: entries.length ? [{ currency: 'USD', amount_minor: entries.reduce((sum, x) => sum + x.amount_minor, 0), entry_count: entries.length }] : [], unrecorded_workloads: entries.length ? 0 : 1, observed_at: now };
      else if (body.action === 'tenant') data = { tenant, items: [{ id: owner, user_id: owner, username: '所有者', role: 'owner', status: 'active', joined_at: now }], total: 1, page: 1, page_size: 25 };
      else if (body.action === 'support' && body.ticket_id) data = { ticket, items: replies, total: replies.length, page: 1, page_size: 25, staff: false };
      else if (body.action === 'support' || body.action === 'list') {
        const items = body.action === 'support' || body.domain === 'tickets' ? ticket ? [ticket] : []
          : body.domain === 'tenants' ? [tenant] : body.domain === 'customers' ? [customer] : body.domain === 'costs' ? entries
            : body.domain === 'cost_missing' && !entries.length ? [{ id: owner, job_type: 'video', kind: 'SeedanceMini', status: 'unknown', created_at: now }] : [];
        data = { items, total: items.length, page: body.page || 1, page_size: 25, observed_at: now };
      } else if (body.action === 'mutate') {
        requests.push(body);
        if (conflict) { status = 409; data = { error: '租户版本已变化，请刷新后重试', outcome: 'rejected' }; }
        else {
          if (!receipts.has(body.request_key)) {
            const p = body.payload;
            if (body.operation === 'ticket_create') {
              ticket = { id: ticketId, user_id: uid, title: p.title, status: 'open', version: 1, category: p.category, due_at: now, updated_at: now };
              replies.push({ id: crypto.randomUUID(), body: p.body, created_at: now });
            } else if (body.operation === 'ticket_reply') { replies.push({ id: crypto.randomUUID(), body: p.body, created_at: now }); ticket.version++; }
            else if (body.operation === 'tenant_update') tenant = { ...tenant, ...p, ops_version: tenant.ops_version + 1 };
            else if (body.operation === 'restriction') { customer.restricted = p.restricted; customer.restriction_version++; }
            else if (body.operation === 'cost_record') entries.push({ id: crypto.randomUUID(), ...p, provider: 'video.SeedanceMini', created_at: now });
            receipts.set(body.request_key, ticket || tenant);
          }
          status = fail ? 503 : 200; data = fail ? { error: '操作受理待确认', outcome: 'unknown' } : receipts.get(body.request_key);
        }
      }
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试账号', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/support');
  await page.getByRole('button', { name: '新建工单', exact: true }).click();
  await page.getByLabel('工单标题', { exact: true }).fill('原供应商任务待核对');
  await page.getByLabel('问题描述', { exact: true }).fill('原任务返回未知，请保留积分与原请求核对。');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('操作受理待确认', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  await page.reload(); fail = false;
  await page.getByRole('button', { name: '按原参数恢复', exact: true }).click();
  await page.getByText('工单申请已保存', { exact: true }).waitFor();
  assert.deepEqual(requests[0], requests[1]); assert.equal(replies.length, 1);
  await page.getByRole('button', { name: '查看工单', exact: true }).click();
  await page.getByText('原任务返回未知，请保留积分与原请求核对。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '回复工单', exact: true }).click();
  await page.getByLabel('回复正文', { exact: true }).fill('补充原任务编号');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(requests.at(-1).payload.expected, 1);
  assert.equal(requests.at(-1).payload.internal, false);
  console.log('PASS 用户工单503后刷新按原UUID恢复，正文只存一次；实际查看和回复绑定原记录版本');

  await page.goto(base + '/operations');
  await page.getByRole('button', { name: '租户管理', exact: true }).click();
  await page.getByRole('button', { name: '调整租户策略', exact: true }).click();
  await page.getByLabel('租户状态', { exact: true }).selectOption('suspended');
  await page.getByLabel('团队日积分预算', { exact: false }).fill('30');
  await page.getByLabel('操作原因', { exact: true }).fill('人工核对暂停');
  fail = true;
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('操作受理待确认', { exact: true }).waitFor();
  const original = requests.at(-1);
  await page.reload(); fail = false;
  await page.getByRole('button', { name: '按原参数恢复', exact: true }).click();
  await page.getByText('运营操作已生效', { exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), original);
  await page.getByRole('button', { name: '租户管理', exact: true }).click();
  await page.getByText('暂停', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看成员', exact: true }).click();
  await page.getByText('有效成员', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '调整租户策略', exact: true }).click();
  await page.getByLabel('操作原因', { exact: true }).fill('过期版本拒绝');
  conflict = true;
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByText('租户版本已变化，请刷新后重试', { exact: true }).waitFor();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(uid => localStorage.getItem(`shopro-operator-request-${uid}`), uid), null);
  conflict = false;
  console.log('PASS 租户暂停/整团队预算原UUID恢复，真实成员入口，版本拒绝清理申请并允许刷新重填');

  await page.getByRole('button', { name: '客户与预算', exact: true }).click();
  await page.getByRole('button', { name: '限制新计费任务', exact: true }).click();
  await page.getByLabel('操作原因', { exact: true }).fill('风险核对暂停新计费');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByRole('button', { name: '解除任务限制', exact: true }).waitFor();
  assert.equal(requests.at(-1).payload.restricted, true);
  await page.getByRole('button', { name: '待核对现金用量', exact: true }).click();
  await page.getByRole('button', { name: '核对原调用成本', exact: true }).click();
  await page.getByLabel('账单现金金额', { exact: true }).fill('1.23');
  await page.getByLabel('账单币种', { exact: true }).selectOption('USD');
  await page.getByLabel('账单编号', { exact: false }).fill('supplier/account/invoice-2026');
  await page.getByLabel('账单行号', { exact: true }).fill('1');
  const evidence = Buffer.from('actual local test invoice 1.23 USD');
  await page.getByLabel('凭证文件', { exact: false }).setInputFiles({ name: 'invoice.txt', mimeType: 'text/plain', buffer: evidence });
  await page.getByLabel('操作原因', { exact: true }).fill('核对原供应商账单');
  await page.getByRole('button', { name: '确认并提交', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(requests.at(-1).payload.job_id, owner);
  assert.equal(requests.at(-1).payload.amount_minor, 123);
  assert.equal(requests.at(-1).payload.evidence_sha256, createHash('sha256').update(evidence).digest('hex'));
  await page.getByRole('button', { name: '供应商现金成本', exact: true }).click();
  await page.getByText('USD 1.23 · 1 笔账单与冲销', { exact: true }).waitFor();
  await page.getByRole('cell', { name: 'supplier/account/invoice-2026', exact: true }).waitFor();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/operations-workflows-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS 风控限制实际布尔参数，待核对原调用/真实文件指纹/分币种1.23入账，390px无页面溢出或运行错误');
} finally { await browser.close(); }
