import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AudioRecorder } from '@/lib/audioRecorder';
import { sendDeepSeekStreamRequest, sendStepAudioASR } from '@/lib/sse';
import { requireAccountSession } from '@/api/accountSession';

type Kind = 'video' | 'image';
type Update = (value: string | ((previous: string) => string)) => void;
export function usePromptAssistant(userId: string | undefined, inputs: {
  video: string; image: string; updateVideo: Update; updateImage: Update;
}) {
  const recorder = useMemo(() => new AudioRecorder(), []);
  const live = useRef(inputs); live.current = inputs;
  const active = useRef(false), busy = useRef(false), recordingRef = useRef<Kind | null>(null);
  const [recordingKind, setRecordingKind] = useState<Kind | null>(null);
  const [enhancingKind, setEnhancingKind] = useState<Kind | null>(null);
  const [progress, setProgress] = useState(0), [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; abort.current?.abort(); recorder.cancel(); };
  }, [recorder]);
  const update = (kind: Kind) => kind === 'video' ? live.current.updateVideo : live.current.updateImage;
  const toggleVoice = async (kind: Kind) => {
    if (!userId || busy.current || abort.current) return;
    if (recordingRef.current && recordingRef.current !== kind) { toast.info('请先结束当前录音'); return; }
    busy.current = true;
    try {
      await requireAccountSession(userId);
      if (!active.current) return;
      if (!recordingRef.current) {
        await recorder.start();
        await requireAccountSession(userId);
        if (!active.current) { recorder.cancel(); return; }
        recordingRef.current = kind; setRecordingKind(kind);
        toast.info('录音中，再次点击以停止并识别');
      } else {
        recordingRef.current = null; setRecordingKind(null);
        const { base64, recognizedText } = await recorder.stop();
        await requireAccountSession(userId);
        if (!active.current) return;
        const append = (text: string) => { if (active.current) update(kind)(previous => previous + (previous ? '，' : '') + text.trim()); };
        if (recognizedText.trim()) { append(recognizedText); toast.success('语音识别成功'); return; }
        const controller = new AbortController(); abort.current = controller;
        await sendStepAudioASR({ audioData: base64, expectedUserId: userId, signal: controller.signal,
          onData: append, onComplete: () => { if (active.current) toast.success('语音识别成功'); },
          onError: cause => { if (active.current) setError(cause.message); } });
        if (abort.current === controller) abort.current = null;
      }
    } catch (cause) {
      recorder.cancel(); recordingRef.current = null;
      if (active.current) { setRecordingKind(null); setError(cause instanceof Error ? cause.message : '录音处理失败'); }
    } finally { busy.current = false; }
  };
  const enhance = async (kind: Kind) => {
    const original = live.current[kind];
    if (!original.trim()) { toast.error('请先输入基础描述'); return; }
    if (!userId || abort.current || busy.current || recordingRef.current) return;
    const controller = new AbortController(); abort.current = controller;
    setEnhancingKind(kind); setProgress(0); setError('');
    let text = '', completed = false, failure: Error | null = null;
    try {
      await sendDeepSeekStreamRequest({ expectedUserId: userId,
        messages: [{ role: 'user', content: '请将以下创意描述扩展为清晰、可执行的' + (kind === 'video' ? '视频' : '图片')
          + '提示词，保持商品事实不变，使用中文直接输出画面描述，不添加解释。原文：' + original }],
        max_tokens: kind === 'video' ? 1024 : 512, signal: controller.signal,
        onData: chunk => { if (active.current && !controller.signal.aborted) { text += chunk; update(kind)(text); setProgress(text.length); } },
        onComplete: () => { completed = true; }, onError: cause => { failure = cause; },
      });
      if (!active.current || controller.signal.aborted) return;
      if (failure) throw failure;
      if (!completed || !text.trim()) throw new Error('提示词结果未完成，请重试');
      toast.success(kind === 'video' ? '提示词已增强' : '图片提示词已增强');
    } catch (cause) {
      if (active.current && !controller.signal.aborted) { update(kind)(original); setError(cause instanceof Error ? cause.message : '提示词增强失败'); }
    } finally {
      if (abort.current === controller) abort.current = null;
      if (active.current) { setEnhancingKind(null); setProgress(0); }
    }
  };
  return { recordingKind, enhancingKind, progress, error, toggleVoice, enhance };
}
