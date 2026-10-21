import { createClient, User } from 'npm:@supabase/supabase-js@2';

export interface AuthResult {
  user: User | null;
  userId: string | null;
  isServiceRole: boolean;
  error: string | null;
  status?: number;
  apiKeyId?: string;
}

export async function hashApiKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticateRequest(req: Request, scope?: string): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!token) {
    return { user: null, userId: null, isServiceRole: false, error: '缺少 Authorization 凭据' };
  }

  if (token.startsWith('ak_')) {
    const denied = (error: string, status = 401): AuthResult =>
      ({ user: null, userId: null, isServiceRole: false, error, status });
    if (!scope || !/^ak_live_[0-9a-f]{64}$/.test(token)) return denied('此接口不接受 API Key 或密钥已失效');
    try {
      const db = createServiceClient();
      const consumed = await db.rpc('consume_api_key', {
        p_hash: await hashApiKey(token), p_scope: scope, p_endpoint: new URL(req.url).pathname,
      });
      if (consumed.error || !consumed.data) return denied('密钥验证服务暂不可用', 503);
      if (consumed.data.error) return denied(consumed.data.error === 'scope_denied' ? '密钥缺少所需权限'
        : consumed.data.error === 'rate_limited' ? '密钥请求过于频繁' : '密钥已撤销或过期', consumed.data.status);
      const { data, error } = await db.auth.admin.getUserById(consumed.data.user_id);
      if (error || !data.user || data.user.banned_until && Date.parse(data.user.banned_until) > Date.now()) return denied('密钥账号不可用');
      return { user: data.user, userId: data.user.id, isServiceRole: false, error: null, apiKeyId: consumed.data.key_id };
    } catch { return denied('密钥验证服务暂不可用', 503); }
  }

  // 1. 判断是否是内部 service_role 凭据
  if (serviceRoleKey && token === serviceRoleKey) {
    return { user: null, userId: 'service_role', isServiceRole: true, error: null };
  }

  // 2. 校验 JWT 合法性并提取 auth.uid()
  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, userId: null, isServiceRole: false, error: '服务端 Supabase 环境变量未配置' };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return {
      user: null,
      userId: null,
      isServiceRole: false,
      error: error?.message || '无效或已过期的登录令牌',
    };
  }

  return {
    user: data.user,
    userId: data.user.id,
    isServiceRole: false,
    error: null,
  };
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
