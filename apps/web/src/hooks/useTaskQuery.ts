import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { watchTaskQuery, type TaskFamily } from '@/lib/taskQueries';

/** 缓存/取消归React Query，自动轮询归同一cache key的共享计时器。 */
export function useTaskQuery<T>(options: {
  queryKey: QueryKey; queryFn: (context: { signal: AbortSignal }) => Promise<T>;
}, family: TaskFamily, enabled = true) {
  const client = useQueryClient();
  const hash = JSON.stringify(options.queryKey);
  const query = useQuery({ ...options, enabled: enabled && !document.hidden, retry: false, staleTime: 10000,
    refetchOnWindowFocus: false, refetchOnReconnect: false });
  useEffect(() => {
    if (enabled) return watchTaskQuery(client, options, family);
  }, [client, hash, enabled, options.queryFn, family]);
  return query;
}
