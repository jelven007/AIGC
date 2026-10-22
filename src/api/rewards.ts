import { supabase } from '@/db/supabase';
import { accountRequest } from './accountSession';

export interface InvitationRecord {
  id: string;
  created_at: string;
  status: string;
  reward_credits: number;
  granted_at: string | null;
  credited: number | null;
  invitee_label: string;
  legacy: boolean;
}
export interface InvitationOverview {
  items: InvitationRecord[];
  invite_code: string | null;
  total: number;
  completed: number;
  credits: number;
  legacy: number;
}
export interface RewardActivity {
  id: string;
  title: string;
  description: string | null;
  type: string;
  reward_credits: number;
  max_times: number | null;
  completed_times: number;
  eligibility: string;
  next_claim_at: string | null;
}
export const eligibilityLabels: Record<string, string> = {
  eligible: '领取奖励',
  completed: '已领取',
  claimed_today: '今日已签到',
  video_required: '需完成一次视频生成',
  evidence_required: '需核验完成凭证',
  legacy_review: '历史领取记录待核对',
  not_started: '活动尚未开始',
  expired: '活动已结束',
  missing_plan: '账号套餐尚未初始化',
  unavailable: '活动暂未开放',
};
export async function assertRewardSession(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId) throw new Error('会话已变更，请重新登录');
}
export async function fetchInvitations(offset: number, signal: AbortSignal): Promise<InvitationOverview> {
  const { data, error } = await supabase.rpc('get_my_invitations', { p_offset: offset, p_limit: 20 }).abortSignal(signal);
  if (error || !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total)
    || !Number.isSafeInteger(data.completed) || !Number.isSafeInteger(data.credits)) throw new Error('邀请记录读取失败，请重试');
  return data;
}
export async function fetchActivities(signal: AbortSignal): Promise<RewardActivity[]> {
  const { data, error } = await supabase.rpc('get_my_activities').abortSignal(signal);
  if (error || !data || !Array.isArray(data.items)) throw new Error('活动数据读取失败，请重试');
  return data.items;
}
interface PendingReward { activityId: string; key: string; title: string }
const storageKey = (userId: string) => `shoproai:pending-rewards:${userId}`;
export function readPendingRewards(userId: string): PendingReward[] {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]');
    return Array.isArray(list) ? list.filter(item => typeof item?.activityId === 'string' &&
      /^[0-9a-f-]{36}$/i.test(item.key) && typeof item.title === 'string').slice(0, 50) : [];
  } catch { return []; }
}
export function reserveRewardRequest(userId: string, activity: RewardActivity): PendingReward {
  const list = readPendingRewards(userId);
  const previous = list.find(item => item.activityId === activity.id);
  if (previous) return previous;
  if (list.length >= 50) throw new Error('待确认的领取请求已满，请先恢复原请求');
  const pending = { activityId: activity.id, key: crypto.randomUUID(), title: activity.title };
  try { localStorage.setItem(storageKey(userId), JSON.stringify([...list, pending])); }
  catch { throw new Error('无法保存领取请求，请允许本地存储后重试'); }
  return pending;
}
export function clearRewardRequest(userId: string, key: string) {
  localStorage.setItem(storageKey(userId), JSON.stringify(readPendingRewards(userId).filter(item => item.key !== key)));
}
export async function claimReward(userId: string, activityId: string, key: string) {
  let data;
  try {
    data = await accountRequest(userId, '/rest/v1/rpc/claim_activity_reward', 'POST', { p_activity_id: activityId, p_request_key: key });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const reason = Object.keys(eligibilityLabels).find(item => item !== 'eligible' && message.includes(item));
    throw new Error(reason ? eligibilityLabels[reason] : '领取结果尚未确认，请恢复原请求');
  }
  if (!data?.ok || data.request_key !== key || !Number.isSafeInteger(data.reward) || data.reward <= 0
    || typeof data.already_claimed !== 'boolean') throw new Error('领取回执无效，请恢复原请求');
  return data as { reward: number; already_claimed: boolean; request_key: string; balance: number };
}
