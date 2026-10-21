import type { ServerVideoJob } from '@/api/videoJobs';
import type { ProductionJob } from '@/api/productionJobs';
import type { PlatformPublishTask } from '@/api/platforms';

export type TaskSource = 'video' | 'production' | 'publish';
export type TaskStatus = 'pending' | 'running' | 'review' | 'completed' | 'failed' | 'unknown' | 'cancelled';
export type TaskKind = 'video' | 'image' | 'cover' | 'render' | 'publish' | 'metrics';
export interface CenterTask {
  key: string;
  id: string;
  source: TaskSource;
  kind: TaskKind;
  status: TaskStatus;
  statusLabel: string;
  detail: string;
  projectId: string | null;
  createdAt: string;
  scheduledAt?: string | null;
  error: string | null;
  progress: number | null;
  billing: string | null;
  outputUrl: string | null;
  canCancel: boolean;
}
export interface TaskSnapshot {
  videos: ServerVideoJob[];
  production: ProductionJob[];
  publishes: PlatformPublishTask[];
}
export const TASK_KINDS: Record<TaskKind, string> = {
  video: '视频生成', image: '图片生成', cover: '封面生成', render: '剪辑渲染', publish: '平台发布', metrics: '指标采集',
};
export const TASK_STATUSES: Record<TaskStatus, string> = {
  pending: '等待中', running: '处理中', review: '平台处理中', completed: '已完成',
  failed: '已失败', unknown: '待核对', cancelled: '已取消',
};
const percent = (value: number): number | null => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
const projectQuery = (id: string | null) => id ? `?projectId=${encodeURIComponent(id)}` : '';

export function taskDestination(task: CenterTask): { href: string; label: string } {
  if (task.kind === 'publish') return { href: `/publish${projectQuery(task.projectId)}`, label: '管理发布' };
  if (task.kind === 'metrics') return { href: `/data-feedback${projectQuery(task.projectId)}`, label: '查看数据' };
  if (task.kind === 'render' && task.projectId) {
    return { href: `/video/edit?importId=${encodeURIComponent(task.projectId)}`, label: task.status === 'failed' ? '重新编辑' : '打开工程' };
  }
  if (task.kind === 'cover') return { href: '/works', label: '管理封面' };
  if (task.status === 'failed' || task.kind === 'image') return { href: '/video/create', label: '前往创作' };
  return { href: '/works', label: '查看作品' };
}

export function videoCenterTask(job: ServerVideoJob): CenterTask {
  const terminal = ['completed', 'failed'].includes(job.status);
  const attention = !terminal && (job.submission_state === 'unknown' || job.needs_attention);
  const status: TaskStatus = attention ? 'unknown' : job.status === 'processing' ? 'running'
    : job.status === 'pending' || terminal ? job.status as TaskStatus : 'unknown';
  const billing = job.credit_cost > 0 ? job.billing_state === 'refunded' ? `已返还 ${job.credit_cost} 积分`
    : job.billing_state === 'settled' ? `已结算 ${job.credit_cost} 积分` : `预占 ${job.credit_cost} 积分` : null;
  const detail = attention ? '受理或处理结果待核对，原任务继续保留'
    : job.submission_state === 'queued' ? '等待后台领取'
      : job.submission_state === 'submitting' ? '正在提交模型'
        : status === 'running' ? '后台生成与归档中' : TASK_STATUSES[status];
  return {
    key: `video:${job.id}`, id: job.id, source: 'video', kind: 'video', status, statusLabel: TASK_STATUSES[status],
    detail: `${job.provider} · ${detail}`, projectId: job.project_id, createdAt: job.created_at,
    error: job.error_message, progress: status === 'unknown' ? null : status === 'completed' ? 100 : percent(job.progress),
    billing, outputUrl: status === 'completed' ? job.video_url : null, canCancel: false,
  };
}

export function productionCenterTask(job: ProductionJob): CenterTask {
  const kind: TaskKind = job.kind === 'image' ? job.project_id ? 'cover' : 'image'
    : ['render', 'publish', 'metrics'].includes(job.kind) ? job.kind as TaskKind : 'metrics';
  const status: TaskStatus = ['pending', 'running', 'completed', 'failed', 'unknown', 'cancelled'].includes(job.status)
    ? job.status : 'unknown';
  const phases: Record<string, string> = { ready: '等待后台领取', claimed: '后台已领取',
    executing: '正在提交上游', accepted: '已保存上游结果，后台继续处理' };
  // 平台发布记录才是审核与公开状态的依据，不能用通用任务 completed 替代公开成功。
  const publishFallback = job.kind === 'publish';
  const displayedStatus = publishFallback && status === 'completed' ? 'review' : status;
  return {
    key: `production:${job.id}`, id: job.id, source: 'production', kind, status: displayedStatus,
    statusLabel: publishFallback && status === 'completed' ? '发布结果待同步' : TASK_STATUSES[displayedStatus],
    detail: publishFallback ? '发布详情暂未返回，请在发布管理核对'
      : status === 'completed' ? kind === 'render' ? '成片已归档' : '生成结果已归档'
        : status === 'failed' ? '任务未能完成，请查看失败原因'
          : status === 'cancelled' ? '后台任务已停止'
            : status === 'unknown' ? '等待确认原任务结果' : phases[job.phase] || '后台处理中',
    projectId: job.project_id, createdAt: job.created_at, error: job.error_message,
    progress: ['unknown', 'review', 'cancelled'].includes(displayedStatus) || publishFallback
      ? null : displayedStatus === 'completed' ? 100 : percent(job.progress),
    billing: job.credit_cost > 0 ? status === 'failed' ? `已返还 ${job.credit_cost} 积分`
      : status === 'completed' ? `已结算 ${job.credit_cost} 积分` : `预占 ${job.credit_cost} 积分` : null,
    outputUrl: !publishFallback && status === 'completed' ? job.result?.url || null : null, canCancel: false,
  };
}

export function publishCenterTask(task: PlatformPublishTask): CenterTask {
  const state: Record<string, [TaskStatus, string]> = {
    draft: ['pending', '已排队'], scheduled: ['pending', '定时发布'], publishing: ['running', '上传中'],
    submitted: ['review', '平台处理中'], moderating: ['review', '平台审核中'],
    published: ['completed', '已发布'], failed: ['failed', '已失败'], unknown: ['unknown', '待核对'],
    cancelled: ['cancelled', '已取消'],
  };
  const [status, statusLabel] = state[task.status] || ['unknown', '待核对'];
  return {
    key: `publish:${task.id}`, id: task.id, source: 'publish', kind: 'publish', status, statusLabel,
    detail: `${task.platform === 'douyin' ? '抖音' : task.platform === 'tiktok' ? 'TikTok' : task.platform} · ${task.title || '未命名发布'}`,
    projectId: task.project_id, createdAt: task.created_at, scheduledAt: task.scheduled_at,
    error: task.error_message, progress: null, billing: null,
    outputUrl: status === 'completed' ? task.platform_url : null,
    canCancel: task.status === 'draft' || task.status === 'scheduled',
  };
}

export function mergeCenterTasks(snapshot: TaskSnapshot): CenterTask[] {
  const linkedJobs = new Set(snapshot.publishes.map(task => task.job_id).filter(Boolean));
  const tasks = [
    ...snapshot.videos.map(videoCenterTask),
    ...snapshot.production.filter(job => job.kind !== 'publish' || !linkedJobs.has(job.id)).map(productionCenterTask),
    ...snapshot.publishes.map(publishCenterTask),
  ];
  const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return tasks.sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || a.key.localeCompare(b.key));
}
