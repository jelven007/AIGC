/** 仅识别数据库明确拒绝的新计费策略，网络/受理未知不能被归类为拒绝。 */
export class WorkloadPolicyError extends Error {
  constructor(message: string, readonly status: 403 | 429) { super(message); }
}
export function workloadPolicy(error: unknown): WorkloadPolicyError | null {
  if (error instanceof WorkloadPolicyError) return error;
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/^账号的新计费任务已受限|^租户已暂停新计费任务/.test(message)) return new WorkloadPolicyError(message, 403);
  if (/^团队日积分预算不足|^日积分预算不足/.test(message)) return new WorkloadPolicyError(message, 429);
  return null;
}
