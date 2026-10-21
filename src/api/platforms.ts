import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
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
export async function platformRequest<T = any>(endpoint: 'platform-accounts' | 'platform-publish', body: Record<string, unknown>): Promise<T> {
  const response = await authenticatedEdgeRequest(endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
