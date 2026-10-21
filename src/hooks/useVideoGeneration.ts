import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createServerVideoJob, queryServerVideoJob, listServerVideoJobs, uploadVideoReference, VideoJobError,
  type ServerVideoJob, type VideoJobInput,
} from '@/api/videoJobs';
import { openCreditsDialog } from '@/lib/creditGuard';
import { toast } from 'sonner';

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
  const [restoring, setRestoring] = useState(true);
  const [visible, setVisible] = useState(true);
  const [queryError, setQueryError] = useState(false);
  const [resultVideo, setResultVideo] = useState<string | null>(null);
  const receipt = useRef<Receipt | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const [receiptVersion, setReceiptVersion] = useState(0);

  const saveReceipt = useCallback((value: Receipt | null) => {
    receipt.current = value;
    if (userId) {
      try {
        if (value) localStorage.setItem(storageKey(userId), JSON.stringify(value));
        else localStorage.removeItem(storageKey(userId));
      } catch { /* 服务端 list 仍可找回持久化任务 */ }
    }
    setReceiptVersion(v => v + 1);
  }, [userId]);

  const applyJob = useCallback((current: ServerVideoJob) => {
    setJob(current);
    setQueryError(false);
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
  }, [saveReceipt]);

  useEffect(() => {
    const epoch = ++generation.current;
    busy.current = false;
    receipt.current = null;
    setJob(null); setResultVideo(null); setSubmitting(false); setVisible(true); setQueryError(false);
    setRestoring(true);
    if (!userId) { setRestoring(false); return; }
    try {
      const saved = localStorage.getItem(storageKey(userId));
      if (saved) receipt.current = JSON.parse(saved);
    } catch { /* 从服务端恢复 */ }
    setReceiptVersion(v => v + 1);
    if (!receipt.current) {
      listServerVideoJobs().then(jobs => {
        if (generation.current !== epoch || receipt.current) return;
        const current = jobs.find(active);
        if (current) { setJob(current); saveReceipt({ job_id: current.id }); }
      }).catch(() => { /* 未部署时允许显示表单，创建 API 会明确报错 */ })
        .finally(() => { if (generation.current === epoch) setRestoring(false); });
    } else setRestoring(false);
    return () => { generation.current++; };
  }, [userId, saveReceipt]);

  useEffect(() => {
    if (!userId || !receipt.current) return;
    const epoch = generation.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || generation.current !== epoch || !receipt.current) return;
      if (busy.current) { timer = setTimeout(poll, 1000); return; }
      const current = receipt.current;
      try {
        let response;
        try {
          response = await queryServerVideoJob(current.job_id
            ? { job_id: current.job_id } : { request_key: current.request_key! });
        } catch (cause) {
          if (!(cause instanceof VideoJobError) || cause.status !== 404) throw cause;
          if (stopped || generation.current !== epoch) return;
          if (!current.request_key || !current.input || !current.provider) {
            if (!stopped) saveReceipt(null);
            return;
          }
          // 创建响应丢失且 DB 未找到时仍复用完整原请求，不产生第二次扣费。
          response = await createServerVideoJob(current.provider, current.request_key, current.input);
        }
        if (!stopped && generation.current === epoch) {
          applyJob(response);
          if (!active(response)) return;
        }
      } catch (cause) {
        if (!stopped && generation.current === epoch) {
          if (cause instanceof VideoJobError && [400, 401, 402, 409].includes(cause.status)) {
            saveReceipt(null);
            toast.error(cause.message);
            if (cause.status === 402) openCreditsDialog();
            return;
          }
          setQueryError(true);
        }
      }
      if (!stopped) timer = setTimeout(poll, 10_000);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [userId, receiptVersion, applyJob, saveReceipt]);

  const generate = async (provider: string, raw: VideoJobInput) => {
    if (!userId) { toast.error('请先登录后生成视频'); return; }
    if (restoring) { toast.info('正在恢复已有任务，请稍候'); return; }
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
      saveReceipt({ request_key: requestKey, provider, input });
      sent = true;
      const response = await createServerVideoJob(provider, requestKey, input);
      if (generation.current !== epoch) return;
      applyJob(response);
      if (active(response)) toast.info(`任务已排队，预占 ${response.credit_cost} 积分；确定失败将自动退还`);
    } catch (cause) {
      if (generation.current !== epoch) return;
      if (!sent || (cause instanceof VideoJobError && [400, 401, 402, 409].includes(cause.status))) {
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

  const statusText = queryError ? '暂时无法获取进度，正在重新查询'
    : job?.submission_state === 'unknown' ? '提交结果待核对，积分仍保留'
      : job?.needs_attention ? '任务等待核对，将继续查询'
        : job?.submission_state === 'queued' ? '任务已排队，等待生成'
          : job?.submission_state === 'submitting' ? '正在提交生成任务'
            : job?.status === 'completed' ? '视频已生成并保存' : '正在生成视频';
  return {
    generating: submitting || (visible && (!!receipt.current || (!!job && active(job)))),
    taskId: job?.id || null, genProgress: job?.progress || 0, resultVideo,
    statusText, generate, hideProgress: () => setVisible(false), clearResult: () => setResultVideo(null),
  };
}
