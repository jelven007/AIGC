import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { editorClockTime, type ClockClip } from '@/lib/editorClock';

interface ClockOptions {
  playing: boolean; time: number; duration: number; pixelsPerSecond: number; offset: number;
  setTime: (time: number) => void; stop: () => void;
  video: RefObject<HTMLVideoElement>; clip: MutableRefObject<ClockClip | undefined>;
  timeRef: MutableRefObject<number>; playhead: RefObject<HTMLDivElement>; ruler: RefObject<HTMLDivElement>;
  display: RefObject<HTMLSpanElement>; bottomDisplay: RefObject<HTMLSpanElement>; scroll: RefObject<HTMLDivElement>;
}
const formatTime = (value: number) => `00:${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
function paint(options: ClockOptions, time: number) {
  if (options.playhead.current) options.playhead.current.style.left = `${options.offset + time * options.pixelsPerSecond}px`;
  if (options.ruler.current) options.ruler.current.style.left = `${time * options.pixelsPerSecond}px`;
  for (const display of [options.display.current, options.bottomDisplay.current]) if (display) display.textContent = formatTime(time);
}
/** The media clock drives DOM cursors each frame and React state at most every 100 ms. */
export function useEditorClock(options: ClockOptions) {
  const live = useRef(options); live.current = options;
  useEffect(() => {
    if (!options.playing) return;
    let frame = 0, previous = performance.now(), lastSync = previous;
    const tick = (stamp: number) => {
      const current = live.current;
      const time = editorClockTime(current.timeRef.current, (stamp - previous) / 1000,
        current.duration, current.video.current, current.clip.current);
      previous = stamp; current.timeRef.current = time; paint(current, time);
      const scroll = current.scroll.current, x = current.offset + time * current.pixelsPerSecond;
      if (scroll) {
        if (x > scroll.scrollLeft + scroll.clientWidth - 60) scroll.scrollLeft = x - scroll.clientWidth / 2;
        else if (x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 60);
      }
      if (stamp - lastSync >= 100 || time >= current.duration) { lastSync = stamp; current.setTime(time); }
      if (time >= current.duration) current.stop();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [options.playing]);
  useEffect(() => {
    if (!options.playing) options.setTime(options.timeRef.current);
  }, [options.playing]);
  useEffect(() => {
    options.timeRef.current = options.time; paint(options, options.time);
  }, [options.time, options.pixelsPerSecond, options.offset]);
}
