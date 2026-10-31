/** 干净检出浏览器门禁：真实界面 + 隔离内存后端，不使用真实登录或部署凭据。 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.port !== '5197'
  || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('浏览器验收只允许隔离本地服务http://127.0.0.1:5197');
}
const env = { ...process.env, VITE_SUPABASE_URL: 'https://ui-fixture.example',
  VITE_SUPABASE_ANON_KEY: 'fixture', VITE_TERMS_URL: 'https://legal-fixture.example/terms',
  VITE_PRIVACY_URL: 'https://legal-fixture.example/privacy', UI_TEST_URL: base };
const suites = [
  'tests/browser_model_settings.mjs', 'tests/browser_platform_settings.mjs',
  'tests/browser_editor_state.mjs', 'tests/browser_editor_assets.mjs', 'tests/browser_edit_analysis.mjs',
  'tests/browser_image_editing.mjs', 'tests/browser_account_credits.mjs',
  'tests/browser_storyboard_style.mjs',
  'tests/browser_script_notices.mjs',
  'tests/browser_catalog_layout.mjs',
  'tests/browser_page_headers.mjs',
];
let server;
try {
  if (process.env.UI_TEST_EXTERNAL_SERVER !== '1') {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ui-tests.mjs',
      '--host', url.hostname, '--port', '5197', '--strictPort'], { env, stdio: 'inherit' });
    server.on('error', error => { console.error(error.message); });
  }
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) throw new Error('隔离UI服务启动失败');
    try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('隔离UI服务不可达');
  // 读取Vite真实环境，拒绝误连原后端的已有开发服务。
  const settings = await (await fetch(`${base}/src/lib/backendConfig.ts`)).text();
  if (!settings.includes('https://ui-fixture.example')) throw new Error('UI服务未使用隔离后端，拒绝测试');
  const legal = await (await fetch(`${base}/src/components/auth/LegalConsent.tsx`)).text();
  if (!legal.includes('https://legal-fixture.example/terms') || !legal.includes('https://legal-fixture.example/privacy')) {
    throw new Error('UI服务未配置隔离协议资源，拒绝测试');
  }
  for (const suite of suites) {
    console.log(`Browser flow: ${suite}`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [suite], { env, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', resolve);
    });
    if (code !== 0) throw new Error(`${suite}未通过（${code}）`);
  }
} finally {
  if (server && server.exitCode === null) server.kill('SIGTERM');
}
