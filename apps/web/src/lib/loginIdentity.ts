/** Account mapping stays on the server; the browser only knows the login capability. */
export function loginEmail(input: string, _mode?: string, _usernameLogin?: boolean): string {
  return input.trim();
}
export function validLoginIdentity(input: string, mode: string, usernameLogin = false): boolean {
  const value = input.trim();
  return /^\S+@\S+\.\S+$/.test(value)
    || (mode === 'login' && usernameLogin && /^[A-Za-z0-9_.-]{3,64}$/.test(value));
}
