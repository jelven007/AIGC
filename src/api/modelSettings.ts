import { authenticatedEdgeJSON } from '@/lib/edgeRequest';
export { MODEL_SLOTS, RETIRED_MODELS, defaultSettings } from '../../supabase/functions/_shared/model-catalog';
export type { ModelConfigView, ModelSettings } from '../../supabase/functions/_shared/model-catalog';
export interface ModelCatalogEntry {
  slot: string; name: string; category: string; enabled: boolean; provider?: string;
  version_id?: string | null; image_capabilities?: { reference: boolean; mask: boolean };
}
export async function modelSettingsRequest<T>(body: Record<string, unknown>, userId?: string, signal?: AbortSignal): Promise<T> {
  return authenticatedEdgeJSON('model-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }, userId);
}
