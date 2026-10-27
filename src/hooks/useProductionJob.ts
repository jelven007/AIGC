import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createProductionJob, productionRequest, queryProductionJob, ProductionJobError, type ProductionJob } from '@/api/productionJobs';
import { canonicalMediaTree } from '@/lib/privateMedia';
import { taskListOptions, taskDetailKey, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from './useTaskQuery';
import { useTaskReceipt } from './useTaskReceipt';
import { toast } from 'sonner';
const active = (job: ProductionJob) => ['pending', 'running'].includes(job.status);
type Receipt = { request_key: string; input: unknown; project_id?: string };
export function useProductionJob(kind: 'image' | 'render', userId?: string, projectId?: string | null) {
  const [job, setJob] = useState<ProductionJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const scope = useRef(0), startLock = useRef(false);
  const key = `shopro:production:${userId}:${kind}:${projectId || 'workbench'}`;
  const { value: original, receipt, write: saveReceipt, error: storageError } = useTaskReceipt<Receipt>(userId ? key : '',
    value => value && typeof value.request_key === 'string' && 'input' in value);
  const list = useTaskQuery(useMemo(() => taskListOptions('production', userId), [userId]), 'production',
    !!userId && !original && !job);
  const detail = useTaskQuery(useMemo(() => ({
    queryKey: taskDetailKey('production', userId, job ? { job_id: job.id }
      : original ? { request_key: original.request_key } : { job_id: '' }),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ProductionJob> => {
      try {
        if (job) return await queryProductionJob(job.id, userId, signal);
        return (await productionRequest({ action: 'query', request_key: original!.request_key }, userId, signal)).job;
      }
      catch (cause) {
        if (!(cause instanceof ProductionJobError) || cause.status !== 404 || !original) throw cause;
        // 仅原完整回执可补发，同UUID服务端唯一约束保护积分。
        return createProductionJob(kind, original.request_key, original.input, original.project_id, userId, signal);
      }
    },
  }), [userId, original, job?.id, kind]), 'production', !!userId && !!(original || job) && !submitting);
  useEffect(() => {
    scope.current++;
    startLock.current = false; setSubmitting(false);
    setJob(null); setError('');
    return () => { scope.current++; };
  }, [key]);
  useEffect(() => {
    if (original || job || submitting) return;
    const current = list.data?.find(item => item.kind === kind
      && (projectId ? item.project_id === projectId : item.project_id === null || kind === 'render')
      && (active(item) || ['completed', 'unknown'].includes(item.status)));
    if (current) setJob(current);
  }, [list.data, original, job, submitting, kind, projectId]);
  useEffect(() => {
    const current = detail.data;
    if (!current || !userId || submitting) return;
    setJob(current); setError('');
    rememberTask(client, 'production', userId, current);
    if (!active(current) && current.status !== 'unknown' && receipt.current) saveReceipt(null);
  }, [detail.data, client, userId, submitting, saveReceipt]);
  useEffect(() => {
    const cause = detail.error;
    if (original && cause instanceof ProductionJobError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) {
      setError(cause.message); saveReceipt(null);
    }
  }, [detail.error, original, saveReceipt]);
  const start = async (input: unknown, targetProjectId?: string) => {
    if (!userId || startLock.current) return false;
    if (storageError) { setError(storageError); return false; }
    if (!job && (list.isPending || list.error)) { setError('原任务尚未核对，请先刷新任务中心'); return false; }
    if (job && (active(job) || job.status === 'unknown') || receipt.current) { toast.info('已有任务待确认，正在恢复'); return false; }
    const currentScope = scope.current;
    startLock.current = true;
    setSubmitting(true); setError('');
    const request = { request_key: crypto.randomUUID(), input: canonicalMediaTree(input), project_id: targetProjectId };
    if (!saveReceipt(request)) { startLock.current = false; setSubmitting(false); return false; }
    try {
      const current = await createProductionJob(kind, request.request_key, request.input, request.project_id, userId);
      if (scope.current !== currentScope) return false;
      setJob(current); rememberTask(client, 'production', userId, current);
      toast.info('任务已保存，关闭页面后仍会继续处理');
      return true;
    } catch (e) {
      if (scope.current !== currentScope) return false;
      setError(e instanceof Error ? e.message : '提交结果待确认');
      if (e instanceof ProductionJobError && [400, 401, 402, 403, 409, 429].includes(e.status)) saveReceipt(null);
      return false;
    }
    finally { if (scope.current === currentScope) { startLock.current = false; setSubmitting(false); } }
  };
  const refresh = async () => {
    const currentScope = scope.current;
    if (!job) return;
    try {
      const latest = (await detail.refetch({ throwOnError: true })).data;
      if (!latest) return;
      if (scope.current === currentScope) { setJob(latest); setError(''); }
    } catch (cause) {
      if (scope.current === currentScope) setError(cause instanceof Error ? cause.message : '进度刷新失败，请重试');
    }
  };
  return { job, start, refresh, submitting, error: storageError || error || detail.error?.message || list.error?.message || '',
    generating: submitting || !!job && active(job) };
}
