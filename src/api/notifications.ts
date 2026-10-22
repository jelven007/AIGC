import { accountRequest } from './accountSession';

export type NotificationCategory = 'all' | 'jobs' | 'intelligence' | 'publish';
export interface TaskNotification {
  id: string; category: Exclude<NotificationCategory, 'all'>; level: 'success' | 'warning' | 'error';
  title: string; body: string; action_path: string; source_id: string; created_at: string; read_at: string | null;
}
export interface NotificationPreferences { task_success: boolean; intelligence_success: boolean }
export interface NotificationFeed {
  items: TaskNotification[]; total: number; unread: number; unread_all: number; cutoff: string;
  preferences: NotificationPreferences;
}
export type NotificationMutation = { action: 'read' | 'delete'; ids: string[] }
  | { action: 'read_all' | 'clear_read'; cutoff: string }
  | { action: 'preferences'; preferences: NotificationPreferences };
export async function readNotifications(userId: string, category: NotificationCategory, offset: number, signal?: AbortSignal): Promise<NotificationFeed> {
  const data = await accountRequest(userId, '/rest/v1/rpc/read_notifications', 'POST', { p_category: category, p_offset: offset, p_limit: 25 }, signal);
  if (!data || !Array.isArray(data.items) || !data.cutoff) throw new Error('通知回执不完整，请刷新重试');
  return data;
}
export async function mutateNotifications(userId: string, input: NotificationMutation) {
  const data = await accountRequest(userId, '/rest/v1/rpc/mutate_notifications', 'POST', {
    p_action: input.action, p_ids: 'ids' in input ? input.ids : [],
    p_cutoff: 'cutoff' in input ? input.cutoff : null,
    p_preferences: 'preferences' in input ? input.preferences : {},
  });
  if (!data) throw new Error('通知操作回执待确认，请刷新核对');
  return data;
}
const paths = new Set(['/task-queue', '/products', '/product-selection', '/competitor', '/publish']);
export function notificationPath(notification: TaskNotification) {
  return paths.has(notification.action_path) ? notification.action_path : '/task-queue';
}
