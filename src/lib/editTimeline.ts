import { canonicalMediaTree } from '@/lib/privateMedia';
import type { EditSource } from '../../supabase/functions/_shared/edit-contract';
export interface EditResult {
  mode: 'beats' | 'subtitles'; source: EditSource; source_hash: string; duration: number;
  beats?: number[]; bpm?: number | null; confidence?: number; algorithm?: string;
  segments?: { start: number; end: number; text: string }[]; asr_version?: string;
}
interface Clip {
  id: string; type: string; trackId: string; name: string; start: number; duration: number; url?: string;
  sourceStart?: number; speed?: number; keyframes?: unknown[]; fadeIn?: number; fadeOut?: number;
}
export function sourceMatches(track: Clip | undefined, source: EditSource) {
  return !!track && track.id === source.id && track.type === source.type && track.start === source.start
    && track.duration === source.duration && (track.sourceStart ?? 0) === source.sourceStart
    && (track.speed ?? 1) === source.speed && canonicalMediaTree(track.url) === canonicalMediaTree(source.url);
}
export function beatCuts<T extends Clip>(tracks: T[], result: EditResult) {
  if (result.mode !== 'beats' || !sourceMatches(tracks.find(track => track.id === result.source.id), result.source)) {
    throw new Error('分析源片段已调整，请恢复原片段或重新分析');
  }
  const beats = result.beats || [];
  if (!beats.length) throw new Error('实际音轨没有检测到明显节拍');
  let count = 0;
  const items = tracks.flatMap(track => {
    if (track.type !== 'video' || track.trackId !== 'video' || track.keyframes?.length || track.fadeIn || track.fadeOut) return [track];
    const positions = beats.map(beat => result.source.start + beat)
      .filter(beat => beat >= track.start + .25 && beat <= track.start + track.duration - .25);
    const cuts = [track.start];
    for (const beat of positions) if (beat - cuts[cuts.length - 1] >= .25) cuts.push(beat);
    cuts.push(track.start + track.duration);
    count += cuts.length - 2;
    return cuts.slice(0, -1).map((start, index) => ({ ...track, id: index === 0 ? track.id : crypto.randomUUID(),
      start, duration: cuts[index + 1] - start,
      sourceStart: (track.sourceStart ?? 0) + (start - track.start) * (track.speed ?? 1) }));
  });
  if (!count) throw new Error('节拍未落入可切分主视频；带关键帧或淡变的片段请用播放头切分');
  if (items.length > 80) throw new Error('卡点后超过80个轨道元素，请缩短片段或减少素材');
  return { tracks: items, count };
}
export function subtitleItems(result: EditResult, projectDuration: number, jobId: string) {
  if (result.mode !== 'subtitles' || !result.segments?.length) throw new Error('识别结果没有可用时间分段');
  return result.segments.map((segment, index) => {
    const start = result.source.start + segment.start, end = result.source.start + segment.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > projectDuration + .001
      || end - start < .02 || !segment.text || segment.text.length > 2000) throw new Error('字幕超出当前工程或分段非法');
    return { id: `subtitle:${jobId}:${index}`, trackId: 'text', type: 'text' as const, name: segment.text, text: segment.text,
      start, duration: end - start, fontStyle: 'fs6', fontSize: 48, x: 50, y: 85 };
  });
}
