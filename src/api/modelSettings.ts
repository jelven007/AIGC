import { authenticatedEdgeJSON, EdgeRequestError } from '@/lib/edgeRequest';
export { MODEL_SLOTS, RETIRED_MODELS, defaultSettings, configurationSlots } from '../../supabase/functions/_shared/model-catalog';
export type { ModelConfigView, ModelSettings, ConfigurationScope } from '../../supabase/functions/_shared/model-catalog';
export interface ModelCatalogEntry {
  slot: string; name: string; category: string; enabled: boolean; provider?: string;
  version_id?: string | null; image_capabilities?: { reference: boolean; mask: boolean };
}
export function modelSettingsErrorMessage(error: unknown): string {
  if (error instanceof EdgeRequestError && error.status === 404) {
    return '模型配置接口尚未部署，请部署 model-settings 和对应数据库迁移后重试。';
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return '无法连接模型配置服务，请检查后端部署和网络后重试。';
  }
  return error instanceof Error ? error.message : '模型配置操作失败，请重试。';
}
export async function modelSettingsRequest<T>(body: Record<string, unknown>, userId?: string, signal?: AbortSignal): Promise<T> {
  return authenticatedEdgeJSON('model-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }, userId);
}
