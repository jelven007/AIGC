import { supabase } from '@/db/supabase';

export interface BatchInput {
  name: string;
  provider: string;
  product_ids: string[];
  settings: { duration: number; ratio: string; resolution: string; style: string; language: string };
  overrides: Record<string, { prompt: string }>;
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
}
export class BatchJobError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('batch-video-jobs', { body });
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null;
    const payload = await response?.json().catch(() => null);
    throw new BatchJobError(payload?.error || error.message || '批量任务服务暂不可用', response?.status || 0);
  }
  if (data?.error) throw new BatchJobError(data.error, 400);
  return data;
}
export async function createBatchVideoJob(requestKey: string, input: BatchInput): Promise<BatchVideoJob> {
  const result = await invoke({ action: 'create', request_key: requestKey, ...input });
  window.dispatchEvent(new CustomEvent('credits_changed'));
  return result.batch;
}
export async function listBatchVideoJobs(): Promise<BatchVideoJob[]> {
  return (await invoke({ action: 'list' })).batches;
}
export async function controlBatchVideoJob(batchId: string, action: 'pause' | 'resume' | 'cancel'): Promise<BatchVideoJob> {
  const result = await invoke({ action, batch_id: batchId });
  window.dispatchEvent(new CustomEvent('credits_changed'));
  return result.batch;
}
export async function quoteBatchVideoJobs(): Promise<{ unit_cost: number; max_items: number }> {
  return invoke({ action: 'quote' });
}
