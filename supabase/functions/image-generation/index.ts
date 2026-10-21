import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { generateImage } from '../_shared/image-provider.ts';

export async function handleImageGeneration(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return Response.json({ error: '仅支持 POST' }, { status: 405, headers });
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return Response.json({ error: '请先登录' }, { status: 401, headers });
    const input = await req.json().catch(() => null);
    if (!input || typeof input !== 'object') return Response.json({ error: '图片参数不正确' }, { status: 400, headers });
    const db = createServiceClient();
    const start = Math.floor(Date.now() / 60000) * 60000;
    const limit = await db.rpc('upsert_rate_limit', { p_window_key: `image:${auth.user.id}:${start}`,
      p_client_id: `image:${auth.user.id}`, p_reset_at: new Date(start + 60000).toISOString(), p_max_req: 5 });
    if (limit.error) throw new Error('图片限流服务不可用');
    if (!limit.data) return Response.json({ error: '图片请求过于频繁，请稍后重试' }, { status: 429, headers });
    return Response.json(await generateImage(db, auth.user.id, input), { headers });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : '图片服务暂时不可用' }, { status: 503, headers });
  }
}
Deno.serve(handleImageGeneration);
