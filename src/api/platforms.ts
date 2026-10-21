import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
export type { PublishOptions, PublishTarget, PublishGroupRequest } from '../../supabase/functions/_shared/publish-contract';
import type { PublishGroupRequest } from '../../supabase/functions/_shared/publish-contract';
export interface PlatformConnection {
  id: string; platform: string; display_name: string; status: string; expires_at: string; scopes: string[];
}
export interface PlatformApplication {
  platform: string; client_key: string; redirect_uri: string; scopes: string[]; enabled: boolean;
  has_secret: boolean; updated_at: string | null;
}
export interface CreatorInfo {
  display_name: string; platform: string; privacy_level_options: string[]; max_video_post_duration_sec: number;
  comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean;
}
export interface PlatformPublishTask {
  id: string;
  group_id?: string | null;
  request_key?: string;
  connection_id?: string;
  job_id: string | null;
  project_id: string;
  title: string | null;
  platform: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'submitted' | 'moderating' | 'published' | 'failed' | 'unknown' | 'cancelled';
  scheduled_at: string | null;
  created_at: string;
  error_message: string | null;
  platform_url: string | null;
}
export interface PublishGroup {
  id: string; request_key: string; request: PublishGroupRequest; created_at: string; tasks: PlatformPublishTask[];
}
export async function listPlatformPublishTasks(): Promise<PlatformPublishTask[]> {
  const result = await platformRequest<{ tasks: PlatformPublishTask[] }>('platform-publish', { action: 'list' });
  if (!Array.isArray(result.tasks)) throw new Error('发布服务返回格式无效，请检查后端版本');
  return result.tasks;
}
export async function cancelPlatformPublishTask(id: string): Promise<void> {
  const result = await platformRequest<{ ok: boolean }>('platform-publish', { action: 'cancel', task_id: id });
  if (result.ok !== true) throw new Error('发布取消结果未确认，请刷新核对');
}
export async function platformRequest<T = any>(endpoint: 'platform-accounts' | 'platform-publish', body: Record<string, unknown>): Promise<T> {
  const response = await authenticatedEdgeRequest(endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
