import { authenticatedEdgeJSON } from '@/lib/edgeRequest';
import type { ProductionJob } from './productionJobs';
export interface IntelligenceItem {
  id: string; title: string; url: string; price?: string; currency?: string; seller?: string | null;
  sold_7d?: number | null; stock?: number | null;
  views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null;
  duration?: number | null; published_at?: string | null;
}
export interface IntelligenceSample {
  job_id: string; collected_at: string; data: {
    source: { slot: string; version_id: string; name: string; observed_at: string; definition: string };
    account?: { id: string; name: string; url: string; followers: number | null };
    params: Record<string,string>; items: IntelligenceItem[];
  };
}
export interface IntelligenceTarget {
  id: string; name: string; kind: string; source_slot: string; params: Record<string,string>;
  monitoring: boolean; remaining_runs: number; remaining_budget: number; next_run_at: string | null; last_error: string | null;
  latest: IntelligenceSample | null; history: { collected_at: string; followers: number | null }[];
}
export interface IntelligenceCatalog {
  targets: IntelligenceTarget[]; sources: { slot: string; enabled: boolean }[]; prices: Record<string,number>; jobs: ProductionJob[];
}
export async function intelligenceRequest<T>(body: Record<string,unknown>, userId?: string, signal?: AbortSignal): Promise<T> {
  return authenticatedEdgeJSON('market-intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }, userId);
}
