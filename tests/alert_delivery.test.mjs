import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://db.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service', VIDEO_WORKER_SECRET: 'general', RENDER_WORKER_SECRET: 'render' })[name] }, serve() {} };
const calls = [];
const event = '10000000-0000-4000-8000-000000000001';
const lease = '10000000-0000-4000-8000-000000000002';
globalThis.__createClient = () => ({ async rpc(name, args) {
  calls.push({ name, args });
  if (name === 'claim_alert_delivery') return { data: { event_id: event, lease_token: lease, payload: { event_id: event } } };
  if (name === 'finish_alert_delivery') return { data: true };
  throw new Error(`unexpected dispatch ${name}`);
} });
const { handleProductionWorker } = await loadEdge('supabase/functions/production-worker/index.ts', 'alert-delivery');
const request = (token, body) => new Request('https://db.example/functions/v1/production-worker', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
let response = await handleProductionWorker(request('general', { action: 'alert_claim', channel: 'operations' }));
assert.equal(response.status, 200);
assert.equal((await response.json()).event_id, event);
assert.deepEqual(calls.pop(), { name: 'claim_alert_delivery', args: { p_channel: 'operations' } });
response = await handleProductionWorker(request('general', { action: 'alert_finish', channel: 'operations',
  event_id: event, lease_token: lease, receipt: { accepted: true, event_id: event, secret: 'discard' } }));
assert.equal(response.status, 200);
assert.equal((await response.json()).saved, true);
assert.deepEqual(calls.pop().args, { p_channel: 'operations', p_event: event, p_lease: lease, p_receipt: { accepted: true, event_id: event } });
for (const action of ['alert_claim', 'alert_finish']) {
  assert.equal((await handleProductionWorker(request('render', { action, channel: 'operations', event_id: event, lease_token: lease }))).status, 403);
}
assert.equal(calls.length, 0);
assert.equal((await handleProductionWorker(request('general', { action: 'alert_claim', channel: 'invalid/channel' }))).status, 400);
assert.equal(calls.length, 0);
console.log('PASS alert delivery uses only general secret, original event/lease and sanitized receipts; never dispatches render');
