import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function RecordingDialog({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: (file: File) => Promise<void>;
}) {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'preview' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0), [error, setError] = useState(''), [consent, setConsent] = useState(false);
  const [name, setName] = useState('我的录音'), [preview, setPreview] = useState('');
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const file = useRef<File | null>(null), previewRef = useRef(''), generation = useRef(0), lock = useRef(false);
  const stopTracks = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; };
  useEffect(() => {
    if (!open) {
      generation.current++;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stopTracks(); lock.current = false;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = ''; file.current = null; setPreview(''); setState('idle'); setSeconds(0); setConsent(false); setError('');
    }
    return () => {
      generation.current++;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stopTracks();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [open]);
  const start = async () => {
    if (lock.current || !consent) return;
    lock.current = true; setError(''); setState('requesting');
    const current = generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('此浏览器不支持录音，请使用HTTPS打开或上传本地音频');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported(value));
      const recording = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
      recorder.current = recording; const chunks: Blob[] = []; let bytes = 0, failed = false;
      const started = performance.now();
      const interval = setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        if (current === generation.current) setSeconds(Math.floor(elapsed));
        if (elapsed >= 600 && recording.state === 'recording') recording.stop();
      }, 250);
      recording.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes > 50 * 1024 * 1024) {
          failed = true;
          if (current === generation.current) setError('录音超过50MB，请缩短录音');
          if (recording.state === 'recording') recording.stop();
        }
      };
      recording.onerror = () => {
        failed = true; clearInterval(interval); stopTracks();
        if (current === generation.current) { lock.current = false; setState('idle'); setError('录音设备中断，请检查麦克风'); }
      };
      recording.onstop = () => {
        clearInterval(interval); stopTracks();
        if (current !== generation.current) return;
        lock.current = false;
        if (failed || !bytes) { setState('idle'); if (!failed) setError('未录到声音，请重新开始'); return; }
        const contentType = recording.mimeType.split(';')[0] || 'audio/webm';
        const extension = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
        file.current = new File(chunks, `${name.trim().slice(0, 150) || '我的录音'}.${extension}`, { type: contentType });
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = URL.createObjectURL(file.current); setPreview(previewRef.current); setState('preview');
      };
      recording.start(1000); setSeconds(0); setState('recording');
    } catch (cause) {
      stopTracks();
      if (current === generation.current) {
        lock.current = false; setState('idle');
        setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? '麦克风权限未获允许，请在浏览器中授权后重试'
          : cause instanceof Error ? cause.message : '录音启动失败');
      }
    }
  };
  const save = async () => {
    if (!file.current || lock.current || !consent) return;
    lock.current = true; setState('saving'); setError('');
    try { await onSave(file.current); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '录音上传待确认，请恢复原上传'); setState('preview'); }
    finally { lock.current = false; }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value && state !== 'saving') onClose(); }}>
    <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md max-h-[85vh] overflow-y-auto bg-zinc-900 text-zinc-100 border-zinc-700">
      <DialogHeader><DialogTitle>录制我的音频</DialogTitle>
        <DialogDescription className="text-zinc-400">录音最长10分钟、50MB。先试听，再上传到私有素材库并加入当前时间轴。</DialogDescription></DialogHeader>
      <label className="text-sm">录音名称<input aria-label="录音名称" value={name} maxLength={150}
        disabled={state !== 'idle'} onChange={event => setName(event.target.value)}
        className="mt-2 w-full rounded border border-zinc-700 bg-zinc-800 p-2" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={state === 'recording' || state === 'saving'}
        onChange={event => setConsent(event.target.checked)} className="mt-1" />我拥有录音内容及声音的使用权</label>
      <p role="status" className="text-sm">{state === 'recording' ? `正在录音 ${seconds}秒` : state === 'requesting' ? '正在申请麦克风权限…' : state === 'saving' ? '正在上传并登记录音…' : '准备录音'}</p>
      {preview && <audio aria-label="我的录音预览" controls src={preview} className="w-full" />}
      {error && <p role="alert" className="break-words text-sm text-amber-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {state === 'recording' ? <Button onClick={() => recorder.current?.stop()}><Square className="mr-2 h-4 w-4" />停止录音</Button>
          : <Button disabled={!consent || state === 'requesting' || state === 'saving'} onClick={() => void start()}><Mic className="mr-2 h-4 w-4" />{preview ? '重新录音' : '开始录音'}</Button>}
        {preview && <Button disabled={!consent || state !== 'preview'} onClick={() => void save()}>
          {state === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存录音并加入时间轴</Button>}
        <Button variant="ghost" disabled={state === 'saving'} onClick={onClose}>关闭</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
