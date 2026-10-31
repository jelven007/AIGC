import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';
const { loginEmail, validLoginIdentity } = await loadFrontend('src/lib/loginIdentity.ts', 'selfhost-private-login');

test('自托管用户名在服务端解析，前端不需要账号邮箱映射', () => {
  assert.equal(loginEmail(' operator-fixture ', 'login', true), 'operator-fixture');
  assert.equal(validLoginIdentity('operator-fixture', 'login', true), true);
  assert.equal(validLoginIdentity('operator fixture', 'login', true), false);
});
test('注册和常规托管登录仍要求完整邮箱', () => {
  assert.equal(validLoginIdentity('operator-fixture', 'register', true), false);
  assert.equal(validLoginIdentity('operator-fixture', 'login'), false);
  assert.equal(validLoginIdentity('user@example.com', 'register', true), true);
});
