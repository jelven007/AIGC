import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { listServerVideoJobs, queryServerVideoJob } from '@/api/videoJobs';
import { listProductionJobs, queryProductionJob } from '@/api/productionJobs';
import { cancelPlatformPublishTask, listPlatformPublishTasks } from '@/api/platforms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, ListTodo, Loader2, RefreshCw, XCircle } from 'lucide-react';
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
const emptySnapshot = (): TaskSnapshot => ({ videos: [], production: [], publishes: [] });
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
  const [snapshot, setSnapshot] = useState<TaskSnapshot>(emptySnapshot);
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<TaskSource, string>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | TaskKind>('all');
  const [search, setSearch] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const epoch = useRef(0);
  const loadToken = useRef<object | null>(null);
  const actionToken = useRef<object | null>(null);

  const load = useCallback(async () => {
    if (!user || loadToken.current) return;
    const generation = epoch.current, token = {};
    loadToken.current = token;
    setRefreshing(true);
    try {
      const readList = async <T,>(request: Promise<T[]>): Promise<T[]> => {
        const records = await request;
        if (!Array.isArray(records)) throw new Error('任务服务返回格式无效，请检查后端版本');
        return records;
      };
      const requests = [readList(listServerVideoJobs()), readList(listProductionJobs()), readList(listPlatformPublishTasks())] as const;
      const [videos, production, publishes] = await Promise.allSettled(requests);
      if (generation !== epoch.current) return;
      const errors: Partial<Record<TaskSource, string>> = {};
      const message = (reason: unknown) => reason instanceof Error ? reason.message : '服务暂时不可用';
      if (videos.status === 'rejected') errors.video = message(videos.reason);
      if (production.status === 'rejected') errors.production = message(production.reason);
      if (publishes.status === 'rejected') errors.publish = message(publishes.reason);
      setSourceErrors(errors);
      setSnapshot(previous => ({
        videos: videos.status === 'fulfilled' ? videos.value : previous.videos,
        production: production.status === 'fulfilled' ? production.value : previous.production,
        publishes: publishes.status === 'fulfilled' ? publishes.value : previous.publishes,
      }));
      if (!Object.keys(errors).length) setLastUpdated(new Date().toISOString());
    } finally {
      if (loadToken.current === token) loadToken.current = null;
      if (generation === epoch.current) { setLoading(false); setRefreshing(false); }
    }
  }, [user?.id]);

  useEffect(() => {
    epoch.current++;
    loadToken.current = null; actionToken.current = null;
    setSnapshot(emptySnapshot()); setSourceErrors({}); setLastUpdated(null); setBusyTask(null);
    setLoading(!!user); setRefreshing(false);
    setStatusFilter('all'); setKindFilter('all'); setSearch('');
    if (!user) return;
    void load();
    // 定时读取公开业务状态，不依赖 Realtime 是否已加入 publication。
    const timer = setInterval(() => { if (!document.hidden && !actionToken.current) void load(); }, 10000);
    const focus = () => { if (!actionToken.current) void load(); };
    const visibility = () => { if (!document.hidden) focus(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [user?.id, load]);

  const refreshTask = async (task: CenterTask) => {
    if (actionToken.current || loadToken.current) return;
    const token = {}, generation = epoch.current;
    actionToken.current = token; setBusyTask(task.key);
    try {
      if (task.source === 'video') {
        const job = await queryServerVideoJob({ job_id: task.id });
        if (!job || job.id !== task.id) throw new Error('任务查询结果不匹配，请刷新全部核对');
        if (generation !== epoch.current) return;
        setSnapshot(previous => ({ ...previous, videos: previous.videos.map(item => item.id === job.id ? job : item) }));
        window.dispatchEvent(new CustomEvent('credits_changed'));
      } else if (task.source === 'production') {
        const job = await queryProductionJob(task.id);
        if (!job || job.id !== task.id) throw new Error('任务查询结果不匹配，请刷新全部核对');
        if (generation !== epoch.current) return;
        setSnapshot(previous => ({ ...previous, production: previous.production.map(item => item.id === job.id ? job : item) }));
        window.dispatchEvent(new CustomEvent('credits_changed'));
      } else {
        const publishes = await listPlatformPublishTasks();
        if (generation !== epoch.current) return;
        setSnapshot(previous => ({ ...previous, publishes }));
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
    if (!task.canCancel || task.source !== 'publish' || actionToken.current || loadToken.current) return;
    const token = {}, generation = epoch.current;
    actionToken.current = token; setBusyTask(task.key);
    try {
      await cancelPlatformPublishTask(task.id);
      if (generation !== epoch.current) return;
      setSnapshot(previous => ({ ...previous, publishes: previous.publishes.map(item => item.id === task.id ? { ...item, status: 'cancelled' } : item) }));
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><ListTodo aria-hidden="true" className="h-5 w-5 text-primary" />任务中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">查看视频、图片、封面、剪辑和平台发布的后台进度。</p>
        </div>
        <Button variant="outline" disabled={refreshing || !!busyTask || !user} onClick={() => void load()}>
          <RefreshCw aria-hidden="true" className={cn('mr-2 h-4 w-4', refreshing && 'motion-safe:animate-spin')} />
          {refreshing ? '正在刷新…' : '刷新全部'}
        </Button>
      </div>
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
        当前展示各来源最近返回的任务，页面打开时每10秒更新。临时查询或归档故障由后台重试。
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
