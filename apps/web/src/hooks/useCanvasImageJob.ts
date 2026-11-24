import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasImageTask } from '@/lib/canvasImageTask';
import type { CanvasDocument } from '@/types/canvas';
import type { ProductionJob } from '@/api/productionJobs';

const terminal = (job: ProductionJob) => ['completed', 'failed', 'cancelled'].includes(job.status);
export function useCanvasImageJob(userId: string, canvasId: string, initial: CanvasDocument,
  onJob: (nodeId: string, job: ProductionJob) => Promise<void>) {
  const controller = useRef<CanvasImageTask | null>(null), active = useRef(false);
  const apply = useRef(onJob); apply.current = onJob;
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    active.current = true;
    try {
      const task = new CanvasImageTask(userId, canvasId, abort.signal);
      const pending = initial.nodes.find(n => n.data.task && ['pending', 'running', 'unknown'].includes(n.data.task.status));
      if (pending) task.adopt(pending.id, pending.data.task!);
      controller.current = task;
      setNodeId(task.receipt?.nodeId || null); setBusy(!!task.receipt); setPoll(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '图片任务恢复失败'); }
    return () => { active.current = false; abort.abort(); controller.current = null; };
  }, [userId, canvasId]);
  const accept = useCallback(async (job: ProductionJob) => {
    const task = controller.current;
    if (!task?.receipt || !active.current) return;
    await apply.current(task.receipt.nodeId, job);
    if (!active.current || controller.current !== task) return;
    if (terminal(job)) { task.finish(); setBusy(false); setNodeId(null); }
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    const task = controller.current;
    if (!task?.receipt) return;
    try {
      const job = await task.restore();
      if (job && active.current && controller.current === task) await accept(job);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '任务进度读取失败，请重试'); }
  }, [accept]);
  useEffect(() => {
    if (!controller.current?.receipt) return;
    let timer: ReturnType<typeof setTimeout> | undefined, cancelled = false;
    const check = async () => {
      if (!document.hidden) await refresh();
      if (!cancelled && controller.current?.receipt) timer = setTimeout(check, 5000);
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [poll, refresh]);
  const start = async (id: string, input: Record<string, unknown>) => {
    const task = controller.current;
    if (!task || busy || task.receipt) { setError('画布已有图片任务待确认，请先刷新进度'); return; }
    setBusy(true); setNodeId(id); setError('');
    try {
      const job = await task.start(id, input);
      if (active.current && controller.current === task) await accept(job);
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : '图片请求结果待确认');
        if (!task.receipt) { setBusy(false); setNodeId(null); }
      }
    } finally { if (active.current) setPoll(value => value + 1); }
  };
  return { busy, nodeId, error, start, refresh, pending: () => controller.current?.receipt };
}
