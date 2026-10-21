import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
export { MODEL_SLOTS, RETIRED_MODELS, defaultSettings } from '../../supabase/functions/_shared/model-catalog';
export type { ModelConfigView, ModelSettings } from '../../supabase/functions/_shared/model-catalog';
export interface ModelCatalogEntry { slot: string; name: string; category: string; enabled: boolean; provider?: string }
export async function modelSettingsRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await authenticatedEdgeRequest('model-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return response.json();
}
