import { handleTextGeneration } from '../_shared/text-handler.ts';
// MiniMax 历史调用默认需要 JSON；仍共用平台主备模型配置。
Deno.serve(async req => {
  if (req.method !== 'POST') return handleTextGeneration(req);
  const body = await req.json().catch(() => null);
  return handleTextGeneration(new Request(req.url, { method: 'POST', headers: req.headers,
    body: JSON.stringify(body ? { ...body, stream: body.stream ?? false,
      max_tokens: body.max_tokens ?? body.max_completion_tokens } : null) }));
});
