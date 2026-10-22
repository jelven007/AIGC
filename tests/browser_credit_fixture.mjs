/** 仅隔离浏览器测试使用；与get_my_credits真实PG返回字段一致。 */
export function creditSnapshot(userId, overrides = {}) {
  return { user_id: userId, plan_id: '66666666-6666-4666-8666-666666666666', plan_name: '专业版',
    configured_plan_level: 1, plan_level: 1, entitlement_active: true, credits_total: 1000, credits_used: 0, credits_left: 1000,
    status: 'active', expires_at: null, cycle_start: '2026-10-01T00:00:00Z', cycle_end: '2026-11-01T00:00:00Z',
    server_time: new Date().toISOString(), ...overrides };
}
