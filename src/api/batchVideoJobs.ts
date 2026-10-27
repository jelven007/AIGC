import { authenticatedEdgeJSON, EdgeRequestError } from '@/lib/edgeRequest';

export interface BatchInput {
  name: string;
  provider: string;
  product_ids: string[];
  settings: { duration: number; ratio: string; resolution: string; style: string; language: string };
  overrides: Record<string, { prompt?: string; narration?: string }>;
  pipeline?: { shots: string[]; voice: string; subtitles: boolean; transition: string; delivery: 'render' | 'publish' };
  expected_unit_cost: number;
  budget: number;
}
export interface BatchItem {
  id: string;
  product_id: string | null;
  product_name: string;
  video_job_id: string | null;
  project_id: string | null;
  status: string;
  submission_state: string | null;
  billing_state: string | null;
  credit_cost: number | null;
  progress: number | null;
  needs_attention: boolean;
  video_url: string | null;
  error_message: string | null;
  stages?: { id: string; kind: string; position: number; status: string; request_key: string;
    credit_cost: number; billing_state: string; error_message: string | null; publish_group_id: string | null }[];
}
export interface BatchVideoJob {
  id: string;
  name: string;
  provider: string;
  status: string;
  legacy: boolean;
  created_at: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  cancelled_count: number;
  queued_count: number;
  running_count: number;
  attention_count: number;
  reserved_credits: number;
  settled_credits: number;
  refunded_credits: number;
  unit_cost: number;
  credit_budget: number;
  progress: number;
  items: BatchItem[];
  pipeline?: BatchInput['pipeline'];
}
export class BatchJobError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function batchResult(value: any): BatchVideoJob {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.status !== 'string'
    || !Array.isArray(value.items) || value.items.some((item: any) => !item || typeof item.id !== 'string'
      || typeof item.status !== 'string' || item.stages !== undefined && (!Array.isArray(item.stages)
        || item.stages.some((stage: any) => !stage || typeof stage.id !== 'string' || typeof stage.status !== 'string')))) {
    throw new BatchJobError('批次响应无效，请核对后端版本并恢复原请求', 503);
  }
  return value;
}
async function invoke(body: Record<string, unknown>, userId?: string, signal?: AbortSignal) {
  let data;
  try { data = await authenticatedEdgeJSON('batch-video-jobs', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }, userId); }
  catch (cause) { throw new BatchJobError(cause instanceof Error ? cause.message : '批量任务服务暂不可用',
    cause instanceof EdgeRequestError ? cause.status : 0); }
  if (data?.error) throw new BatchJobError(data.error, 400);
  if (!data || typeof data !== 'object') throw new BatchJobError('批次响应无效，请核对后端版本', 503);
  return data;
}
export async function createBatchVideoJob(requestKey: string, input: BatchInput, userId?: string): Promise<BatchVideoJob> {
  const result = await invoke({ action: 'create', request_key: requestKey, ...input }, userId);
  const batch = batchResult(result.batch);
  window.dispatchEvent(new CustomEvent('credits_changed'));
  return batch;
}
export async function listBatchVideoJobs(userId?: string, signal?: AbortSignal): Promise<BatchVideoJob[]> {
  const result = await invoke({ action: 'list' }, userId, signal);
  if (!Array.isArray(result.batches)) throw new BatchJobError('批次响应无效，请核对后端版本', 503);
  return result.batches.map(batchResult);
}
export async function controlBatchVideoJob(batchId: string, action: 'pause' | 'resume' | 'cancel', userId?: string): Promise<BatchVideoJob> {
  const result = await invoke({ action, batch_id: batchId }, userId);
  const batch = batchResult(result.batch);
  window.dispatchEvent(new CustomEvent('credits_changed'));
  return batch;
}
export async function quoteBatchVideoJobs(userId?: string): Promise<{ unit_cost: number; max_items: number;
  pipeline_costs: { video: number; tts: number; subtitles: number; render: number } | null }> {
  return invoke({ action: 'quote' }, userId);
}
