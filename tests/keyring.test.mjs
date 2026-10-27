import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEdge } from './edge-loader.mjs';

const oldHex = 'a'.repeat(64), newHex = 'b'.repeat(64), secret = 'isolated-history-secret';
const env = { MODEL_CONFIG_ENCRYPTION_KEY: oldHex };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'keyring');
const ring = (active, keys = { old: oldHex, current: newHex }, legacy = 'old') =>
  JSON.stringify({ active_key_id: active, legacy_key_id: legacy, keys });
async function legacyCipher(slot) {
  const key = await crypto.subtle.importKey('raw', Buffer.from(oldHex, 'hex'), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(slot) }, key, Buffer.from(secret));
  return `${Buffer.from(iv).toString('base64')}.${Buffer.from(payload).toString('base64')}`;
}

test('新写入具有版本和key_id，原无版本密文继续读取', async () => {
  delete env.MODEL_CONFIG_KEYRING;
  const old = await legacyCipher('text.primary');
  assert.equal(await registry.decryptKey('text.primary', old), secret);
  const current = await registry.encryptKey('text.primary', secret);
  assert.match(current, /^v2\.legacy\./);
  assert.equal(await registry.decryptKey('text.primary', current), secret);
});

test('原密文换活动密钥后仍按原key_id解密，不原地覆盖旧任务凭据', async () => {
  env.MODEL_CONFIG_KEYRING = ring('old');
  const original = await registry.encryptKey('video.Wan3', secret);
  const legacy = await legacyCipher('platform-app:tiktok');
  env.MODEL_CONFIG_KEYRING = ring('current');
  const current = await registry.encryptKey('video.Wan3', secret);
  assert.match(original, /^v2\.old\./); assert.match(current, /^v2\.current\./);
  assert.equal(await registry.decryptKey('video.Wan3', original), secret);
  assert.equal(await registry.decryptKey('video.Wan3', current), secret);
  assert.equal(await registry.decryptKey('platform-app:tiktok', legacy), secret);
  for (const context of ['platform-connection:user:tiktok:open', 'measurement:source']) {
    const value = await registry.encryptKey(context, secret);
    assert.equal(await registry.decryptKey(context, value), secret);
  }
});

test('缺失原key、key_id/context/密文篡改均拒绝，不回退另一个密钥', async () => {
  env.MODEL_CONFIG_KEYRING = ring('old', { old: oldHex, current: oldHex });
  const cipher = await registry.encryptKey('text.primary', secret);
  await assert.rejects(registry.decryptKey('text.primary', cipher.replace('v2.old.', 'v2.current.')));
  await assert.rejects(registry.decryptKey('text.fallback', cipher));
  await assert.rejects(registry.decryptKey('text.primary', `${cipher}.extra`));
  env.MODEL_CONFIG_KEYRING = ring('current', { current: newHex }, null);
  await assert.rejects(registry.decryptKey('text.primary', cipher));
  await assert.rejects(registry.decryptKey('text.primary', await legacyCipher('text.primary')));
});

test('损坏或不完整keyring在新写入前拒绝，错误不含密钥和正文', async () => {
  for (const value of ['{', '[]', JSON.stringify({ active_key_id: 'missing', keys: { old: oldHex } }),
    ring('old', { old: 'short' }), ring('bad.id', { 'bad.id': oldHex })]) {
    env.MODEL_CONFIG_KEYRING = value;
    await assert.rejects(registry.encryptKey('text.primary', secret), cause => {
      assert.ok(!cause.message.includes(oldHex) && !cause.message.includes(secret));
      return true;
    });
  }
  delete env.MODEL_CONFIG_KEYRING;
});
