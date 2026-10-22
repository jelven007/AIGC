import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { mediaPreview } from '@/api/media';
import { readMediaDuration } from '@/api/materialAssets';
import type { TrackItem } from '@/pages/VideoEditPage';
import { toast } from 'sonner';

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export function EditorAudioPanel({ tracks, setTracks, selectedId, currentTime, onRecord }: {
  tracks: TrackItem[]; setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  selectedId: string | null; currentTime: number; onRecord: () => void;
}) {
  const sources = tracks.filter(item => ['audio', 'video'].includes(item.type) && item.url);
  const [id, setId] = useState(selectedId || ''), [peaks, setPeaks] = useState<number[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const item = sources.find(source => source.id === id) || sources[0];
  useEffect(() => { if (sources.some(source => source.id === selectedId)) setId(selectedId!); }, [selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false, context: AudioContext | null = null;
    setPeaks([]); setError('');
    if (!item?.url) { setLoading(false); return; }
    const read = async () => {
      setLoading(true);
      const url = await mediaPreview(item.url!);
      if (await readMediaDuration(url, item.type === 'video' ? 'video' : 'audio') > 600) throw new Error('波形预览支持不超过10分钟的源文件，可先裁剪并重新上传');
      if (stopped) return;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('波形需使用不超过50MB的可读音轨');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 50 * 1024 * 1024) { await reader.cancel(); throw new Error('波形音轨超过50MB'); }
        chunks.push(chunk.value);
      }
      if (stopped) return;
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      context = new AudioContext();
      const decoded = await context.decodeAudioData(bytes.buffer);
      const data = decoded.getChannelData(0), result: number[] = [];
      const begin = Math.floor((item.sourceStart || 0) * decoded.sampleRate);
      const length = Math.floor(item.duration * (item.speed || 1) * decoded.sampleRate);
      for (let bucket = 0; bucket < 60; bucket++) {
        const start = begin + Math.floor(bucket * length / 60), end = Math.min(data.length, begin + Math.floor((bucket + 1) * length / 60));
        let peak = 0; for (let position = start; position < end; position++) peak = Math.max(peak, Math.abs(data[position]));
        result.push(peak);
      }
      if (!stopped) setPeaks(result);
    };
    void read().catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : '波形读取失败'); })
      .finally(() => { if (context?.state !== 'closed') void context?.close().catch(() => {}); if (!stopped) setLoading(false); });
    return () => { stopped = true; controller.abort(); if (context?.state !== 'closed') void context?.close().catch(() => {}); };
  }, [item?.id, item?.url, item?.sourceStart, item?.duration, item?.speed]);
  const update = (values: Partial<TrackItem>) => {
    if (item) setTracks(previous => previous.map(track => track.id === item.id ? { ...track, ...values } : track));
  };
  return <ScrollArea className="h-full"><div className="space-y-4 p-3 text-sm text-zinc-200">
    <Button className="w-full" onClick={onRecord}>录制我的音频</Button>
    {!item ? <p className="text-zinc-400">先上传音频、录音，或选择带原声的视频片段。</p> : <>
      <label className="block">编辑音轨<select aria-label="编辑音轨" value={item.id} onChange={event => setId(event.target.value)}
        className="mt-2 w-full rounded border border-zinc-700 bg-zinc-800 p-2">
        {sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <p className="text-xs text-zinc-400">参数即时写入所选片段，保存工程后可恢复。均衡器可试听；变调、机器人和回声以导出成片为准。</p>
      <div aria-label="所选片段实际波形" className="flex h-16 items-center gap-px rounded border border-zinc-700 bg-zinc-950 p-2">
        {loading ? <p role="status" className="text-xs text-zinc-400">读取实际音轨波形…</p> : peaks.length
          ? peaks.map((peak, index) => <span key={index} className="flex-1 bg-emerald-400" style={{ height: `${Math.max(1, peak * 48)}px` }} />)
          : <p className="text-xs text-zinc-400">波形未读取</p>}
      </div>
      {error && <p role="status" className="text-xs text-amber-300">{error}</p>}
      {([{ key: 'volume', label: '音量', value: item.volume ?? 100, min: 0, max: 200, step: 1 },
        { key: 'speed', label: '播放速度', value: item.speed ?? 1, min: .25, max: 4, step: .05 },
        { key: 'fadeIn', label: '淡入秒数', value: item.fadeIn ?? 0, min: 0, max: Math.min(5, item.duration), step: .1 },
        { key: 'fadeOut', label: '淡出秒数', value: item.fadeOut ?? 0, min: 0, max: Math.min(5, item.duration), step: .1 },
        { key: 'pitch', label: '音调半音', value: item.pitch ?? 0, min: -12, max: 12, step: 1 },
        { key: 'pan', label: '左右平衡', value: item.pan ?? 0, min: -100, max: 100, step: 5 },
        { key: 'echo', label: '回声强度', value: item.echo ?? 0, min: 0, max: 100, step: 1 }] as const).map(control =>
        <label key={control.key} className="flex items-center justify-between gap-2">{control.label}
          <input type="number" aria-label={control.label} min={control.min} max={control.max} step={control.step} value={control.value}
            className="w-24 rounded border border-zinc-700 bg-zinc-800 p-1.5"
            onChange={event => { const value = Number(event.target.value); if (event.target.value && Number.isFinite(value)
              && value >= control.min && value <= control.max) update({ [control.key]: value }); }} /></label>)}
      <label className="flex gap-2"><input type="checkbox" checked={!!item.mute} onChange={event => update({ mute: event.target.checked })} />静音</label>
      <label className="block">降噪<select aria-label="降噪" value={item.denoise || '无降噪'}
        onChange={event => update({ denoise: event.target.value })} className="ml-2 rounded border border-zinc-700 bg-zinc-800 p-1.5">
        {['无降噪', '轻度去噪', '深度纯音'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="block">混响<select aria-label="混响" value={item.reverb || '原声纯净'}
        onChange={event => update({ reverb: event.target.value })} className="ml-2 rounded border border-zinc-700 bg-zinc-800 p-1.5">
        {['原声纯净', '录音棚', 'KTV沉浸', '大厅空间', '广播电台', '温暖剧场'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="flex gap-2"><input type="checkbox" checked={item.voiceEffect === 'robot'}
        onChange={event => update({ voiceEffect: event.target.checked ? 'robot' : 'none' })} />机器人调制</label>
      <fieldset className="space-y-2 border-t border-zinc-700 pt-3"><legend>均衡器 EQ（dB）</legend>
        {EQ_FREQUENCIES.map(frequency => <label key={frequency} className="flex items-center justify-between">{frequency}Hz
          <input type="number" aria-label={`均衡器${frequency}Hz`} min={-12} max={12} step={1}
            value={item.eqBands?.[frequency] ?? 0} className="w-24 rounded border border-zinc-700 bg-zinc-800 p-1"
            onChange={event => { const value = Number(event.target.value); if (event.target.value && Number.isFinite(value) && value >= -12 && value <= 12) {
              update({ eqBands: { ...(item.eqBands || {}), [frequency]: value } });
            } }} /></label>)}
      </fieldset>
      <Button variant="outline" onClick={() => {
        const local = Math.max(0, Math.min(item.duration, currentTime - item.start));
        update({ keyframes: [...(item.keyframes || []).filter(frame => frame.property !== 'volume' || Math.abs(frame.time - local) > .01),
          { property: 'volume', time: local, value: item.volume ?? 100 }].sort((a, b) => a.time - b.time) });
        toast.success('音量关键帧已写入所选音轨');
      }}>在播放头添加音量关键帧</Button>
      <Button variant="ghost" onClick={() => update({ volume: 100, speed: 1, fadeIn: 0, fadeOut: 0, pitch: 0,
        pan: 0, echo: 0, eqBands: {}, voiceEffect: 'none', denoise: '无降噪', reverb: '原声纯净', mute: false })}>重置所选音轨参数</Button>
    </>}
  </div></ScrollArea>;
}
