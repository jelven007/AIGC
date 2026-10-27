import { useCallback, useEffect, useRef, useState } from 'react';
import { MediaBlobCache } from '@/lib/mediaBlobCache';

export function useEditorMediaCache(sources: string[]) {
  const cache = useRef<MediaBlobCache | null>(null);
  const [cachedUrls, setCachedUrls] = useState<Record<string, string>>({});
  const [isPreloading, setIsPreloading] = useState(false), [preloadProgress, setPreloadProgress] = useState(100);
  const key = JSON.stringify([...new Set(sources)]);
  useEffect(() => {
    const owned = new MediaBlobCache(); cache.current = owned;
    return () => { owned.dispose(); cache.current = null; };
  }, []);
  useEffect(() => {
    const urls: string[] = JSON.parse(key), owned = cache.current!;
    let stopped = false;
    void (async () => {
      setIsPreloading(!!urls.length); setPreloadProgress(urls.length ? 0 : 100);
      const result: Record<string, string> = {};
      for (const [index, url] of urls.entries()) {
        if (stopped) return;
        try { result[url] = await owned.get(url); } catch { result[url] = url; }
        if (!stopped) setPreloadProgress(Math.round((index + 1) / urls.length * 100));
      }
      if (!stopped) { setCachedUrls(result); setIsPreloading(false); }
    })();
    return () => { stopped = true; };
  }, [key]);
  const getMedia = useCallback((source: string) => cache.current!.get(source), []);
  return { cachedUrls, isPreloading, preloadProgress, getMedia };
}
