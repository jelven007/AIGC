import { authenticatedEdgeJSON } from '@/lib/edgeRequest';
import type { ProductionJob } from './productionJobs';
export interface KnowledgeEntry {
  id: string; title: string; content: Record<string, unknown>; embedding_text: string; content_hash: string;
  tags: string[]; category: string; indexed: boolean; created_at: string;
}
export interface KnowledgeSource {
  entry_id: string; title: string; content: string; content_hash: string; similarity: number; version_id: string;
}
export type KnowledgeJob = Omit<ProductionJob, 'result'> & {
  result: { results?: KnowledgeSource[]; query?: string; entry_id?: string; chunk_count?: number; version_id: string } | null;
};
export async function knowledgeRequest<T>(body: Record<string, unknown>, userId?: string, signal?: AbortSignal): Promise<T> {
  return authenticatedEdgeJSON('knowledge-base', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }, userId);
}
