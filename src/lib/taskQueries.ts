import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { listProductionJobs, productionRequest, type ProductionJob } from '@/api/productionJobs';
import { listServerVideoJobs, type ServerVideoJob } from '@/api/videoJobs';
import { listPlatformPublishRecords, type PlatformPublishTask, type PublishRecords } from '@/api/platforms';

export type TaskFamily = 'production' | 'video' | 'publish' | 'batch';
export type TaskReference = { job_id: string } | { request_key: string };
type TaskRecord = Omit<ProductionJob, 'result'> & { result: unknown } | ServerVideoJob | PlatformPublishTask;
export const taskListKey = (family: TaskFamily, userId?: string) => ['tasks', userId, family, 'list'] as const;
export const taskDetailKey = (family: TaskFamily, userId: string | undefined, reference: TaskReference) =>
  ['tasks', userId, family, 'detail', 'job_id' in reference ? 'id' : 'request', Object.values(reference)[0]] as const;
export function taskListOptions(family: 'production', userId?: string): ReturnType<typeof productionList>;
export function taskListOptions(family: 'video', userId?: string): ReturnType<typeof videoList>;
export function taskListOptions(family: 'publish', userId?: string): ReturnType<typeof publishList>;
export function taskListOptions(family: TaskFamily, userId?: string) {
  return family === 'production' ? productionList(userId) : family === 'video' ? videoList(userId) : publishList(userId);
}
const validated = <T,>(value: T[]): T[] => {
  if (!Array.isArray(value)) throw new Error('任务服务返回格式无效，请检查后端版本');
  return value;
};
const productionList = (userId?: string) => ({ queryKey: taskListKey('production', userId),
  queryFn: async ({ signal }: { signal: AbortSignal }) => validated(await listProductionJobs(userId, signal)) });
const videoList = (userId?: string) => ({ queryKey: taskListKey('video', userId),
  queryFn: async ({ signal }: { signal: AbortSignal }) => validated(await listServerVideoJobs(userId, signal)) });
const publishList = (userId?: string) => ({ queryKey: taskListKey('publish', userId),
  queryFn: ({ signal }: { signal: AbortSignal }) => listPlatformPublishRecords(userId, signal) });
/** 领域最近记录须独立读取，不能从全局最近30条过滤而遗漏该领域旧任务。 */
export const productionKindsOptions = (kinds: string[], userId?: string) => ({
  queryKey: [...taskListKey('production', userId), [...kinds].sort()] as const,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ProductionJob[]> =>
    validated((await productionRequest({ action: 'list', kinds: [...kinds].sort() }, userId, signal)).jobs),
});

/** 未知受理仍核对原任务，完成/失败/取消不自动读；查询错误30秒后重试。 */
export function taskPollDelay(data: unknown, error: unknown, visible: boolean, family: TaskFamily): number | false {
  if (!visible) return false;
  if (error) return 30000;
  const top = Array.isArray(data) ? data : data ? [data] : [];
  const records = top.flatMap(item => Array.isArray(item.jobs) ? item.jobs : Array.isArray(item.tasks) ? item.tasks : [item]);
  if (records.some(item => ['pending', 'running', 'processing', 'draft', 'scheduled', 'publishing', 'submitted', 'moderating']
    .includes(item.status) && !(family === 'video' && item.submission_state === 'unknown')
    || family === 'batch' && item.status === 'cancelling')) return 10000;
  if (records.some(item => item.status === 'unknown' || family === 'video' && item.submission_state === 'unknown'
    || item.revoked_at && !item.provider_deleted_at || family === 'batch' && item.items?.some((child: any) =>
      child.submission_state === 'unknown' || child.status === 'unknown' || child.stages?.some((stage: any) => stage.status === 'unknown')))) return 30000;
  const monitors = top.flatMap(item => item.targets || []).filter(item => item.monitoring);
  if (monitors.length) return Math.min(300000, Math.max(30000, Math.min(...monitors.map(item =>
    Math.max(0, Date.parse(item.next_run_at || '') - Date.now()) || 30000))));
  return false;
}
export function rememberTask(client: QueryClient, family: TaskFamily, userId: string, job: TaskRecord) {
  client.setQueryData(taskDetailKey(family, userId, { job_id: job.id }), job);
  if ('request_key' in job && job.request_key) client.setQueryData(taskDetailKey(family, userId, { request_key: job.request_key }), job);
  if (family === 'publish') {
    client.setQueryData<PublishRecords>(taskListKey(family, userId), previous => previous ? {
      tasks: [job as PlatformPublishTask, ...previous.tasks.filter(item => item.id !== job.id)],
      groups: previous.groups.map(group => ({ ...group,
        tasks: group.tasks.map(item => item.id === job.id ? job as PlatformPublishTask : item) })),
    } : undefined);
    return;
  }
  client.setQueriesData<TaskRecord[]>({ queryKey: taskListKey(family, userId),
    predicate: query => !Array.isArray(query.queryKey[4]) || 'kind' in job && query.queryKey[4].includes(job.kind) },
  previous => previous ? [job, ...previous.filter(item => item.id !== job.id)] : undefined);
}

type ReadOptions = { queryKey: QueryKey; queryFn: (context: { signal: AbortSignal }) => Promise<unknown> };
const watchers = new WeakMap<QueryClient, Map<string, { count: number; stop: () => void }>>();
/** 一个QueryClient/cache key只持一个计时器；错时挂载的面板也不各自轮询。 */
export function watchTaskQuery(client: QueryClient, options: ReadOptions, family: TaskFamily) {
  let entries = watchers.get(client);
  if (!entries) { entries = new Map(); watchers.set(client, entries); }
  const hash = JSON.stringify(options.queryKey);
  const existing = entries.get(hash);
  if (existing) {
    existing.count++;
    return () => { if (--existing.count === 0) existing.stop(); };
  }
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const refresh = () => {
    clear();
    if (!stopped && !document.hidden) void client.fetchQuery({ ...options, retry: false, staleTime: 0 }).catch(() => {});
  };
  const schedule = () => {
    clear();
    const state = client.getQueryState(options.queryKey);
    if (stopped || state?.fetchStatus === 'fetching') return;
    const delay = taskPollDelay(state?.data, state?.error, !document.hidden, family);
    if (delay !== false) timer = setTimeout(refresh, delay);
  };
  const visibility = () => {
    if (document.hidden) { clear(); void client.cancelQueries({ queryKey: options.queryKey, exact: true }); }
    else refresh();
  };
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (JSON.stringify(event.query.queryKey) === hash) schedule();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', visibility);
  const entry = { count: 1, stop: () => {
    stopped = true; clear(); unsubscribe(); entries!.delete(hash);
    window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', visibility);
  } };
  entries.set(hash, entry); schedule();
  return () => { if (--entry.count === 0) entry.stop(); };
}
