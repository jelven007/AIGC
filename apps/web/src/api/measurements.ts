import { authenticatedEdgeJSON } from '@/lib/edgeRequest';
export interface MeasuredProject {
  id: string; title: string; status: string; video_style: string | null; duration: number | null; created_at: string;
}
export interface NaturalMeasurement {
  id: string; project_id: string; title: string; platform: string; video_id: string;
  view_count: number | null; like_count: number | null; comment_count: number | null; share_count: number | null;
  collected_at: string; published_at: string;
}
export interface DeliveryMeasurement {
  source_id: string; source_name: string; currency: string; buckets: number; since: string; until: string; received_at: string;
  impressions: number | null; clicks: number | null; conversions: number | null;
  spend_minor: number | null; gmv_minor: number | null; refunds_minor: number | null; net_revenue_minor: number | null;
  ctr: number | null; cvr: number | null; roas: number | null; cpa_minor: number | null; profit_roi: null;
}
export interface MeasurementReport {
  project_count: number; completed_count: number; projects: MeasuredProject[]; natural: NaturalMeasurement[]; delivery: DeliveryMeasurement[];
  natural_count: number;
  style_distribution: Array<{ name: string; count: number }>; duration_distribution: Array<{ name: string; count: number }>;
  creation_trend: Array<{ day: string; created: number; completed: number }>;
  natural_totals: Record<'view_count' | 'like_count' | 'comment_count' | 'share_count', { value: number | null; observed: number; total: number }>;
  sync_issues: Array<{ id: string; title: string; platform: string; error: string }>; generated_at: string;
}
export interface MeasurementSource {
  id: string; name: string; enabled: boolean; authorization_reference: string;
}
export interface ExperimentVariant {
  id: string; label: string; title: string; project_id: string; assigned: number; impressions: number; clicks: number; conversions: number;
  ctr: number | null; cvr: number | null; primary_rate: number | null; interval: [number, number] | null;
  conversion_per_exposure: number | null; uplift: number | null; adjusted_p_value: number | null; recommended: boolean;
}
export interface ContentExperiment {
  id: string; request_key: string; title: string; primary_metric: string; planned_sample: number;
  status: 'draft' | 'running' | 'closed'; starts_at: string | null; ends_at: string; inference_reason: string; variants: ExperimentVariant[];
}
export interface ExperimentSpecification {
  request_key: string; source_id: string; title: string; primary_metric: string; planned_sample: number;
  ends_at: string; variants: Array<{ title: string; project_id: string }>;
}
export async function measurementRequest<T>(body: Record<string, unknown>, signal?: AbortSignal, userId?: string): Promise<T> {
  return authenticatedEdgeJSON('measurements', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, userId);
}
export const numberText = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN');
export const percentText = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
export const moneyText = (minor: number | null, currency: string) => minor === null ? '—'
  : new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(minor / 100);
