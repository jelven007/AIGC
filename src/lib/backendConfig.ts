/** 仅公开连接信息进入浏览器；平台密钥由 Edge Functions 管理。 */
declare global {
  interface Window {
    __SHOPRO_RUNTIME__?: { deployment?: string; backendUrl?: string; backendAnonKey?: string; usernameLogin?: boolean };
  }
}
const runtime = typeof window === 'undefined' ? undefined : window.__SHOPRO_RUNTIME__;
export const backendUrl = String(runtime?.backendUrl || import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
export const backendAnonKey = String(runtime?.backendAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '');
export const usernameLoginEnabled = runtime?.deployment === 'self-hosted' && runtime.usernameLogin === true;

if (!backendUrl || !backendAnonKey) {
  throw new Error('请配置后端公开地址和 anon key');
}
const parsed = new URL(backendUrl);
if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  throw new Error('后端连接地址必须使用 HTTPS');
}
if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
  throw new Error('后端连接必须为无凭据的根地址');
}

export const edgeFunctionUrl = (name: string) => `${backendUrl}/functions/v1/${name}`;
