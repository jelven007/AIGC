import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';
const { loginEmail, validLoginIdentity } = await loadFrontend('src/lib/loginIdentity.ts', 'selfhost-login');
const alias = { username: 'admin', email: 'admin@shopro.local' };

test('自托管管理员用户名映射到真实Auth邮箱', () => {
  assert.equal(loginEmail(' admin ', 'login', alias), 'admin@shopro.local');
  assert.equal(loginEmail('ADMIN', 'login', alias), 'admin@shopro.local');
  assert.equal(validLoginIdentity('admin', 'login', alias), true);
});
test('注册和常规托管登录不能使用管理员别名', () => {
  assert.equal(validLoginIdentity('admin', 'register', alias), false);
  assert.equal(validLoginIdentity('admin', 'login'), false);
  assert.equal(validLoginIdentity('user@example.com', 'register', alias), true);
  assert.equal(loginEmail('user@example.com', 'login', alias), 'user@example.com');
});
