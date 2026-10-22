import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', VIDEO_WORKER_SECRET: 'scheduler', RENDER_WORKER_SECRET: 'render' };
globalThis.Deno = { env: { get: key => env[key] }, serve() {} };
const calls = [];
let failure = false;
globalThis.__createClient = () => ({
  async rpc(name, args) {
    calls.push({ name, args });
    assert.equal(name, 'refresh_operations_alerts');
    return failure ? { error: { message: 'private server issue' } }
      : { data: { active: 3, opened: 1, resolved: 0, observed_at: new Date().toISOString() } };
  },
});
const { handleProductionWorker } = await loadEdge('supabase/functions/production-worker/index.ts', 'operations-monitor');
const request = (body, secret = 'scheduler') => new Request('https://db.example/functions/v1/production-worker', {
  method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body),
});
assert.equal((await handleProductionWorker(request({ action: 'monitor', scheduler_healthy: false }, 'user'))).status, 401);
assert.equal((await handleProductionWorker(request({ action: 'monitor', scheduler_healthy: false }, 'render'))).status, 400);
assert.equal(calls.length, 0);
assert.equal((await handleProductionWorker(request({ action: 'monitor', scheduler_healthy: 'false' }))).status, 400);
const response = await handleProductionWorker(request({ action: 'monitor', scheduler_healthy: false }));
assert.equal(response.status, 200);
assert.equal((await response.json()).active, 3);
assert.deepEqual(calls, [{ name: 'refresh_operations_alerts', args: { p_scheduler_healthy: false } }]);
failure = true;
const failed = await handleProductionWorker(request({ action: 'monitor', scheduler_healthy: true }));
assert.equal(failed.status, 503);
assert.equal(JSON.stringify(await failed.json()).includes('private'), false);
console.log('PASS 后台专用身份刷新告警，渲染/用户不能调用，真实布尔/故障脱敏且不消费生产任务');
