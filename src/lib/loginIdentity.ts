/** 用户名只是自托管管理员的公开别名，权限仍由真实Auth和数据库决定。 */
export interface AdminLoginAlias { username: string; email: string }
export function loginEmail(input: string, mode: string, alias?: AdminLoginAlias): string {
  const value = input.trim();
  return mode === 'login' && alias && value.toLowerCase() === alias.username ? alias.email : value;
}
export function validLoginIdentity(input: string, mode: string, alias?: AdminLoginAlias): boolean {
  return /^\S+@\S+\.\S+$/.test(loginEmail(input, mode, alias));
}
