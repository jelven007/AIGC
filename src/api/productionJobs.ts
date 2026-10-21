import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
import { canonicalMediaTree } from '@/lib/privateMedia';
export interface ProductionJob {
  id: string; request_key: string; kind: string; project_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  progress: number; phase: string; result: { url?: string; thumbnail_url?: string; size?: number; duration?: number; resolution?: string } | null;
  error_message: string | null; credit_cost: number; created_at: string;
}
export class ProductionJobError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function productionRequest(body: Record<string, unknown>) {
  // 需要状态码区分请求丢失、404和参数拒绝，便于安全恢复。
  const { supabase } = await import('@/db/supabase');
  const { data, error } = await supabase.functions.invoke('production-jobs', { body: canonicalMediaTree(body) });
  if (error) {
    const response = error.context instanceof Response ? error.context : null;
    const details = await response?.json().catch(() => null);
    throw new ProductionJobError(details?.error || error.message, response?.status || 0);
  }
  if (data?.error) throw new ProductionJobError(data.error, 400);
  return data;
}
export async function createProductionJob(kind: string, requestKey: string, input: unknown, projectId?: string): Promise<ProductionJob> {
  return (await productionRequest({ action: 'create', kind, request_key: requestKey, input, project_id: projectId })).job;
}
export async function queryProductionJob(id: string): Promise<ProductionJob> {
  return (await productionRequest({ action: 'query', job_id: id })).job;
}
export async function listProductionJobs(): Promise<ProductionJob[]> { return (await productionRequest({ action: 'list' })).jobs; }
