import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
const uid = '11111111-1111-4111-8111-111111111111', sourceId = crypto.randomUUID();
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
globalThis.Deno = { env: { get: key => env[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
let group = null, jobs = [], source = null, creates = 0, user = { id: uid }, sourceReads = 0;
const db = {
  auth: { getUser: async () => ({ data: { user } }) },
  from(table) {
    const conditions = {};
    return {
      select() { return this; }, eq(key, value) { conditions[key] = value; return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() {
        if (table === 'video_projects') { sourceReads++; return { data: source }; }
        return { data: group && Object.entries(conditions).every(([key, value]) => group[key] === value) ? group : null };
      },
      async single() { return this.maybeSingle(); },
      then(resolve) { resolve({ data: table === 'production_jobs' ? jobs : group ? [group] : [], error: null }); },
    };
  },
  async rpc(name, args) {
    if (name === 'can_read_media') return { data: args.p_path.startsWith(uid + '/') };
    assert.equal(name, 'create_render_export'); creates++;
    group = { id: crypto.randomUUID(), user_id: uid, request_key: args.p_request_key,
      request_payload: args.p_request, source_project_id: sourceId, source_title: '原作品', created_at: '2026-10-21' };
    jobs = args.p_request.formats.map(format => ({ id: crypto.randomUUID(), user_id: uid, request_key: crypto.randomUUID(),
      kind: 'render', export_id: group.id, payload: { title: '规格', ratio: format.ratio, height: format.height },
      status: 'pending', progress: 0, result: null }));
    return { data: group.id };
  },
  storage: { from() { return { createSignedUrl: async () => ({ data: { signedUrl: 'https://db.example/signed.mp4' } }) }; } },
};
globalThis.__createClient = () => db;
const spec = await loadEdge('supabase/functions/_shared/render-spec.ts', 'exports-spec');
const exports = await loadEdge('supabase/functions/_shared/render-exports.ts', 'exports-core');
const api = await loadEdge('supabase/functions/production-jobs/index.ts', 'exports-api');
const request = body => new Request('https://db.example/functions/v1/production-jobs', {
  method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const payload = { action: 'export', request_key: crypto.randomUUID(), source_project_id: sourceId,
  formats: [{ ratio: '4:5', height: 720 }, { ratio: '9:16', height: 1080 }] };
assert.throws(() => exports.exportRequest({ ...payload, formats: [payload.formats[0], payload.formats[0]] }), /重复/);
assert.throws(() => exports.exportRequest({ ...payload, formats: [{ ratio: '4:5', height: '720' }] }));
assert.equal(spec.validateRender({ version: 1, title: '4:5', duration: 1, height: 720, fps: 30, ratio: '4:5',
  tracks: [{ id: 'v', type: 'video', url: 'https://example/video', start: 0, duration: 1, filterIntensity: 0 }] }).ratio, '4:5');
user = null;
assert.equal((await api.handleProductionJobs(request(payload))).status, 401);
user = { id: uid };
assert.equal((await api.handleProductionJobs(request(payload))).status, 400);
source = { id: sourceId, status: 'completed', duration: 2,
  video_url: `https://db.example/storage/v1/object/authenticated/materials/other-user/video.mp4` };
assert.equal((await api.handleProductionJobs(request(payload))).status, 400);
assert.equal(creates, 0);
source.video_url = source.video_url.replace('other-user', uid);
assert.equal((await api.handleProductionJobs(request(payload))).status, 202);
assert.equal(creates, 1);
source = null; sourceReads = 0;
assert.equal((await api.handleProductionJobs(request({ ...payload, formats: [...payload.formats].reverse() }))).status, 202);
assert.equal(creates, 1); assert.equal(sourceReads, 0);
assert.equal((await api.handleProductionJobs(request({ ...payload, formats: [{ ratio: '1:1', height: 720 }] }))).status, 409);
jobs[0] = { ...jobs[0], status: 'completed', progress: 100, result: { url: 'https://db.example/success.mp4' } };
jobs[1] = { ...jobs[1], status: 'failed', progress: 5 };
const result = await (await api.handleProductionJobs(request({ action: 'query-export', request_key: payload.request_key }))).json();
assert.equal(result.export.status, 'partial'); assert.equal(result.export.progress, 100);
assert.equal(result.export.jobs[0].payload, undefined);
assert.equal(result.export.jobs[0].output_ratio, '4:5');
user = { id: 'other-user' };
assert.equal((await api.handleProductionJobs(request({ action: 'query-export', request_key: payload.request_key }))).status, 404);
console.log('PASS 多规格校验、先授权后创建、原请求恢复先于素材查询、部分失败聚合与用户隔离');
