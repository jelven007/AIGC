/** 隔离实例：真实Realtime消息和用户隔离，不拦截后端。 */
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

assert.equal(process.env.SELF_HOSTED_ISOLATED_ACCEPTANCE, 'true');
const base = process.env.PUBLIC_ORIGIN, anon = process.env.ANON_KEY, service = process.env.SERVICE_ROLE_KEY;
async function api(path, token, body, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { apikey: anon,
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${method} ${path.split('?')[0]} HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const users = [], clients = [], channels = [], events = [[], []];
try {
  for (let i = 0; i < 2; i++) {
    const email = `selfhost-realtime-${randomUUID()}@example.com`, password = randomUUID();
    const user = await api('/auth/v1/admin/users', service, { email, password, email_confirm: true });
    users.push(user);
    const session = await api('/auth/v1/token?grant_type=password', anon, { email, password });
    const client = createClient(base, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    await client.realtime.setAuth(session.access_token);
    const channel = client.channel(`acceptance-${randomUUID()}`);
    channels.push(channel);
    for (const table of ['video_projects', 'materials', 'user_plans', 'credit_logs', 'plans']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => events[i].push(payload));
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime subscribe timeout')), 15000);
      channel.on('system', {}, payload => {
        if (payload.extension === 'postgres_changes' && payload.status === 'ok') {
          clearTimeout(timer); resolve();
        } else if (payload.status === 'error') {
          clearTimeout(timer); reject(new Error(payload.message));
        }
      });
      channel.subscribe((status, error) => {
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timer); reject(error || new Error(status)); }
      });
    });
  }
  const project = randomUUID(), title = `selfhost-realtime-${randomUUID()}`;
  await api('/rest/v1/video_projects', service, { id: project, user_id: users[0].id, title, status: 'draft' });
  await api(`/rest/v1/user_plans?user_id=eq.${users[0].id}`, service, { credits_total: 123 }, 'PATCH');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !['video_projects', 'user_plans'].every(
    table => events[0].some(event => event.table === table))) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(events[0].some(event => event.table === 'video_projects' && event.new.id === project), 'Own project event missing');
  assert.ok(events[0].some(event => event.table === 'user_plans' && event.new.credits_total === 123), 'Own credits event missing');
  assert.equal(events[1].filter(event => ['video_projects', 'user_plans'].includes(event.table)
    && event.new.user_id === users[0].id).length, 0,
    'Realtime leaked another user data');
  await api(`/rest/v1/video_projects?id=eq.${project}`, service, undefined, 'DELETE');
  console.log(JSON.stringify({ passed: true, websocket: true, own_project_event: true,
    own_credits_event: true, other_user_isolated: true }));
} finally {
  await Promise.all(clients.map(client => client.removeAllChannels()));
  for (const user of users) await api(`/auth/v1/admin/users/${user.id}`, service, {}, 'DELETE');
}
