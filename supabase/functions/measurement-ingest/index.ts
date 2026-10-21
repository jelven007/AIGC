import { createServiceClient, hashApiKey } from '../_shared/auth.ts';
import { decryptKey } from '../_shared/model-registry.ts';
import { checkMeasurementInput, isUuid, MeasurementInputError, verifyMeasurementSignature } from '../_shared/measurement-input.ts';
export async function handleMeasurementIngest(req: Request) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const sourceId = req.headers.get('x-measurement-source');
    if (!isUuid(sourceId)) return reply({ error: '缺少授权数据源' }, 401);
    // 有界读取，禁止先无界加载正文再检查长度。
    if (!req.body || Number(req.headers.get('content-length') || 0) > 131072) return reply({ error: '观测批次过大' }, 413);
    const reader = req.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 131072) return reply({ error: '观测批次过大' }, 413);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const db = createServiceClient();
    const source = await db.from('measurement_sources').select('id,key_ciphertext').eq('id', sourceId).eq('enabled', true).maybeSingle();
    if (source.error) return reply({ error: '数据源验证暂不可用' }, 503);
    if (!source.data) return reply({ error: '数据源已停用或不存在' }, 401);
    const key = await decryptKey(`measurement:${sourceId}`, source.data.key_ciphertext);
    if (!await verifyMeasurementSignature(key, req.headers.get('x-measurement-timestamp'), req.headers.get('x-measurement-signature'), raw)) {
      return reply({ error: '观测签名无效或已过期' }, 401);
    }
    const body = JSON.parse(raw); checkMeasurementInput(body);
    const start = Math.floor(Date.now() / 60000) * 60000;
    const limited = await db.rpc('upsert_rate_limit', { p_window_key: `measurement:${sourceId}:${start}`,
      p_client_id: `measurement:${sourceId}`, p_reset_at: new Date(start + 60000).toISOString(), p_max_req: 500 });
    if (limited.error) return reply({ error: '观测限流服务暂不可用' }, 503);
    if (!limited.data) return reply({ error: '观测请求过于频繁' }, 429);
    const saved = await db.rpc('ingest_measurement', { p_source: sourceId, p_key: body.request_key,
      p_hash: await hashApiKey(raw), p_data: body });
    if (saved.error) return reply({ error: '观测未写入：请求、版本、归属或实验窗口冲突' }, 409);
    return reply(saved.data);
  } catch (cause) {
    return reply({ error: cause instanceof MeasurementInputError ? cause.message
      : cause instanceof SyntaxError || cause instanceof TypeError ? '观测正文格式不正确' : '观测接收服务暂不可用' },
    cause instanceof MeasurementInputError || cause instanceof SyntaxError || cause instanceof TypeError ? 400 : 503);
  }
}
Deno.serve(handleMeasurementIngest);
