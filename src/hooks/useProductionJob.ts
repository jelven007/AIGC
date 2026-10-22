import { useCallback, useEffect, useRef, useState } from 'react';
import { createProductionJob, listProductionJobs, productionRequest, queryProductionJob, ProductionJobError, type ProductionJob } from '@/api/productionJobs';
import { canonicalMediaTree } from '@/lib/privateMedia';
import { toast } from 'sonner';
const active = (job: ProductionJob) => ['pending', 'running'].includes(job.status);
export function useProductionJob(kind: 'image' | 'render', userId?: string, projectId?: string | null) {
  const [job, setJob] = useState<ProductionJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const receipt = useRef<{ request_key: string; input: unknown; project_id?: string } | null>(null);
  const generation = useRef(0);
  const scope = useRef(0), startLock = useRef(false);
  const key = `shopro:production:${userId}:${kind}:${projectId || 'workbench'}`;
  const saveReceipt = useCallback((value: typeof receipt.current) => {
    receipt.current = value;
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch {}
  }, [key]);
  useEffect(() => {
    scope.current++;
    startLock.current = false; setSubmitting(false);
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    setJob(null); setError('');
    try { receipt.current = JSON.parse(localStorage.getItem(key) || 'null'); } catch { receipt.current = null; }
    const restore = async () => {
      if (!userId || stopped) return;
      const revision = generation.current;
      try {
        let current: ProductionJob | undefined;
        if (receipt.current) {
          const original = receipt.current;
          try { current = (await productionRequest({ action: 'query', request_key: original.request_key }, userId)).job; }
          catch (cause) {
            if (!(cause instanceof ProductionJobError) || cause.status !== 404) throw cause;
            // 始终复用原请求，服务端唯一约束防止重复生成。
            current = await createProductionJob(kind, original.request_key, original.input, original.project_id, userId);
          }
        } else current = (await listProductionJobs(userId)).find(item => item.kind === kind
          && (projectId ? item.project_id === projectId : item.project_id === null || kind === 'render')
          && (active(item) || ['completed', 'unknown'].includes(item.status)));
        if (stopped) return;
        if (revision !== generation.current) { timer = setTimeout(restore, 10000); return; }
        if (current) {
          setJob(current); setError('');
          if (!active(current)) saveReceipt(null);
        }
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : '任务恢复失败');
          if (e instanceof ProductionJobError && [400, 401, 402, 403, 409, 429].includes(e.status)) saveReceipt(null);
        }
      }
      if (!stopped) timer = setTimeout(restore, 10000);
    };
    void restore();
    return () => { stopped = true; scope.current++; clearTimeout(timer); };
  }, [userId, kind, projectId, key, saveReceipt]);
  const start = async (input: unknown, targetProjectId?: string) => {
    if (!userId || startLock.current) return false;
    if (job && (active(job) || job.status === 'unknown') || receipt.current) { toast.info('已有任务待确认，正在恢复'); return false; }
    generation.current++;
    const currentScope = scope.current;
    startLock.current = true;
    setSubmitting(true); setError('');
    const original = receipt.current || { request_key: crypto.randomUUID(), input: canonicalMediaTree(input), project_id: targetProjectId };
    saveReceipt(original);
    try {
      const current = await createProductionJob(kind, original.request_key, original.input, original.project_id, userId);
      if (scope.current !== currentScope) return false;
      setJob(current); toast.info('任务已保存，关闭页面后仍会继续处理');
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
      const latest = await queryProductionJob(job.id, userId);
      if (scope.current === currentScope) { setJob(latest); setError(''); }
    } catch (cause) {
      if (scope.current === currentScope) setError(cause instanceof Error ? cause.message : '进度刷新失败，请重试');
    }
  };
  return { job, start, refresh, submitting, error, generating: submitting || !!job && active(job) };
}
