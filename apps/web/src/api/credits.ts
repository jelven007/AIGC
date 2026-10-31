/**
 * 积分与套餐相关统一 API
 */
import { accountRequest } from './accountSession';
import { handleApiRequest, type ApiResponse } from './client';

export interface UserCreditsInfo {
  total: number;
  used: number;
  left: number;
  userId: string;
  planId: string;
  planName: string;
  planLevel: number;
  configuredPlanLevel: number;
  entitlementActive: boolean;
  status: 'active' | 'expired' | 'cancelled';
  expiresAt: string | null;
  cycleStart: string;
  cycleEnd: string;
  serverTime: string;
  receivedAt: number;
}

export async function readUserCredits(userId: string, signal?: AbortSignal): Promise<UserCreditsInfo> {
  const row = await accountRequest(userId, '/rest/v1/rpc/get_my_credits', 'POST', {}, signal);
  const integers = [row?.credits_total, row?.credits_used, row?.credits_left, row?.plan_level, row?.configured_plan_level];
  const dates = [row?.cycle_start, row?.cycle_end, row?.server_time, ...(row?.expires_at === null ? [] : [row?.expires_at])];
  if (row?.user_id !== userId || typeof row.plan_id !== 'string' || typeof row.plan_name !== 'string'
    || !integers.every(Number.isSafeInteger) || row.credits_used < 0 || row.credits_left < 0
    || row.credits_left !== Math.max(0, row.credits_total - row.credits_used)
    || typeof row.entitlement_active !== 'boolean' || !['active', 'expired', 'cancelled'].includes(row.status)
    || !dates.every(date => typeof date === 'string' && Number.isFinite(Date.parse(date)))) {
    throw new Error('积分与套餐回执不完整，请重试');
  }
  return { userId, planId: row.plan_id, planName: row.plan_name, total: row.credits_total, used: row.credits_used,
    left: row.credits_left, planLevel: row.plan_level, configuredPlanLevel: row.configured_plan_level,
    entitlementActive: row.entitlement_active, status: row.status, expiresAt: row.expires_at,
    cycleStart: row.cycle_start, cycleEnd: row.cycle_end, serverTime: row.server_time, receivedAt: performance.now() };
}

export async function fetchUserCredits(userId: string): Promise<ApiResponse<UserCreditsInfo>> {
  return handleApiRequest(async () => ({ data: await readUserCredits(userId), error: null }));
}

/** 按服务端时钟推算过期；客户端时区和本机时钟偏差不改变权益。 */
export function hasCurrentEntitlement(info: UserCreditsInfo, now = performance.now()): boolean {
  return info.entitlementActive && (!info.expiresAt
    || now - info.receivedAt < Date.parse(info.expiresAt) - Date.parse(info.serverTime));
}
