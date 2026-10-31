/** Resolve a private username; Auth remains the authority for passwords and bans. */
export async function usernameLogin(req: Request, identity: { username: string; email: string },
  upstream: typeof fetch = fetch): Promise<Response> {
  const denied = () => Response.json({ error: '用户名或密码错误' }, { status: 400 });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  try {
    const raw = await req.text();
    if (raw.length > 4096) return denied();
    const body = JSON.parse(raw);
    if (typeof body.username !== 'string' || typeof body.password !== 'string'
      || body.username.trim().toLowerCase() !== identity.username.toLowerCase()
      || !body.password || body.password.length > 256) return denied();
    const result = await upstream('http://auth:9999/token?grant_type=password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: identity.email, password: body.password }),
      signal: AbortSignal.timeout(30000),
    });
    if (!result.ok) return result.status === 429
      ? Response.json({ error: '登录请求过于频繁，请稍后重试' }, { status: 429 }) : denied();
    const session = await result.json();
    if (!session.access_token || !session.refresh_token) throw new Error('Incomplete session');
    return Response.json(session, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: '登录暂不可用，请稍后重试' }, { status: 503 });
  }
}
