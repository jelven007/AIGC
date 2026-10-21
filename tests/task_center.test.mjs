import assert from 'node:assert/strict';
import { loadEdge } from './edge-loader.mjs';

const { mergeCenterTasks, videoCenterTask, productionCenterTask, publishCenterTask, taskDestination } =
  await loadEdge('src/lib/taskCenter.ts', 'task-center');
const video = { id: 'video', project_id: 'project', provider: 'Wan3', status: 'processing',
  submission_state: 'submitted', billing_state: 'reserved', credit_cost: 10, progress: 23,
  video_url: null, needs_attention: false, error_message: null, created_at: '2026-10-21T02:00:00Z' };
const production = { id: 'image', request_key: 'request', kind: 'image', project_id: null,
  status: 'running', progress: 41, phase: 'accepted', credit_cost: 10, result: null,
  error_message: null, created_at: '2026-10-21T03:00:00Z' };
const publish = { id: 'publish', job_id: 'publish-job', project_id: 'project', platform: 'douyin',
  title: '平台作品', status: 'moderating', platform_url: null, scheduled_at: null,
  error_message: null, created_at: '2026-10-21T04:00:00Z' };
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('视频unknown与needs_attention优先于运行状态，终态不被旧标记覆盖', () => {
  for (const fields of [{ submission_state: 'unknown' }, { needs_attention: true }]) {
    const task = videoCenterTask({ ...video, ...fields });
    assert.equal(task.status, 'unknown'); assert.equal(task.progress, null);
    assert.equal(task.billing, '预占 10 积分'); assert.equal(task.canCancel, false);
  }
  assert.equal(videoCenterTask({ ...video, status: 'completed', needs_attention: true }).status, 'completed');
  const cancelled = videoCenterTask({ ...video, status: 'cancelled', billing_state: 'refunded' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.billing, '已返还 10 积分');
  assert.equal(cancelled.progress, null);
});
test('使用服务端真实进度与计费状态，不生成固定65%进度', () => {
  assert.equal(videoCenterTask(video).progress, 23);
  assert.equal(productionCenterTask(production).progress, 41);
  assert.equal(productionCenterTask({ ...production, progress: NaN }).progress, null);
  assert.equal(productionCenterTask({ ...production, progress: 140 }).progress, 100);
  assert.equal(productionCenterTask({ ...production, status: 'completed', progress: 41 }).progress, 100);
  assert.equal(videoCenterTask({ ...video, status: 'completed', progress: 23 }).progress, 100);
  assert.equal(videoCenterTask({ ...video, status: 'failed', billing_state: 'refunded' }).billing, '已返还 10 积分');
});
test('封面、剪辑、图片区分类型，结果仅在完成后展示', () => {
  assert.equal(productionCenterTask({ ...production, project_id: 'project' }).kind, 'cover');
  assert.equal(productionCenterTask({ ...production, kind: 'render' }).kind, 'render');
  assert.equal(productionCenterTask({ ...production, result: { url: 'https://assets.example/unfinished' } }).outputUrl, null);
  assert.equal(productionCenterTask({ ...production, status: 'completed', result: { url: 'https://assets.example/image' } }).outputUrl, 'https://assets.example/image');
});
test('发布审核按平台记录显示，与通用任务完成状态分别处理', () => {
  assert.equal(publishCenterTask(publish).status, 'review');
  assert.equal(publishCenterTask(publish).statusLabel, '平台审核中');
  assert.equal(publishCenterTask(publish).progress, null);
  assert.equal(productionCenterTask({ ...production, kind: 'publish', status: 'completed' }).status, 'review');
  assert.equal(publishCenterTask({ ...publish, status: 'published' }).status, 'completed');
});
test('仅待提交发布可取消，受理未知及审核均不能取消或重发', () => {
  for (const status of ['draft', 'scheduled']) assert.equal(publishCenterTask({ ...publish, status }).canCancel, true);
  for (const status of ['publishing', 'submitted', 'moderating', 'unknown', 'published', 'failed', 'cancelled']) {
    assert.equal(publishCenterTask({ ...publish, status }).canCancel, false);
  }
});
test('生产发布与平台记录按job_id去重，保留失败来源的独立记录', () => {
  const publishingJob = { ...production, id: 'publish-job', kind: 'publish', status: 'completed' };
  const snapshot = { videos: [video], production: [production, publishingJob], publishes: [publish] };
  const tasks = mergeCenterTasks(snapshot);
  assert.equal(tasks.length, 3); assert.equal(tasks[0].source, 'publish'); assert.equal(tasks[0].status, 'review');
  assert.equal(mergeCenterTasks({ ...snapshot, publishes: [] }).length, 3);
  assert.equal(mergeCenterTasks({ videos: [], production: [publishingJob], publishes: [] })[0].status, 'review');
});
test('同UUID不同任务来源不会互相覆盖，列表按创建时间稳定排序', () => {
  const tasks = mergeCenterTasks({ videos: [{ ...video, id: 'same' }],
    production: [{ ...production, id: 'same' }], publishes: [{ ...publish, id: 'same' }] });
  assert.equal(new Set(tasks.map(task => task.key)).size, 3);
  assert.deepEqual(tasks.map(task => task.source), ['publish', 'production', 'video']);
});
test('失败任务去当前创作/工程入口，发布去授权管理，未创建新消费', () => {
  assert.equal(taskDestination(videoCenterTask({ ...video, status: 'failed' })).href, '/video/create');
  assert.equal(taskDestination(productionCenterTask({ ...production, kind: 'render', project_id: 'original-project', status: 'failed' })).href,
    '/video/edit?importId=original-project');
  assert.equal(taskDestination(publishCenterTask(publish)).href, '/publish?projectId=project');
});
test('竞品和选品归属正式页面，失败保留退款说明及采集来源', () => {
  for (const [kind, href] of [['intelligence_competitor','/competitor'],['intelligence_products','/product-selection']]) {
    const task=productionCenterTask({ ...production,kind,status:'failed',credit_cost:2 });
    assert.equal(task.kind,kind); assert.equal(task.billing,'已返还 2 积分');
    assert.equal(taskDestination(task).href,href);
    assert.ok(productionCenterTask({ ...production,kind,status:'completed' }).detail.includes('快照保留30天'));
  }
});
test('商品提取完成后要求核对，归属商品库并且不冒报视频生成或积分消费', () => {
  const task = productionCenterTask({ ...production, kind: 'product_import', status: 'completed', credit_cost: 0 });
  assert.equal(task.kind, 'product_import'); assert.equal(task.billing, null); assert.equal(task.outputUrl, null);
  assert.match(task.detail, /核对后导入/); assert.equal(taskDestination(task).href, '/products');
});
console.log(`${passed} tests passed`);
