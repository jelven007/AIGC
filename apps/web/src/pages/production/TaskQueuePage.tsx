import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { queryServerVideoJob } from '@/api/videoJobs';
import { queryProductionJob } from '@/api/productionJobs';
import { cancelPlatformPublishTask } from '@/api/platforms';
import { taskListOptions, taskDetailKey, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  mergeCenterTasks, taskDestination, TASK_KINDS, TASK_STATUSES,
  type CenterTask, type TaskKind, type TaskSnapshot, type TaskSource, type TaskStatus,
} from '@/lib/taskCenter';

const STATUS_STYLE: Record<TaskStatus, string> = {
  pending: 'text-muted-foreground', running: 'text-info', review: 'text-info',
  completed: 'text-success', failed: 'text-destructive', unknown: 'text-warning', cancelled: 'text-muted-foreground',
};
const STATUS_ICON = { pending: Clock, running: Loader2, review: Clock, completed: CheckCircle2,
  failed: XCircle, unknown: AlertTriangle, cancelled: XCircle };
const SOURCE_NAMES: Record<TaskSource, string> = { video: '视频任务', production: '图片与剪辑任务', publish: '发布记录' };
const formatDate = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('zh-CN') : '时间未记录';

function TaskRow({ task, busy, disabled, onRefresh, onCancel }: {
  task: CenterTask; busy: boolean; disabled: boolean; onRefresh: (task: CenterTask) => void; onCancel: (task: CenterTask) => void;
}) {
  const Icon = STATUS_ICON[task.status];
  const destination = taskDestination(task);
  return (
    <article aria-label={`${TASK_KINDS[task.kind]} ${task.detail}`}
      className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <Icon aria-hidden="true" className={cn('mt-1 h-5 w-5 shrink-0', STATUS_STYLE[task.status],
            task.status === 'running' && 'motion-safe:animate-spin')} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-sm">{TASK_KINDS[task.kind]}</h2>
              <Badge variant="outline" className={STATUS_STYLE[task.status]}>{task.statusLabel}</Badge>
              {task.billing && <span className="text-sm text-muted-foreground">{task.billing}</span>}
            </div>
            <p className="text-sm break-words text-muted-foreground">{task.detail}</p>
            <p className="text-xs text-muted-foreground">
              创建：{formatDate(task.createdAt)}
              {task.scheduledAt && <span className="block sm:inline sm:ml-3">计划发布：{formatDate(task.scheduledAt)}</span>}
            </p>
            <p className="text-xs break-all font-mono text-muted-foreground">任务 ID：{task.id}</p>
            {task.progress !== null && <div className="flex items-center gap-3">
              <Progress value={task.progress} aria-label="任务进度" className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground tabular-nums">{task.progress}%</span>
            </div>}
            {task.error && <p className="text-sm break-words text-destructive">{task.error}</p>}
            {task.status === 'unknown' && <p className="text-sm text-warning">
              结果待核对，任务与原消费记录已保留。请先核对原任务，避免重复生成或发布。
            </p>}
            {task.status === 'failed' && task.kind !== 'publish' && <p className="text-sm text-muted-foreground">
              可进入创作页确认参数后重新提交，新任务将按当前规则计费。
            </p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:max-w-64 sm:justify-end">
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onRefresh(task)}>
            <RefreshCw aria-hidden="true" className={cn('mr-1.5 h-3.5 w-3.5', busy && 'motion-safe:animate-spin')} />
            {busy ? '正在刷新…' : '刷新状态'}
          </Button>
          <Button asChild variant="outline" size="sm"><Link to={destination.href}>{destination.label}</Link></Button>
          {task.outputUrl && <Button asChild variant="outline" size="sm">
            <a href={task.outputUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
              {task.kind === 'publish' ? '查看发布' : ['image', 'cover'].includes(task.kind) ? '查看图片' : '查看成片'}
            </a>
          </Button>}
          {task.canCancel && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onCancel(task)}>取消发布</Button>}
        </div>
      </div>
    </article>
  );
}

export default function TaskQueuePage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const videos = useTaskQuery(useMemo(() => taskListOptions('video', user?.id), [user?.id]), 'video', !!user);
  const production = useTaskQuery(useMemo(() => taskListOptions('production', user?.id), [user?.id]), 'production', !!user);
  const publishes = useTaskQuery(useMemo(() => taskListOptions('publish', user?.id), [user?.id]), 'publish', !!user);
  const snapshot: TaskSnapshot = { videos: videos.data || [], production: production.data || [], publishes: publishes.data?.tasks || [] };
  const sourceErrors: Partial<Record<TaskSource, string>> = {
    ...(videos.error ? { video: videos.error.message } : {}),
    ...(production.error ? { production: production.error.message } : {}),
    ...(publishes.error ? { publish: publishes.error.message } : {}),
  };
  const loading = !!user && [videos, production, publishes].some(query => query.isPending);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | TaskKind>('all');
  const [search, setSearch] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const updated = Math.min(videos.dataUpdatedAt, production.dataUpdatedAt, publishes.dataUpdatedAt);
  const lastUpdated = updated ? new Date(updated).toISOString() : null;
  const epoch = useRef(0);
  const loadToken = useRef<object | null>(null);
  const actionToken = useRef<object | null>(null);

  const load = useCallback(async () => {
    if (!user || loadToken.current) return;
    const generation = epoch.current, token = {};
    loadToken.current = token;
    setRefreshing(true);
    try {
      await Promise.allSettled([videos.refetch({ throwOnError: true }), production.refetch({ throwOnError: true }), publishes.refetch({ throwOnError: true })]);
    } finally {
      if (loadToken.current === token) loadToken.current = null;
      if (generation === epoch.current) setRefreshing(false);
    }
  }, [user?.id, videos.refetch, production.refetch, publishes.refetch]);

  useEffect(() => {
    epoch.current++;
    loadToken.current = null; actionToken.current = null;
    setBusyTask(null); setRefreshing(false);
    setStatusFilter('all'); setKindFilter('all'); setSearch('');
    return () => { epoch.current++; };
  }, [user?.id]);

  const refreshTask = async (task: CenterTask) => {
    if (!user || actionToken.current || loadToken.current) return;
    const token = {}, generation = epoch.current;
    actionToken.current = token; setBusyTask(task.key);
    try {
      if (task.source === 'video') {
        const job = await client.fetchQuery({ queryKey: taskDetailKey('video', user.id, { job_id: task.id }),
          queryFn: ({ signal }) => queryServerVideoJob({ job_id: task.id }, user.id, signal), retry: false, staleTime: 0 });
        if (!job || job.id !== task.id) throw new Error('任务查询结果不匹配，请刷新全部核对');
        if (generation !== epoch.current) return;
        rememberTask(client, 'video', user.id, job);
        window.dispatchEvent(new CustomEvent('credits_changed'));
      } else if (task.source === 'production') {
        const job = await client.fetchQuery({ queryKey: taskDetailKey('production', user.id, { job_id: task.id }),
          queryFn: ({ signal }) => queryProductionJob(task.id, user.id, signal), retry: false, staleTime: 0 });
        if (!job || job.id !== task.id) throw new Error('任务查询结果不匹配，请刷新全部核对');
        if (generation !== epoch.current) return;
        rememberTask(client, 'production', user.id, job);
        window.dispatchEvent(new CustomEvent('credits_changed'));
      } else {
        await publishes.refetch({ throwOnError: true });
      }
      toast.success('任务状态已更新');
    } catch (cause) {
      if (generation === epoch.current) toast.error(cause instanceof Error ? cause.message : '状态刷新失败，请稍后重试');
    } finally {
      if (actionToken.current === token) actionToken.current = null;
      if (generation === epoch.current) setBusyTask(null);
    }
  };
  const cancelTask = async (task: CenterTask) => {
    if (!user || !task.canCancel || task.source !== 'publish' || actionToken.current || loadToken.current) return;
    const token = {}, generation = epoch.current;
    actionToken.current = token; setBusyTask(task.key);
    try {
      await cancelPlatformPublishTask(task.id, user.id);
      if (generation !== epoch.current) return;
      toast.success('发布任务已取消');
      await load();
    } catch (cause) {
      if (generation === epoch.current) {
        toast.error(cause instanceof Error ? cause.message : '取消结果待确认，请刷新核对');
        await load();
      }
    } finally {
      if (actionToken.current === token) actionToken.current = null;
      if (generation === epoch.current) setBusyTask(null);
    }
  };

  const tasks = mergeCenterTasks(snapshot);
  const term = search.trim().toLowerCase();
  const shown = tasks.filter(task => (statusFilter === 'all' || task.status === statusFilter)
    && (kindFilter === 'all' || task.kind === kindFilter)
    && (!term || `${task.id} ${task.detail} ${TASK_KINDS[task.kind]}`.toLowerCase().includes(term)));
  const issues = Object.entries(sourceErrors) as [TaskSource, string][];
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <PageHeader title="任务中心" description="查看视频、图片、封面、剪辑和平台发布的后台进度。" actions={
        <Button variant="outline" disabled={refreshing || !!busyTask || !user} onClick={() => void load()}>
          <RefreshCw aria-hidden="true" className={cn('mr-2 h-4 w-4', refreshing && 'motion-safe:animate-spin')} />
          {refreshing ? '正在刷新…' : '刷新全部'}
        </Button>
      } />
      {issues.length > 0 && <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-card p-4 text-sm">
        <p className="font-medium">部分任务暂时无法更新，已保留上次成功读取的记录。</p>
        {issues.map(([source, message]) => <p key={source} className="break-words text-destructive">{SOURCE_NAMES[source]}：{message}</p>)}
      </div>}
      <div role="group" aria-label="任务状态筛选" className="flex flex-wrap gap-2">
        {(['all', 'pending', 'running', 'review', 'unknown', 'completed', 'failed', 'cancelled'] as const).map(status => (
          <Button key={status} variant={statusFilter === status ? 'default' : 'outline'} size="sm"
            aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
            {status === 'all' ? '全部' : TASK_STATUSES[status]} ({status === 'all' ? tasks.length : tasks.filter(task => task.status === status).length})
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 text-sm"><label htmlFor="task-kind-filter">任务类型</label>
          <select id="task-kind-filter" value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)}
            className="block h-10 rounded-md border border-input bg-background px-3">
            <option value="all">所有类型</option>{Object.entries(TASK_KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 text-sm"><label htmlFor="task-search">搜索任务</label>
          <input id="task-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="任务 ID、模型或发布标题"
            className="block h-10 w-full min-w-0 rounded-md border border-input bg-background px-3" />
        </div>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {lastUpdated ? `最后完整更新：${formatDate(lastUpdated)}。` : ''}
        活跃任务每10秒更新，待核对任务每30秒查询；页面隐藏时暂停，完成后停止自动查询。
      </p>
      {loading ? <div aria-label="正在加载任务" className="space-y-3">{[1, 2, 3].map(index => <Skeleton key={index} className="h-32 rounded-xl" />)}</div>
        : !user ? <p className="py-12 text-center text-sm text-muted-foreground">请先登录后查看自己的任务。</p>
          : shown.length ? <div className="space-y-3">{shown.map(task => <TaskRow key={task.key} task={task}
            busy={busyTask === task.key} disabled={refreshing || !!busyTask}
            onRefresh={item => void refreshTask(item)} onCancel={item => void cancelTask(item)} />)}</div>
            : <div className="space-y-3 rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">{issues.length ? '任务暂时无法完整加载，请点击刷新全部重试。'
                : tasks.length ? '没有符合筛选条件的任务。' : '暂无后台任务，提交创作后会在这里显示。'}</p>
              {tasks.length ? <Button variant="outline" onClick={() => { setStatusFilter('all'); setKindFilter('all'); setSearch(''); }}>清除筛选</Button>
                : <Button asChild variant="outline"><Link to="/video/create">前往创作</Link></Button>}
            </div>}
    </div>
  );
}
