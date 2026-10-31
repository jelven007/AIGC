import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';

test('用户名登录只转发真实Auth会话，公开错误不泄露私有身份', async () => {
  const { usernameLogin } = await loadFrontend('infra/self-hosted/main/username_login.ts', 'private-username');
  const identity = { username: 'operator-fixture', email: 'operator@example.com' };
  let forwarded;
  const upstream = async (url, options) => {
    forwarded = { url, body: JSON.parse(options.body) };
    return Response.json({ access_token: 'access-fixture', refresh_token: 'refresh-fixture' });
  };
  const response = await usernameLogin(new Request('http://service/username-login', {
    method: 'POST', body: JSON.stringify({ username: 'operator-fixture', password: 'input-password' }),
  }), identity, upstream);
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, 'http://auth:9999/token?grant_type=password');
  assert.deepEqual(forwarded.body, { email: identity.email, password: 'input-password' });
  const value = await response.json();
  assert.equal(value.access_token, 'access-fixture');
  for (const body of [
    { username: 'unknown-user', password: 'input-password' },
    { username: 'operator-fixture', password: '' },
  ]) {
    const denied = await usernameLogin(new Request('http://service/username-login', {
      method: 'POST', body: JSON.stringify(body),
    }), identity, () => { throw new Error('must not contact Auth'); });
    assert.equal(denied.status, 400);
    assert.ok(!(await denied.text()).includes(identity.email));
  }
  const denied = await usernameLogin(new Request('http://service/username-login', {
    method: 'POST', body: JSON.stringify({ username: identity.username, password: 'wrong' }),
  }), identity, async () => Response.json({ error: identity.email }, { status: 400 }));
  assert.equal(denied.status, 400);
  assert.ok(!(await denied.text()).includes(identity.email));
});
