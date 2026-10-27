import { useQuery } from '@tanstack/react-query';
import { modelSettingsRequest, type ModelCatalogEntry } from '@/api/modelSettings';
import { requireAccountSession } from '@/api/accountSession';
import { backendAnonKey, backendUrl } from '@/lib/backendConfig';
const EMPTY_MODELS: ModelCatalogEntry[] = [];

export function useWorkspaceModels(userId: string | undefined) {
  const catalog = useQuery({ queryKey: ['model-catalog', userId], enabled: !!userId, staleTime: 300000, retry: false,
    queryFn: ({ signal }) => modelSettingsRequest<{ configs: ModelCatalogEntry[] }>({ action: 'catalog' }, userId!, signal) });
  const price = useQuery({ queryKey: ['credit-cost', userId, 'generate_image'], enabled: !!userId, staleTime: 300000, retry: false,
    queryFn: async ({ signal }) => {
      const session = await requireAccountSession(userId!); signal.throwIfAborted();
      const response = await fetch(`${backendUrl}/rest/v1/credit_costs?select=cost&action=eq.generate_image`, { signal,
        headers: { apikey: backendAnonKey, Authorization: `Bearer ${session.access_token}`, Accept: 'application/vnd.pgrst.object+json' } });
      const result = await response.json();
      await requireAccountSession(userId!); signal.throwIfAborted();
      if (!response.ok || !Number.isInteger(result?.cost) || result.cost < 0) throw new Error('图片价格读取失败');
      return result.cost as number;
    } });
  const refresh = async () => {
    const results = await Promise.all([catalog.refetch({ throwOnError: true }), price.refetch({ throwOnError: true })]);
    return results;
  };
  return { models: catalog.data?.configs || EMPTY_MODELS, error: catalog.error?.message || '', price: price.data ?? null,
    priceError: price.error?.message || '', refreshing: catalog.isFetching || price.isFetching, refresh };
}
