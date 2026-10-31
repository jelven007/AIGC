import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { createProductionJob, productionRequest, ProductionJobError, type ProductionJob } from '@/api/productionJobs';
import { canonicalMediaTree } from '@/lib/privateMedia';
import type { EditRequest } from '../../../../../supabase/functions/_shared/edit-contract';
import type { EditResult } from '@/lib/editTimeline';
import { taskDetailKey, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';

interface SourceClip {
  id: string; type: string; name: string; url?: string; start: number; duration: number; sourceStart?: number; speed?: number;
}
interface Receipt { request_key: string; input: EditRequest; project_id?: string }
const pending = (job: ProductionJob | null) => !!job && ['pending', 'running', 'unknown'].includes(job.status);
export function EditAnalysisDialog({ mode, onClose, userId, projectKey, tracks, selectedId, onApply, restoreJobId, onRestoreMode }: {
  mode: 'beats' | 'subtitles' | null; onClose: () => void; userId?: string; projectKey: string;
  tracks: SourceClip[]; selectedId: string | null; onApply: (result: EditResult, jobId: string) => Promise<boolean>;
  restoreJobId?: string | null; onRestoreMode: (mode: 'beats' | 'subtitles') => void;
}) {
  const [job, setJob] = useState<ProductionJob | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false), generation = useRef(0), restored = useRef('');
  const client = useQueryClient();
  const key = `shopro:edit-analysis:${userId}:${projectKey}`;
  const saved = useTaskReceipt<Receipt>(userId ? key : '', value => value && typeof value.request_key === 'string'
    && ['beats', 'subtitles'].includes(value.input?.mode) && typeof value.input?.source?.id === 'string');
  const receipt = saved.receipt, write = saved.write, original = saved.value;
  const queryOriginal = restoreJobId && restored.current !== restoreJobId ? null : original;
  const price = useQuery({ queryKey: ['task-prices', userId, 'edit'], enabled: !!userId, retry: false, staleTime: 300000,
    queryFn: async ({ signal }): Promise<Record<string, number>> => (await productionRequest({ action: 'edit-prices' }, userId, signal)).costs });
  const prices = price.data || {};
  const queryId = restoreJobId && restored.current !== restoreJobId ? restoreJobId : job?.id;
  const detail = useTaskQuery(useMemo(() => ({
    queryKey: taskDetailKey('production', userId, queryId ? { job_id: queryId }
      : queryOriginal ? { request_key: queryOriginal.request_key } : { job_id: '' }),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ProductionJob> => {
      let current: ProductionJob;
      try { current = (await productionRequest({ action: 'query', ...(queryId
        ? { job_id: queryId } : { request_key: queryOriginal!.request_key }) }, userId, signal)).job; }
      catch (cause) {
        if (!(cause instanceof ProductionJobError) || cause.status !== 404 || !queryOriginal) throw cause;
        current = await createProductionJob('edit_analysis', queryOriginal.request_key, queryOriginal.input, queryOriginal.project_id, userId, signal);
      }
      if (current.kind !== 'edit_analysis' || !current.edit_request || !current.edit_mode) throw new Error('原剪辑分析不存在');
      return current;
    },
  }), [userId, queryOriginal, queryId]), 'production', !!userId && !!(queryOriginal || queryId) && !busy);
  const problem = saved.error || error || detail.error?.message || price.error?.message;
  const sources = tracks.filter(track => ['video', 'audio'].includes(track.type) && track.url && track.duration >= .1);
  useEffect(() => {
    if (mode) setSourceId(receipt.current?.input.mode === mode ? receipt.current.input.source.id
      : selectedId && sources.some(track => track.id === selectedId) ? selectedId : sources[0]?.id || '');
  }, [mode, selectedId]);
  useEffect(() => {
    if (mode) setSourceId(current => current || sources[0]?.id || '');
  }, [mode, tracks]);
  useEffect(() => {
    generation.current++; locked.current = false;
    restored.current = ''; setJob(null); setError(''); setBusy(false);
    return () => { generation.current++; };
  }, [key, restoreJobId]);
  useEffect(() => {
    const current = detail.data;
    if (!current || !userId || busy) return;
    setJob(current); setError(''); rememberTask(client, 'production', userId, current);
    if (restoreJobId && restored.current !== restoreJobId) {
      restored.current = restoreJobId;
      if (receipt.current?.request_key !== current.request_key) write({ request_key: current.request_key, input: canonicalMediaTree(current.edit_request!),
        project_id: current.project_id || undefined });
      setSourceId(current.edit_request!.source.id); onRestoreMode(current.edit_mode!);
    }
  }, [detail.data, userId, busy, client, restoreJobId, write, onRestoreMode]);
  const submit = async () => {
    if (!mode || !userId || locked.current || saved.error || pending(job) || receipt.current && !job) return;
    const source = sources.find(track => track.id === sourceId);
    if (!source?.url || !['video', 'audio'].includes(source.type) || !Number.isInteger(prices[mode])) return;
    const original: Receipt = { request_key: crypto.randomUUID(), project_id: projectKey === 'draft' ? undefined : projectKey, input: canonicalMediaTree({
      mode, title: source.name.slice(0, 80), source: { id: source.id, type: source.type as 'video' | 'audio', url: source.url,
        start: source.start, duration: source.duration, sourceStart: source.sourceStart ?? 0, speed: source.speed ?? 1 },
      confirmed_credit_cost: prices[mode],
    }) };
    const revision = generation.current;
    if (!write(original)) return;
    locked.current = true; setBusy(true); setError(''); setJob(null);
    try {
      const current = await createProductionJob('edit_analysis', original.request_key, original.input, original.project_id, userId);
      if (revision !== generation.current) return;
      setJob(current); rememberTask(client, 'production', userId, current); toast.info('分析已保存，关闭页面后仍会继续');
    } catch (cause) {
      if (revision !== generation.current) return;
      setError(cause instanceof Error ? cause.message : '创建结果待确认，正在恢复原请求');
      if (cause instanceof ProductionJobError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) write(null);
    } finally { if (revision === generation.current) { locked.current = false; setBusy(false); } }
  };
  const apply = async () => {
    if (!job?.result || job.status !== 'completed' || locked.current) return;
    const revision = generation.current;
    locked.current = true; setBusy(true); setError('');
    try {
      if (await onApply(job.result as EditResult, job.id) && revision === generation.current) toast.success('分析结果已应用并保存到工程');
    } catch (cause) { if (revision === generation.current) setError(cause instanceof Error ? cause.message : '结果应用失败'); }
    finally { if (revision === generation.current) { locked.current = false; setBusy(false); } }
  };
  return <Dialog open={!!mode} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700 text-zinc-100">
      <DialogHeader><DialogTitle>{mode === 'beats' ? '真实音轨卡点' : '时间分段字幕'}</DialogTitle>
      <DialogDescription className="text-sm text-zinc-400">{mode === 'beats'
        ? '检测所选音轨的实际节拍，在节拍处切分主视频。带关键帧或淡变的片段保留供手动剪辑。'
        : '识别所选片段裁剪、变速后的声音，按供应商时间戳添加字幕。无分段结果时不会按固定时长生成字幕。'}</DialogDescription></DialogHeader>
      <label className="text-sm">分析源片段
        <select aria-label="分析源片段" value={sourceId} onChange={event => setSourceId(event.target.value)}
          disabled={busy || pending(job)} className="mt-2 w-full rounded border border-zinc-600 bg-zinc-800 p-2">
          <option value="">选择已上传的音频或视频</option>
          {sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.duration.toFixed(2)}秒</option>)}
        </select>
      </label>
      <p className="text-sm text-zinc-400">本次价格：{mode && Number.isInteger(prices[mode]) ? `${prices[mode]} 积分` : '读取中…'} · 最多10分钟</p>
      {job && <div className="rounded border border-zinc-700 p-3 text-sm space-y-2 break-words" aria-live="polite">
        <p>原任务：{job.status === 'completed' ? '已完成' : job.status === 'failed' ? '失败' : job.status === 'unknown' ? '受理待核对' : `处理中 ${job.progress}%`}</p>
        <p className="text-xs text-zinc-400">请求标识：{job.request_key}</p>
        {job.kind === 'edit_analysis' && job.edit_source && <p className="text-xs text-zinc-400">
          原片段：{job.edit_request?.title || '已分析片段'} · 裁剪起点 {job.edit_source.sourceStart}秒 · 速度 {job.edit_source.speed}倍
        </p>}
        {job.result?.beats && <p>检测到 {job.result.beats.length} 个节拍 · BPM {job.result.bpm ?? '间隔不稳定，未估计'}</p>}
        {job.result?.segments && <p>{job.result.segments.length} 条真实分段字幕</p>}
        {job.error_message && <p className="text-amber-300">{job.error_message}</p>}
      </div>}
      {problem && <p role="alert" className="text-sm text-amber-300">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy || !!saved.error || pending(job) || !!receipt.current && !job || !sourceId || !mode || !Number.isInteger(prices[mode])}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认价格并分析
        </Button>
        {job?.status === 'completed' && job.result && !job.result.media_deleted && <Button onClick={apply} disabled={busy}>
          应用原任务结果并保存
        </Button>}
        <Button variant="ghost" onClick={onClose}>关闭</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
