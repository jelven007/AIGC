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
  const key = `shopro:production:${userId}:${kind}:${projectId || 'workbench'}`;
  const saveReceipt = useCallback((value: typeof receipt.current) => {
    receipt.current = value;
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch {}
  }, [key]);
  useEffect(() => {
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
          try { current = (await productionRequest({ action: 'query', request_key: original.request_key })).job; }
          catch (cause) {
            if (!(cause instanceof ProductionJobError) || cause.status !== 404) throw cause;
            // 始终复用原请求，服务端唯一约束防止重复生成。
            current = await createProductionJob(kind, original.request_key, original.input, original.project_id);
          }
        } else current = (await listProductionJobs()).find(item => item.kind === kind
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
          if (e instanceof ProductionJobError && [400, 401, 402, 409].includes(e.status)) saveReceipt(null);
        }
      }
      if (!stopped) timer = setTimeout(restore, 10000);
    };
    void restore();
    return () => { stopped = true; clearTimeout(timer); };
  }, [userId, kind, projectId, key, saveReceipt]);
  const start = async (input: unknown, targetProjectId?: string) => {
    if (!userId || submitting) return false;
    if (job && (active(job) || job.status === 'unknown') || receipt.current) { toast.info('已有任务待确认，正在恢复'); return false; }
    generation.current++;
    setSubmitting(true); setError('');
    const original = receipt.current || { request_key: crypto.randomUUID(), input: canonicalMediaTree(input), project_id: targetProjectId };
    saveReceipt(original);
    try {
      const current = await createProductionJob(kind, original.request_key, original.input, original.project_id);
      setJob(current); toast.info('任务已保存，关闭页面后仍会继续处理');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交结果待确认');
      if (e instanceof ProductionJobError && [400, 401, 402, 409].includes(e.status)) saveReceipt(null);
      return false;
    }
    finally { setSubmitting(false); }
  };
  const refresh = async () => { if (job) setJob(await queryProductionJob(job.id)); };
  return { job, start, refresh, submitting, error, generating: submitting || !!job && active(job) };
}
