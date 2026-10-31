import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createServerVideoJob, queryServerVideoJob, uploadVideoReference, VideoJobError,
  type ServerVideoJob, type VideoJobInput,
} from '@/api/videoJobs';
import { openCreditsDialog } from '@/lib/creditGuard';
import { toast } from 'sonner';
import { taskListOptions, taskDetailKey, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from './useTaskQuery';
import { useTaskReceipt } from './useTaskReceipt';

interface Receipt {
  request_key?: string;
  job_id?: string;
  provider?: string;
  input?: VideoJobInput;
}
const active = (job: ServerVideoJob) => ['pending', 'processing'].includes(job.status);
const storageKey = (userId: string) => `shopro:video-task:${userId}`;

export function useVideoGeneration(userId?: string) {
  const [job, setJob] = useState<ServerVideoJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(true);
  const [queryError, setQueryError] = useState(false);
  const [resultVideo, setResultVideo] = useState<string | null>(null);
  const client = useQueryClient();
  const busy = useRef(false);
  const generation = useRef(0);
  const notified = useRef(new Set<string>());
  const { value: original, receipt, write: saveReceipt, error: storageError } = useTaskReceipt<Receipt>(userId ? storageKey(userId) : '',
    value => value && (typeof value.job_id === 'string' || typeof value.request_key === 'string'
      && typeof value.provider === 'string' && value.input && typeof value.input === 'object'));
  const list = useTaskQuery(useMemo(() => taskListOptions('video', userId), [userId]), 'video', !!userId && !original && !job);
  const detail = useTaskQuery(useMemo(() => ({
    queryKey: taskDetailKey('video', userId, original?.request_key && !job?.id ? { request_key: original.request_key }
      : { job_id: original?.job_id || job?.id || '' }),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const reference = original?.job_id || job?.id;
      try { return await queryServerVideoJob(reference ? { job_id: reference } : { request_key: original!.request_key! }, userId, signal); }
      catch (cause) {
        if (!(cause instanceof VideoJobError) || cause.status !== 404 || !original?.request_key || !original.input || !original.provider) throw cause;
        return createServerVideoJob(original.provider, original.request_key, original.input, userId, signal);
      }
    },
  }), [userId, original, job?.id]), 'video', !!userId && !!(original || job) && !submitting);
  const restoring = !!userId && !original && !job && list.isPending;

  const applyJob = useCallback((current: ServerVideoJob) => {
    setJob(current);
    setQueryError(false);
    if (userId) rememberTask(client, 'video', userId, current);
    const token = `${current.id}:${current.status}`;
    if (!active(current) && notified.current.has(token)) return;
    if (!active(current)) notified.current.add(token);
    if (current.status === 'completed') {
      setResultVideo(current.video_url);
      saveReceipt(null);
      window.dispatchEvent(new CustomEvent('shopro:works-updated'));
      window.dispatchEvent(new CustomEvent('credits_changed'));
      toast.success('视频生成完成，已保存至作品库');
    } else if (current.status === 'failed' || current.status === 'cancelled') {
      saveReceipt(null);
      window.dispatchEvent(new CustomEvent('credits_changed'));
      toast.error(`${current.error_message || (current.status === 'cancelled' ? '任务已取消' : '视频生成失败')}${current.billing_state === 'refunded'
        ? `，已退还 ${current.credit_cost} 积分` : '，积分处理中'}`, { duration: 6000 });
    }
  }, [saveReceipt, client, userId]);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    notified.current.clear();
    setJob(null); setResultVideo(null); setSubmitting(false); setVisible(true); setQueryError(false);
    return () => { generation.current++; };
  }, [userId]);
  useEffect(() => {
    if (original || job || submitting) return;
    const current = list.data?.find(active);
    if (current) { setJob(current); saveReceipt({ job_id: current.id }); }
  }, [list.data, original, job, submitting, saveReceipt]);
  useEffect(() => { if (detail.data && !submitting) applyJob(detail.data); }, [detail.data, applyJob, submitting]);
  useEffect(() => {
    const cause = detail.error;
    if (original && cause instanceof VideoJobError && ([400, 401, 402, 403, 409, 429].includes(cause.status)
      || cause.status === 404 && !original.request_key)) {
      saveReceipt(null); toast.error(cause.message);
      if (cause.status === 402) openCreditsDialog();
    }
  }, [detail.error, original, saveReceipt]);

  const generate = async (provider: string, raw: VideoJobInput) => {
    if (!userId) { toast.error('请先登录后生成视频'); return; }
    if (storageError) { toast.error(storageError); return; }
    if (restoring) { toast.info('正在恢复已有任务，请稍候'); return; }
    if (!job && list.error) { toast.error('原任务尚未核对，请先刷新任务中心'); return; }
    if (busy.current) return;
    if (receipt.current) {
      setVisible(true);
      toast.info('已有任务正在处理，已恢复进度');
      return;
    }
    if (!['ArkSeedance', 'MiniMax', 'SeedanceMini', 'Wan3', 'HappyHorse', 'Kling', 'Seedance'].includes(provider)) {
      toast.error('该模型尚未接入服务端任务，请选择已接入模型');
      return;
    }
    const epoch = generation.current;
    busy.current = true; setSubmitting(true); setVisible(true); setResultVideo(null);
    let sent = false;
    try {
      // 先串行上传，全部成功后才创建任务、预占积分。
      const input: VideoJobInput = {
        ...raw,
        first_frame: await uploadVideoReference(raw.first_frame || null, userId),
        last_frame: await uploadVideoReference(raw.last_frame || null, userId),
        reference_images: [], reference_videos: [],
      };
      for (const url of raw.reference_images || []) input.reference_images!.push((await uploadVideoReference(url, userId))!);
      for (const url of raw.reference_videos || []) input.reference_videos!.push((await uploadVideoReference(url, userId))!);
      if (generation.current !== epoch) return;
      const requestKey = crypto.randomUUID();
      // 在发送之前保存完整请求回执；浏览器中断/响应丢失仍可恢复。
      if (!saveReceipt({ request_key: requestKey, provider, input })) return;
      sent = true;
      const response = await createServerVideoJob(provider, requestKey, input, userId);
      if (generation.current !== epoch) return;
      applyJob(response);
      if (active(response)) toast.info(`任务已排队，预占 ${response.credit_cost} 积分；确定失败将自动退还`);
    } catch (cause) {
      if (generation.current !== epoch) return;
      if (!sent || (cause instanceof VideoJobError && [400, 401, 402, 403, 409, 429].includes(cause.status))) {
        saveReceipt(null);
        toast.error(cause instanceof Error ? cause.message : '任务创建失败');
        if (cause instanceof VideoJobError && cause.status === 402) openCreditsDialog();
      } else {
        setQueryError(true);
        toast.info('提交结果正在确认，任务恢复后会自动更新，请勿重复提交');
      }
    } finally {
      if (generation.current === epoch) { busy.current = false; setSubmitting(false); }
    }
  };

  const statusText = storageError || (queryError || detail.error ? '暂时无法获取进度，正在重新查询'
    : job?.submission_state === 'unknown' ? '提交结果待核对，积分仍保留'
      : job?.needs_attention ? '任务等待核对，将继续查询'
        : job?.submission_state === 'queued' ? '任务已排队，等待生成'
          : job?.submission_state === 'submitting' ? '正在提交生成任务'
            : job?.status === 'completed' ? '视频已生成并保存' : '正在生成视频');
  return {
    generating: submitting || (visible && (!!receipt.current || (!!job && active(job)))),
    taskId: job?.id || null, genProgress: job?.progress || 0, resultVideo,
    statusText, generate, hideProgress: () => setVisible(false), clearResult: () => setResultVideo(null),
  };
}
