import { authenticatedEdgeRequest, EdgeRequestError } from '@/lib/edgeRequest';
import { canonicalMediaTree } from '@/lib/privateMedia';
import type { EditSource, EditRequest } from '../../supabase/functions/_shared/edit-contract';
export interface VideoHighlight {
  type: string; start_sec: number; end_sec: number; title: string; score: number; keyword: string;
  suggested_title: string; reason: string; transcript: string; peak_viewers: null;
}
export interface VideoStyleReport {
  rhythm: string; pacing: string; transitions: string[]; subtitle_style: string; color_tone: string;
  transitions_summary: string; subtitle_summary: string; bgm_summary: string; analysis: string;
  tags: string[]; strengths: string[]; improvements: string[]; dna_scores: Record<string, number>;
  dna_fingerprint: string; score_basis: string;
}
export interface CompetitorAnalysisReference {
  sample_id: string; item: { id: string; title: string; url: string; views?: number | null };
  source: { name: string; observed_at: string; version_id: string }; relationship: string;
}
export interface ProductionJob {
  id: string; request_key: string; kind: string; project_id: string | null;
  mode?: 'live' | 'style';
  target_id?: string;
  product_id?: string;
  edit_mode?: 'beats' | 'subtitles'; edit_source?: EditSource; edit_request?: EditRequest;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  progress: number; phase: string; result: { url?: string; thumbnail_url?: string; size?: number; duration?: number; resolution?: string;
    text?: string; segments?: { start: number; end: number; text: string }[]; voice_clone_id?: string; requires_verification?: boolean; media_deleted?: boolean;
    mode?: 'live' | 'style' | 'beats' | 'subtitles'; source_url?: string; source_hash?: string; score_basis?: string; transcript_summary?: string;
    highlights?: VideoHighlight[]; report?: VideoStyleReport;
    competitor_reference?: CompetitorAnalysisReference;
    source?: EditSource; beats?: number[]; bpm?: number | null; confidence?: number; algorithm?: string; asr_version?: string;
    model_versions?: { text: string; asr: string }; evidence?: { frame_times: number[]; has_audio: boolean } } | null;
  error_message: string | null; credit_cost: number; created_at: string;
}
export interface RenderExport {
  id: string; request_key: string; source_project_id: string | null; title: string; created_at: string;
  status: 'completed' | 'partial' | 'failed' | 'attention' | 'processing';
  total_count: number; completed_count: number; progress: number;
  jobs: (ProductionJob & { title: string; output_ratio: string; output_height: number })[];
}
export interface RenderExportRequest {
  request_key: string; source_project_id: string; formats: { ratio: string; height: number }[];
}
export async function createRenderExport(request: RenderExportRequest): Promise<RenderExport> {
  return (await productionRequest({ action: 'export', ...request })).export;
}
export async function listRenderExports(): Promise<RenderExport[]> {
  return (await productionRequest({ action: 'exports' })).exports;
}
export class ProductionJobError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function productionRequest(body: Record<string, unknown>, expectedUserId?: string) {
  // 需要状态码区分请求丢失、404和参数拒绝，便于安全恢复。
  try {
    const response = await authenticatedEdgeRequest('production-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(canonicalMediaTree(body)), signal: AbortSignal.timeout(15000),
    }, '', expectedUserId);
    const data = await response.json();
    if (data?.error) throw new ProductionJobError(data.error, 400);
    return data;
  } catch (cause) {
    if (cause instanceof ProductionJobError) throw cause;
    throw new ProductionJobError(cause instanceof Error ? cause.message : '任务请求结果待确认',
      cause instanceof EdgeRequestError ? cause.status : 0);
  }
}
export async function createProductionJob(kind: string, requestKey: string, input: unknown, projectId?: string, userId?: string): Promise<ProductionJob> {
  return (await productionRequest({ action: 'create', kind, request_key: requestKey, input, project_id: projectId }, userId)).job;
}
export async function queryProductionJob(id: string, userId?: string): Promise<ProductionJob> {
  return (await productionRequest({ action: 'query', job_id: id }, userId)).job;
}
export async function listProductionJobs(userId?: string): Promise<ProductionJob[]> { return (await productionRequest({ action: 'list' }, userId)).jobs; }
