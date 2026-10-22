import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { hasCurrentEntitlement, readUserCredits } from '@/api/credits';

/** 同一账号的顶栏、个人中心、套餐门禁与计费页共享查询；注销销毁整个账号缓存。 */
export function useCredits() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['credits', user?.id], enabled: !!user,
    queryFn: ({ signal }) => readUserCredits(user!.id, signal),
    staleTime: 15000, retry: 1,
  });
  const [, tick] = useState(0);
  const data = user && query.data?.userId === user.id ? query.data : undefined;
  const active = data ? hasCurrentEntitlement(data) : false;
  useEffect(() => {
    if (!data?.entitlementActive || !data.expiresAt) return;
    const delay = Date.parse(data.expiresAt) - Date.parse(data.serverTime) - (performance.now() - data.receivedAt);
    if (delay <= 0) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.min(delay + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [data]);
  return {
    data, creditsTotal: data?.total ?? 0, creditsUsed: data?.used ?? 0, creditsLeft: data?.left ?? 0,
    usagePercent: data && data.total > 0 ? Math.min(100, Math.round(data.used / data.total * 100)) : 0,
    planName: data?.planName ?? '', planLevel: active ? data?.planLevel ?? 0 : 0,
    entitlementActive: active, loading: !!user && query.isPending, refreshing: query.isFetching,
    error: query.error ? '积分与套餐读取失败，请重试' : undefined,
    refresh: query.refetch,
  };
}

/** AccountScope只挂载一次。实时断线仍有有界轮询与窗口恢复回源。 */
export function CreditsSync() {
  const { user } = useAuth();
  const client = useQueryClient();
  useCredits();
  useEffect(() => {
    if (!user) return;
    const refresh = () => { void client.invalidateQueries({ queryKey: ['credits', user.id] }); };
    const channel = supabase.channel(`account-credits-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_plans', filter: `user_id=eq.${user.id}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'credit_logs', filter: `user_id=eq.${user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, refresh)
      .subscribe();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
    window.addEventListener('credits_changed', refresh);
    return () => { clearInterval(timer); window.removeEventListener('credits_changed', refresh); void supabase.removeChannel(channel); };
  }, [user?.id, client]);
  return null;
}
