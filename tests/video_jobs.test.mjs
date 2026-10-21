import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';
let environment = {};
globalThis.Deno = { env: { get: key => environment[key] }, serve() {}, resolveDns: async () => ['8.8.8.8'] };
globalThis.__createClient = (...args) => db;
const providers = await loadEdge('supabase/functions/_shared/video-providers.ts', 'video-provider');
const { processVideoJob } = await loadEdge('supabase/functions/_shared/video-jobs.ts', 'video-jobs');
const { handleVideoJobs } = await loadEdge('supabase/functions/video-jobs/index.ts', 'video-handler');
const { handleVideoWorker } = await loadEdge('supabase/functions/video-job-worker/index.ts', 'video-worker');
const { encryptKey } = await loadEdge('supabase/functions/_shared/model-registry.ts', 'video-registry');
const { defaultSettings } = await loadEdge('supabase/functions/_shared/model-catalog.ts', 'video-catalog');
environment.MODEL_CONFIG_ENCRYPTION_KEY = '1'.repeat(64);
const ciphertext = await encryptKey('video.Wan3', 'test-model-key');
const settings = { ...defaultSettings('video.Wan3'), endpoint: 'https://provider.example/tasks',
  query_endpoint: 'https://provider.example/tasks', model: 'configured-video' };
const input = { prompt: '商品特写', title: '商品', duration: 5, ratio: '16:9', resolution: '720P',
  reference_images: [], reference_videos: [] };
const config = { provider: 'Wan3', createUrl: 'https://provider.example/create',
  queryUrl: 'https://provider.example/query', headers: { Authorization: 'Bearer private' },
  model: 'configured-model', timeoutMs: 30000, versionId: 'version-old' };

let passes = 0;
async function test(name, run) { await run(); passes++; console.log(`PASS ${name}`); }
await test('参数校验、规格归一化、模型素材能力', () => {
  assert.equal(providers.validateVideoInput('MiniMax', input).resolution, '768P');
  assert.equal(providers.validateVideoInput('SeedanceMini', { ...input, duration: 2 }).duration, 4);
  for (const extra of [{ duration: 999 }, { prompt: '' }, { first_frame: 'data:image/png;base64,test' }]) {
    assert.throws(() => providers.validateVideoInput('MiniMax', { ...input, ...extra }));
  }
  assert.throws(() => providers.validateVideoInput('Wan3', { ...input, last_frame: 'https://assets.example/last.png' }));
  assert.equal(providers.providerBody('HappyHorse', { ...input, resolution: '1080P', ratio: '9:16' }, 'configured').parameters.size, '1080*1920');
});
await test('六种协议提交成功均提取上游 ID', async () => {
  const responses = {
    MiniMax: { id: 'task' }, SeedanceMini: { id: 'task' }, Wan3: { output: { task_id: 'task' } },
    HappyHorse: { output: { task_id: 'task' } }, Kling: { task_id: 'task' }, Seedance: { task_id: 'task' },
  };
  for (const [provider, data] of Object.entries(responses)) {
    globalThis.fetch = async () => Response.json(data);
    assert.equal(await providers.submitVideo({ ...config, provider }, input), 'task');
  }
});
await test('POST 超时、5xx、无任务 ID 均不重发、不判定退款', async () => {
  for (const outcome of [() => { throw new TypeError('timeout'); },
    () => new Response('', { status: 503 }), () => Response.json({})]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return outcome(); };
    await assert.rejects(() => providers.submitVideo(config, input),
      error => error instanceof providers.SubmissionError && !error.confirmedRejected);
    assert.equal(calls, 1);
  }
});
await test('明确拒绝才能释放，查询错误和 UNKNOWN 不作为失败证据', async () => {
  globalThis.fetch = async () => new Response('', { status: 422 });
  await assert.rejects(() => providers.submitVideo(config, input), error => error.confirmedRejected);
  for (const status of ['UNKNOWN', '', 'RUNNING']) {
    assert.equal(providers.parseVideoOutcome('Wan3', { output: { task_status: status } }).state, 'pending');
  }
  assert.equal(providers.parseVideoOutcome('Wan3', { code: 'FAILED', message: 'query error' }).state, 'pending');
  assert.equal(providers.parseVideoOutcome('Wan3', { output: { task_status: 'FAILED' } }).state, 'failed');
  assert.throws(() => providers.parseVideoOutcome('SeedanceMini', { status: 'succeeded', content: {} }));
  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(() => providers.queryVideo(config, 'task'));
});
await test('MiniMax 400 错误消息包含 failed 不能冒充任务失败', async () => {
  globalThis.fetch = async () => Response.json({ error: { message: 'authentication failed' } }, { status: 400 });
  await assert.rejects(() => providers.queryVideo({ ...config, provider: 'MiniMax' }, 'task'));
  globalThis.fetch = async () => Response.json({ error: { message: 'task status is IN_PROGRESS, not completed' } }, { status: 400 });
  assert.equal((await providers.queryVideo({ ...config, provider: 'MiniMax' }, 'task')).state, 'pending');
  globalThis.fetch = async () => Response.json({ error: { message: 'task status is FAILED, not completed' } }, { status: 400 });
  assert.equal((await providers.queryVideo({ ...config, provider: 'MiniMax' }, 'task')).state, 'failed');
});

let state;
const jobId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const db = {
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: userId } : null } }) },
  from(table) {
    const q = {
      select() { return this; },
      eq(key, value) { state.filters.push([key, value]); return this; },
      not() { return this; }, order() { return this; }, limit() { return this; },
      maybeSingle: async () => ({ data: table === 'model_configs'
        ? { enabled: !state.disabledModel, current_version_id: 'version-current' }
        : state.foreignJob || state.creating ? null : state.job, error: null }),
      single: async () => ({ data: table === 'model_config_versions'
        ? { id: 'version-old', slot: 'video.Wan3', settings, key_ciphertext: ciphertext } : state.job, error: null }),
      then(resolve) {
        return Promise.resolve({ data: [state.job], error: state.schemaError ? { message: 'missing column' } : null }).then(resolve);
      },
    };
    return q;
  },
  storage: {
    from() {
      return {
        async upload(path) { state.uploads.push(path); return { error: state.storageError ? { message: 'down' } : null }; },
        getPublicUrl: path => ({ data: { publicUrl: `https://storage.example/${path}` } }),
      };
    },
  },
  async rpc(name, parameters) {
    state.calls.push({ name, parameters });
    if (name === 'claim_video_job') return { data: state.claim ? state.job : null };
    if (name === 'create_video_job') return { data: state.job };
    if (name === 'record_video_job_event' && state.recordError) return { error: { message: 'db down' } };
    return { data: state.job, error: null };
  },
};
function reset(overrides = {}) {
  environment = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'public',
    SUPABASE_SERVICE_ROLE_KEY: 'server', VIDEO_WORKER_SECRET: 'worker', MODEL_CONFIG_ENCRYPTION_KEY: '1'.repeat(64) };
  state = {
    authenticated: true, claim: true, calls: [], filters: [], uploads: [],
    job: { id: jobId, user_id: userId, project_id: 'project', provider: 'Wan3', payload: input,
      model_config_version_id: 'version-old',
      lease_token: 'lease', submission_state: 'submitted', provider_task_id: 'provider-task',
      status: 'processing', billing_state: 'reserved', credit_cost: 10, progress: 5 },
    ...overrides,
  };
}
const events = () => state.calls.filter(c => c.name === 'record_video_job_event').map(c => c.parameters.p_event);
const request = (body, authorization = 'Bearer user') => new Request('https://local.example', {
  method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify(body),
});
await test('后台失败先保存证据再调用原子退款状态事务', async () => {
  reset();
  globalThis.fetch = async () => Response.json({ output: { task_status: 'FAILED' } });
  await processVideoJob(db);
  assert.deepEqual(state.calls.map(c => c.name), ['claim_video_job', 'checkpoint_video_job_result', 'record_video_job_event']);
  assert.deepEqual(events(), ['failed']);
  assert.equal(state.calls.at(-1).parameters.p_job_id, jobId);
});
await test('查询/转存故障保留任务，不退款', async () => {
  reset();
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await processVideoJob(db);
  assert.deepEqual(events(), ['query_error']);
  reset({ storageError: true });
  globalThis.fetch = async url => url.includes('/query') || url.includes('/tasks/')
    ? Response.json({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/video.mp4' } })
    : new Response('video', { headers: { 'Content-Type': 'video/mp4' } });
  await processVideoJob(db);
  assert.deepEqual(events(), ['query_error']);
  assert.equal(state.uploads.length, 1);
});
await test('成功转存使用固定路径并在服务端结算', async () => {
  reset();
  globalThis.fetch = async url => url.includes('/tasks/')
    ? Response.json({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/video.mp4' } })
    : new Response('video', { headers: { 'Content-Type': 'video/mp4' } });
  await processVideoJob(db);
  assert.deepEqual(events(), ['completed']);
  assert.deepEqual(state.uploads, [`generated-videos/${userId}/${jobId}.mp4`]);
  assert.match(state.calls.at(-1).parameters.p_video_url, /^https:\/\/storage.example/);
});
await test('退款事务故障后用持久化证据恢复，无需再次请求上游', async () => {
  reset();
  state.job.resolution_event = { event: 'failed', error: 'upstream confirmed failed' };
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  await processVideoJob(db);
  assert.deepEqual(events(), ['failed']);
});
await test('受理成功后数据库故障绝不退款或重发', async () => {
  reset({ recordError: true });
  state.job.submission_state = 'submitting';
  let posts = 0;
  globalThis.fetch = async () => { posts++; return Response.json({ task_id: 'accepted' }); };
  await assert.rejects(() => processVideoJob(db));
  assert.equal(posts, 1);
  assert.deepEqual(events(), ['accepted']);
});
await test('旧任务/已领取任务不执行模型', async () => {
  reset({ claim: false });
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  assert.equal(await processVideoJob(db), false);
});
await test('未登录、跨用户查询和伪造退款均拒绝', async () => {
  reset({ authenticated: false });
  assert.equal((await handleVideoJobs(request({ action: 'create' }))).status, 401);
  reset({ foreignJob: true });
  assert.equal((await handleVideoJobs(request({ action: 'query', job_id: jobId }))).status, 404);
  assert.ok(state.filters.some(([key, value]) => key === 'user_id' && value === userId));
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal((await handleVideoJobs(request({ action: 'failed', job_id: jobId }))).status, 400);
  assert.equal(state.calls.length, 0);
});
await test('缺少模型密钥与非法参数在扣费前拒绝', async () => {
  reset();
  state.creating = true;
  state.disabledModel = true;
  assert.equal((await handleVideoJobs(request({ action: 'create', request_key: jobId, provider: 'Wan3', input }))).status, 400);
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal((await handleVideoJobs(request({ action: 'create', request_key: jobId, provider: 'Wan3',
    input: { ...input, duration: 100 } }))).status, 400);
  assert.equal(state.calls.length, 0);
});
await test('创建按认证用户计费，响应隐藏上游标识与扣费流水', async () => {
  reset();
  state.creating = true;
  const response = await handleVideoJobs(request({ action: 'create', request_key: jobId, provider: 'Wan3',
    input, user_id: 'attacker', cost: 0 }));
  assert.equal(response.status, 202);
  assert.equal(state.calls[0].parameters.p_user_id, userId);
  assert.equal(state.calls[0].name, 'create_video_job');
  const data = await response.json();
  assert.equal(data.job.provider_task_id, undefined);
  assert.equal(data.job.lease_token, undefined);
  assert.equal(data.job.charge_id, undefined);
});
await test('后台必须使用专用密钥，用户 JWT 无法触发', async () => {
  reset({ claim: false });
  assert.equal((await handleVideoWorker(request({}, 'Bearer user'))).status, 401);
  assert.equal(state.calls.length, 0);
  assert.equal((await handleVideoWorker(request({}, 'Bearer worker'))).status, 200);
});
await test('调度预检验证队列表结构，不领取任务或调用模型', async () => {
  reset();
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  const response = await handleVideoWorker(request({ action: 'probe' }, 'Bearer worker'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true, version: 1 });
  assert.equal(state.calls.length, 0);
  reset({ schemaError: true });
  assert.equal((await handleVideoWorker(request({ action: 'probe' }, 'Bearer worker'))).status, 503);
  assert.equal(state.calls.length, 0);
  assert.equal((await handleVideoWorker(request({ action: 'invalid' }, 'Bearer worker'))).status, 400);
});
console.log(`${passes} tests passed`);
