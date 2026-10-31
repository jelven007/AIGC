export interface ClockClip { start: number; sourceStart?: number; speed?: number }
export function editorClockTime(current: number, delta: number, duration: number,
  video: Pick<HTMLVideoElement, 'currentSrc' | 'readyState' | 'seeking' | 'paused' | 'currentTime'> | null,
  clip?: ClockClip): number {
  const playing = video?.currentSrc && video.readyState >= 2 && !video.seeking && !video.paused;
  const time = playing && video ? clip
    ? clip.start + (video.currentTime - (clip.sourceStart || 0)) / (clip.speed || 1) : video.currentTime
    : current + Math.max(0, Math.min(.25, delta));
  return Math.max(0, Math.min(duration, time));
}
