import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // 专用表单夹具；禁止调用真实Supabase或供应商。
  await context.route('https://**/*', route => route.abort());
  if (process.env.MODEL_SETTINGS_REMOVE_FORM === '1') {
    await context.route('**/src/components/ServiceConfigEditor.tsx*', async route => {
      const response = await route.fetch();
      const script = await response.text();
      assert.ok(script.includes('draft &&'), '反向验证须确实移除编辑表单');
      await route.fulfill({ response, body: script.replace('draft &&', 'false &&') });
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const open = async mode => {
    await page.goto(`${base}/tests/ui/model-settings.html?failure=${mode}`);
    await page.getByRole('heading', { name: '模型接口', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
  };
  await open('offline');
  assert.equal(await page.getByLabel('显示名称').count(), 1, '加载失败后模型编辑表单仍应显示');
  assert.equal(await page.getByRole('button', { name: /主文本模型 未读取/ }).count(), 1);
  await page.getByRole('button', { name: /MiniMax 视频/ }).click();
  await page.getByLabel('显示名称').fill('待恢复的真实配置');
  assert.equal(await page.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), true,
    '无法读取原版本时不能以null覆盖配置');
  assert.equal(await page.getByRole('button', { name: '重试加载', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('显示名称').inputValue(), '待恢复的真实配置');
  console.log('PASS 加载失败仍显示可编辑表单，未知配置状态不伪装关闭，重试不丢输入且不保存未知版本');

  await open('recover');
  await page.getByLabel('显示名称').fill('恢复后保存的配置');
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await page.getByRole('button', { name: '保存配置', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByText('配置已保存，新请求使用新版本', { exact: true }).waitFor();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在加载配置' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('显示名称').inputValue(), '恢复后保存的配置');
  console.log('PASS 后端恢复后能读取原版本、保留草稿并提交服务端保存');

  await open('empty');
  assert.equal(await page.getByLabel('显示名称').inputValue(), '主文本模型');
  await page.getByRole('button', { name: /图片与封面/ }).click();
  assert.equal(await page.getByLabel('完整调用地址').count(), 1);
  console.log('PASS 空配置列表的全部模型槽可首次配置');

  await open('save');
  await page.getByLabel('显示名称').fill('保留待重试输入');
  await page.getByLabel('API Key', { exact: false }).fill('isolated-fixture-key');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('显示名称').inputValue(), '保留待重试输入');
  assert.equal(await page.getByLabel('API Key', { exact: false }).inputValue(), 'isolated-fixture-key');
  assert.equal(await page.getByText('配置已保存，新请求使用新版本', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '保存配置', exact: true }).isEnabled(), true);
  console.log('PASS 保存失败保留配置/密钥并可重试，不显示假成功');
} finally { await browser.close(); }
