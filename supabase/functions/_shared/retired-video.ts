// 旧无计费/无任务归属校验的代理不可继续作为旁路。
export function retiredVideoHandler(req: Request): Response {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  return new Response(JSON.stringify({ error: '旧视频接口已停用，请使用 video-jobs 创建和查询任务' }),
    { status: 410, headers });
}
