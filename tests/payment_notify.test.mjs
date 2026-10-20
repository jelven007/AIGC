import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let handler;
let eventExists = false;
let failGrant = true;
let grants = 0;
let rpcCalls = 0;
const admin = {
  from(table) {
    const query = {
      select() { return this; }, eq() { return this; },
      async maybeSingle() {
        return { data: { order_no: 'order', user_id: 'user', pay_channel: 'alipay', total_amount: '10.00' } };
      },
      async insert() {
        assert.equal(table, 'alipay_notify_events');
        if (eventExists) return { error: { code: '23505', message: 'duplicate' } };
        eventExists = true;
        return { error: null };
      },
    };
    return query;
  },
  async rpc(name, parameters) {
    assert.equal(name, 'finalize_paid_order');
    assert.equal(parameters.p_amount, '10.00');
    assert.equal(parameters.p_pay_channel, 'alipay');
    rpcCalls++;
    if (failGrant) return { error: { message: 'injected grant failure' } };
    const outcome = grants ? 'already_processed' : 'granted';
    grants = 1;
    return { data: { outcome, user_id: 'user' } };
  },
};
globalThis.__createClient = () => admin;
globalThis.__createAlipaySdk = () => ({ checkNotifySignV2: () => true });
globalThis.__getAlipayConfig = () => ({ appId: 'app', sellerId: '', sellerEmail: '' });
globalThis.Deno = { env: { get: () => 'test' }, serve: callback => { handler = callback; } };
const directory = '/tmp/shoproai-payment-notify-test';
mkdirSync(directory, { recursive: true });
const files = [
  ['payments.mjs', readFileSync('supabase/functions/_shared/payments.ts', 'utf8')],
  ['cors.mjs', readFileSync('supabase/functions/_shared/cors.ts', 'utf8')],
  ['alipay.mjs', readFileSync('supabase/functions/_shared/alipay.ts', 'utf8')
    .replace("import { AlipaySdk } from 'npm:alipay-sdk@4.14.0';", 'const AlipaySdk = class {};')
    .replace('./payments.ts', './payments.mjs')],
  ['handler.mjs', readFileSync('supabase/functions/alipay-payment-notify/index.ts', 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2';", 'const createClient = globalThis.__createClient;')
    .replace('../_shared/cors.ts', './cors.mjs').replace('../_shared/alipay.ts', './alipay.mjs')
    .replace('  createAlipaySdk,', '').replace('  getAlipayConfig,', '')
    .replace("const textRes =", 'const createAlipaySdk = globalThis.__createAlipaySdk; const getAlipayConfig = globalThis.__getAlipayConfig;\nconst textRes =')],
];
for (const [file, source] of files) {
  writeFileSync(`${directory}/${file}`, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
}
await import(pathToFileURL(`${directory}/handler.mjs`).href);
async function notify() {
  return handler(new Request('https://test.invalid/notify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      app_id: 'app', notify_id: 'event', trade_no: 'trade', out_trade_no: 'order',
      trade_status: 'TRADE_SUCCESS', total_amount: '10.00', sign: 'test',
    }),
  }));
}
assert.equal(await (await notify()).text(), 'fail');
assert.equal(eventExists, true);
assert.equal(grants, 0);
failGrant = false;
assert.equal(await (await notify()).text(), 'success');
assert.equal(grants, 1);
assert.equal(rpcCalls, 2);
console.log('PASS 支付宝事件已落库但发放失败，重复事件仍重试入账');
assert.equal(await (await notify()).text(), 'success');
assert.equal(grants, 1);
assert.equal(rpcCalls, 3);
console.log('PASS 重复通知交由事务去重，只发放一次');
console.log('2 tests passed');
