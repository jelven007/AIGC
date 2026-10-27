import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--disable-breakpad', '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
  const sourceDate = '2026-10-22T00:00:00.000Z';
  const product = { id, user_id: uid, name: '真实杯子', category: '其他', description: '原始商品描述', status: 'draft',
    currency: 'USD', original_price: 12, sale_price: null, stock: null, sales_count: null, selling_points: ['原始卖点'],
    specs: [{ name: '容量', value: '300ml' }], images: [`${backend}/storage/v1/object/authenticated/materials/${uid}/original.png`],
    cover_image: `${backend}/storage/v1/object/authenticated/materials/${uid}/original.png`,
    created_at: sourceDate, updated_at: sourceDate };
  const submissions = [], errors = [];
  let translations = [], targets = [], analysisJobs = [], failTranslation = true, failImageSave = true, failPreference = true;
  let prefs = { task_success: true, intelligence_success: true }, notificationClock = Date.now();
  let notifications = Array.from({ length: 27 }, (_, index) => ({
    id: `notif-${index}`, category: index < 20 ? 'jobs' : 'intelligence', level: index === 0 ? 'warning' : 'success',
    title: index === 0 ? '原任务待核对' : `任务结果${index}`, body: '真实任务结果，请核对详情。',
    action_path: '/task-queue', source_id: id, created_at: new Date(notificationClock - index * 1000).toISOString(),
    read_at: index < 3 ? null : sourceDate,
  }));
  await context.route(`${backend}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body = {}; try { body = req.postDataJSON() || {}; } catch {}
    let data = [], status = 200;
    if (req.method() === 'OPTIONS') data = {};
    else if (path.includes('/auth/')) data = session.user;
    else if (path.includes('/storage/v1/object/sign/')) data = { signedURL: path.replace('/storage/v1', '') + '?token=ephemeral' };
    else if (path.includes('/storage/v1/object/authenticated/')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: png }); return;
    } else if (path.includes('/storage/v1/object/')) data = { Key: path.split('/object/')[1], Id: id };
    else if (path.endsWith('/read_notifications')) {
      const filtered = notifications.filter(item => body.p_category === 'all' || item.category === body.p_category);
      data = { items: filtered.slice(body.p_offset, body.p_offset + body.p_limit), total: filtered.length,
        unread: filtered.filter(item => !item.read_at).length, unread_all: notifications.filter(item => !item.read_at).length,
        cutoff: new Date(notificationClock).toISOString(), preferences: prefs };
    } else if (path.endsWith('/mutate_notifications')) {
      submissions.push(body);
      if (body.p_action === 'preferences' && failPreference) { status = 503; data = { message: '通知偏好保存失败' }; }
      else {
        if (body.p_action === 'read_all') {
          notificationClock += 1000;
          notifications.unshift({ ...notifications[0], id: 'new-arrival', title: '新到任务结果', level: 'success', created_at: new Date(notificationClock).toISOString() });
          notifications = notifications.map(item => !item.read_at && item.created_at <= body.p_cutoff ? { ...item, read_at: sourceDate } : item);
        } else if (body.p_action === 'read') notifications = notifications.map(item => body.p_ids.includes(item.id) ? { ...item, read_at: sourceDate } : item);
        else if (body.p_action === 'delete') notifications = notifications.filter(item => !body.p_ids.includes(item.id));
        else if (body.p_action === 'clear_read') notifications = notifications.filter(item => !item.read_at || item.created_at > body.p_cutoff);
        else if (body.p_action === 'preferences') prefs = body.p_preferences;
        data = { updated: 1 };
      }
    } else if (path.endsWith('/product-management')) {
      if (body.action === 'list') data = { products: [product], total: 1 };
      else if (body.action === 'translations') data = { jobs: translations, cost: 2 };
      else if (body.action === 'translate') {
        submissions.push(body);
        if (!translations.length) translations = [{ id, product_id: product.id, kind: 'product_translate', request_key: body.request_key,
          status: 'pending', created_at: sourceDate, result: null, credit_cost: 2 }];
        status = failTranslation ? 503 : 202;
        data = failTranslation ? { error: '翻译回执待确认', outcome: 'unknown' } : { job: translations[0] };
      } else if (body.action === 'save') {
        submissions.push(body); status = 409; data = { error: '商品已被更新，请刷新后重试', outcome: 'rejected' };
      }
    } else if (path.endsWith('/market-intelligence')) {
      if (body.action === 'catalog') data = { targets: body.kind === 'intelligence_products' ? targets : [{
        id, kind: 'intelligence_competitor', name: '真实频道', params: { account_id: '@real' }, source_slot: 'intelligence.youtube',
        history: [], latest: { job_id: id, collected_at: sourceDate, data: { source: { name: 'YouTube', observed_at: sourceDate,
          version_id: id, definition: '官方统计' }, items: [{ id: 'real-video', title: '真实竞品标题', url: 'https://youtube.com/watch?v=real' }] } },
      }], jobs: [], sources: [{ slot: 'intelligence.ebay', enabled: true }, { slot: 'intelligence.youtube', enabled: true }],
        prices: { intelligence_products: 2, intelligence_competitor: 2 } };
      else if (body.action === 'save_target') {
        submissions.push(body); targets = [{ id, name: body.name, kind: body.kind, params: body.params, source_slot: body.source_slot, history: [], latest: null }];
        status = failImageSave ? 503 : 201; data = failImageSave ? { error: '图片对象回执待确认' } : { target: targets[0] };
      }
    } else if (path.endsWith('/production-jobs')) {
      if (body.action === 'analysis-price') data = { cost: 2 };
      else if (body.action === 'list') data = { jobs: [...analysisJobs, ...translations].filter(job => !body.kinds || body.kinds.includes(job.kind)) };
      else if (body.action === 'create') {
        submissions.push(body); analysisJobs = [{ id, kind: 'analysis', mode: 'style', status: 'completed', created_at: sourceDate, credit_cost: 2,
          result: { competitor_reference: { sample_id: id, item: { id: 'real-video', title: '真实竞品标题', url: 'https://youtube.com/watch?v=real' },
            source: { name: 'YouTube', version_id: id, observed_at: sourceDate }, relationship: '用户关联的统计参考；未验证上传素材与原平台视频为同一作品' } } }];
        data = { job: analysisJobs[0] };
      }
    } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试用户', invite_code: 'TEST' };
    else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/products');
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('ja');
  await page.getByRole('checkbox', { name: '识别并翻译主图文字', exact: true }).check();
  const firstTranslation = page.waitForResponse(res => res.url().endsWith('/product-management') && res.request().postDataJSON()?.action === 'translate');
  await page.getByRole('button', { name: '确认翻译 · 2积分', exact: true }).click();
  await firstTranslation;
  await page.getByRole('button', { name: '恢复原翻译请求', exact: true }).waitFor();
  await page.reload(); failTranslation = false;
  await page.getByRole('button', { name: '翻译记录', exact: true }).click();
  const recoveredTranslation = page.waitForResponse(res => res.url().endsWith('/product-management') && res.request().postDataJSON()?.action === 'translate');
  await page.getByRole('button', { name: '恢复原翻译请求', exact: true }).click();
  await recoveredTranslation;
  await page.getByRole('button', { name: '恢复原翻译请求', exact: true }).waitFor({ state: 'detached' });
  const translated = submissions.filter(item => item.action === 'translate');
  assert.deepEqual(translated[0], translated[1]); assert.equal(translated[0].input.expected_updated_at, sourceDate);
  assert.equal(translated[0].input.include_image, true); assert.equal(translated[0].input.target_language, 'ja');
  translations[0] = { ...translations[0], status: 'completed', result: { product_id: id, source_updated_at: sourceDate,
    source_hash: 'a'.repeat(64), target_language: 'ja', version_id: id, image_hash: 'b'.repeat(64), created_at: sourceDate,
    image_note: '只输出文字对照', translation: { name: '本物のカップ', description: '商品説明', selling_points: ['原文の翻訳'], specs: [{ name: '容量', value: '300ml' }] },
    image_text: [{ original: '原图文字', translated: '画像の文字' }] } };
  await page.getByRole('button', { name: '刷新翻译记录', exact: true }).click();
  await page.getByText('本物のカップ', { exact: true }).waitFor();
  assert.equal(product.name, '真实杯子');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出译文JSON', exact: true }).click();
  const download = await downloadPromise; assert.ok(download.suggestedFilename().endsWith('.json'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByText('翻译任务已提交，关闭后可从翻译记录或任务中心查看', { exact: true }).waitFor({ state: 'hidden' });
  const bounds = await page.getByRole('dialog').boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
  await page.screenshot({ path: '.volcengine-build/translation-mobile.png' });
  await page.getByRole('button', { name: '带入商品编辑', exact: true }).click();
  assert.equal(await page.getByLabel('商品名称', { exact: true }).inputValue(), '本物のカップ');
  assert.equal(await page.getByLabel('原价', { exact: true }).inputValue(), '12');
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '商品已被更新' }).first().waitFor();
  assert.equal(submissions.find(item => item.action === 'save').items[0].expected_updated_at, sourceDate);
  await page.goto(base + '/products?translationJob=' + id);
  await page.getByRole('dialog').getByText('本物のカップ', { exact: true }).waitFor();
  console.log('PASS 翻译503刷新同UUID/原语言/主图/版本恢复、真实结果/JSON导出、不自动覆盖、编辑保存版本冲突');

  await page.goto(base + '/product-selection');
  await page.getByLabel('选品方式', { exact: true }).selectOption('image');
  await page.getByLabel('上传选品参考图', { exact: true }).setInputFiles({ name: 'private.png', mimeType: 'image/png', buffer: png });
  await page.getByText('private.png · 上传完成', { exact: true }).waitFor();
  const firstImage = page.waitForResponse(res => res.url().endsWith('/market-intelligence') && res.request().postDataJSON()?.action === 'save_target');
  await page.getByRole('button', { name: '保存情报对象', exact: true }).click();
  await firstImage;
  await page.getByRole('button', { name: '恢复原情报请求', exact: true }).waitFor();
  await page.reload(); failImageSave = false;
  const recoveredImage = page.waitForResponse(res => res.url().endsWith('/market-intelligence') && res.request().postDataJSON()?.action === 'save_target');
  await page.getByRole('button', { name: '恢复原情报请求', exact: true }).click();
  await recoveredImage;
  await page.getByRole('button', { name: '恢复原情报请求', exact: true }).waitFor({ state: 'detached' });
  const images = submissions.filter(item => item.action === 'save_target');
  assert.deepEqual(images[0], images[1]); assert.equal(images[0].params.image_hash, createHash('sha256').update(png).digest('hex'));
  assert.ok(images[0].params.image_url.includes('/object/authenticated/materials/' + uid + '/'));
  assert.ok(!images[0].params.image_url.includes('token=')); assert.equal(images[0].params.search_mode, 'image');
  await page.getByText(/原图SHA-256/).waitFor();
  console.log('PASS 私有图片上传/魔数校验/SHA-256/稳定对象地址，图片响应丢失刷新原参数恢复');

  await page.goto(base + '/competitor');
  await page.getByRole('button', { name: '上传素材分析风格', exact: true }).click();
  await page.getByText('已关联竞品统计参考：真实竞品标题', { exact: true }).waitFor();
  await page.getByLabel('上传分析视频', { exact: true }).setInputFiles({ name: 'owned.mp4', mimeType: 'video/mp4', buffer: Buffer.from('local-test-video') });
  await page.getByText('已上传：owned.mp4', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '提交视频风格分析任务', exact: true }).isEnabled(), false);
  await page.getByRole('checkbox', { name: '我确认拥有上传素材的使用权', exact: true }).check();
  await page.getByRole('button', { name: '提交视频风格分析任务', exact: true }).click();
  await page.getByText('用户关联的统计参考；未验证上传素材与原平台视频为同一作品', { exact: true }).waitFor();
  assert.deepEqual(submissions.find(item => item.action === 'create').input.competitor_reference,
    { sample_id: id, item_id: 'real-video', rights_confirmed: true });
  console.log('PASS 竞品入口/真实引用ID、上传使用权确认必填、服务端原统计及未验证关系说明');

  await page.goto(base + '/notifications');
  await page.getByText('当前分类27条 · 3条未读', { exact: true }).waitFor();
  await page.screenshot({ path: '.volcengine-build/notifications-populated-mobile.png' });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('任务结果26', { exact: true }).waitFor();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByRole('button', { name: '全部标记已读', exact: true }).click();
  await page.getByText('当前分类28条 · 1条未读', { exact: true }).waitFor();
  await page.getByRole('button', { name: '消息通知，1条未读', exact: true }).waitFor();
  const setting = page.getByRole('checkbox', { name: '接收情报采集成功通知', exact: true });
  await setting.click();
  await page.getByRole('alert').filter({ hasText: '通知偏好保存失败' }).waitFor();
  assert.equal(await setting.isChecked(), true);
  failPreference = false; await setting.click();
  await page.waitForFunction(() => [...document.querySelectorAll('label')].find(label => label.textContent.includes('接收情报采集成功通知'))?.querySelector('input')?.checked === false);
  assert.equal(prefs.intelligence_success, false);
  await page.getByRole('button', { name: '删除通知 新到任务结果', exact: true }).click();
  await page.getByRole('button', { name: '消息通知，0条未读', exact: true }).waitFor();
  await page.getByRole('button', { name: '清除已读', exact: true }).click();
  await page.getByText('暂无通知', { exact: true }).waitFor();
  assert.equal(notifications.length, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/notifications-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS 真实通知分页、列表与铃铛同步、read_all保护新消息、偏好失败不伪成功/恢复、删除/清已读/390px空态');
} finally { await browser.close(); }
