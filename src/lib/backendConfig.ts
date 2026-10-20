/** 仅公开连接信息进入浏览器；平台密钥由 Edge Functions 管理。 */
export const backendUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
export const backendAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');

if (!backendUrl || !backendAnonKey) {
  throw new Error('请配置火山引擎 BaaS 的 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
}
const parsed = new URL(backendUrl);
if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  throw new Error('后端连接地址必须使用 HTTPS');
}

export const edgeFunctionUrl = (name: string) => `${backendUrl}/functions/v1/${name}`;
