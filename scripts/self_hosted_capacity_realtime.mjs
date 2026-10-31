/** 100个已有普通账号的公网Realtime连接与RLS事件核验，夹具经stdin传入。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const fixture = JSON.parse(Buffer.concat(chunks).toString());
const { origin, anon, users } = fixture;
assert.equal(users.length, 100);
const clients = [], own = new Set(), leaks = [], expected = new Set(users.map(u => u.project));
const started = Date.now();
try {
  await Promise.all(users.map(async user => {
    const client = createClient(origin, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    await client.realtime.setAuth(user.token);
    const channel = client.channel(`capacity-${user.id}`);
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'video_projects' }, payload => {
      if (!expected.has(payload.new.id)) return;
      if (payload.new.user_id !== user.id) leaks.push('cross-account-event');
      if (payload.new.id === user.project) own.add(user.id);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscribe-timeout')), 20000);
      channel.on('system', {}, payload => {
        if (payload.extension === 'postgres_changes' && payload.status === 'ok') {
          clearTimeout(timer); resolve();
        } else if (payload.status === 'error') {
          clearTimeout(timer); reject(new Error('subscribe-error'));
        }
      });
      channel.subscribe(status => {
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
          clearTimeout(timer); reject(new Error(status));
        }
      });
    });
  }));
  const connectedSeconds = (Date.now() - started) / 1000;
  await Promise.all(users.map(async user => {
    const response = await fetch(`${origin}/rest/v1/video_projects?id=eq.${user.project}`, {
      method: 'PATCH', headers: { apikey: anon, Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: fixture.run })
    });
    assert.equal(response.status, 204, 'own-project-update');
  }));
  const deadline = Date.now() + 20000;
  while (own.size < users.length && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(own.size, 100, 'own-events');
  assert.equal(leaks.length, 0, 'cross-account-events');
  const report = { passed: true, origin, measurement_location: 'public macOS client',
    users: 100, connected: clients.length, own_events: own.size, cross_account_events: leaks.length,
    connected_seconds: connectedSeconds, elapsed_seconds: (Date.now() - started) / 1000, tls_verified: true };
  fs.writeFileSync(process.env.CAPACITY_OUTPUT, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  await Promise.all(clients.map(client => client.removeAllChannels()));
}
