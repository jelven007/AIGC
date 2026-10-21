import { authenticateRequest } from './auth.ts';
import { getCorsHeaders, handleCorsPreflight } from './cors.ts';

// 历史入口保留迁移说明，所有配音/识别统一使用计费、版本化后台任务。
export async function handleAudio(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return Response.json({ error: '仅支持 POST' }, { status: 405, headers });
  const auth = await authenticateRequest(req);
  if (auth.error || !auth.user || auth.isServiceRole) return Response.json({ error: '请先登录' }, { status: 401, headers });
  return Response.json({ error: '语音接口已迁移，请通过 production-jobs 创建 tts/asr 任务并查询结果',
    endpoint: 'production-jobs', kinds: ['tts', 'asr'] }, { status: 410, headers });
}
