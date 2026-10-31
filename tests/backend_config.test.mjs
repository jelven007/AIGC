import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('apps/web/src/lib/backendConfig.ts', 'utf8');
let instance = 0;
async function config(env, runtime) {
  const code = source
    .replaceAll('import.meta.env', JSON.stringify({
      VITE_SUPABASE_URL: 'https://backend.example.com',
      VITE_SUPABASE_ANON_KEY: 'public-fixture',
      ...env,
    }))
    .replace("typeof window === 'undefined' ? undefined : window.__SHOPRO_RUNTIME__",
      JSON.stringify(runtime) ?? 'undefined');
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${instance++}`);
}

test('开发入口明确配置用户名能力时，使用真实服务端用户名登录', async () => {
  const actual = await config({ VITE_USERNAME_LOGIN: 'true' });
  assert.equal(actual.usernameLoginEnabled, true);
  assert.equal(actual.edgeFunctionUrl('username-login'),
    'https://backend.example.com/functions/v1/username-login');
});

test('未配置、关闭或非布尔字符串不会启用用户名登录', async () => {
  for (const flag of [undefined, 'false', '1', 'TRUE']) {
    assert.equal((await config({ VITE_USERNAME_LOGIN: flag })).usernameLoginEnabled, false);
  }
});

test('已有部署运行配置优先于开发环境能力标志', async () => {
  const selfHosted = await config({ VITE_USERNAME_LOGIN: 'false' }, {
    deployment: 'self-hosted', usernameLogin: true,
  });
  assert.equal(selfHosted.usernameLoginEnabled, true);
  const disabled = await config({ VITE_USERNAME_LOGIN: 'true' }, {
    deployment: 'self-hosted', usernameLogin: false,
  });
  assert.equal(disabled.usernameLoginEnabled, false);
  const hosted = await config({ VITE_USERNAME_LOGIN: 'true' }, { deployment: 'hosted' });
  assert.equal(hosted.usernameLoginEnabled, false);
});
