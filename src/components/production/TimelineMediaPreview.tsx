import { useEffect, useRef } from 'react';
import type { TrackItem } from '@/pages/VideoEditPage';

export function TimelineMediaPreview({ track, currentTime, playing }: { track: TrackItem; currentTime: number; playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const time = Math.max(0, (track.sourceStart || 0) + (currentTime - track.start) * (track.speed || 1));
    const sync = () => {
      if (Math.abs(element.currentTime - time) > .25) element.currentTime = time;
      element.playbackRate = track.speed || 1;
      if (playing) void element.play().catch(() => {}); else element.pause();
    };
    if (element.readyState >= 1) sync(); else element.addEventListener('loadedmetadata', sync, { once: true });
    return () => element.removeEventListener('loadedmetadata', sync);
  }, [track.url, track.sourceStart, track.start, track.speed, currentTime, playing]);
  return track.type === 'image' ? <img src={track.url} alt={track.name} className="h-full w-full object-contain" />
    : <video ref={video} src={track.url} preload="metadata" muted playsInline className="h-full w-full object-contain" />;
}
