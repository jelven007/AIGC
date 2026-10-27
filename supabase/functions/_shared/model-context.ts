import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ResolvedModel } from './model-registry.ts';

export interface ModelContext {
  db: SupabaseClient;
  userId: string;
  requestId: string;
  action: string;
  versions: Record<string, unknown>;
}
const context = new AsyncLocalStorage<ModelContext>();
export const withModelContext = <T>(value: ModelContext, callback: () => T): T => context.run(value, callback);
export const currentModelContext = () => context.getStore();
export class AttemptLedgerError extends Error {}

export async function beginModelAttempt(config: ResolvedModel) {
  const owner = context.getStore();
  if (!owner) return null;
  const id = crypto.randomUUID(), start = Date.now();
  const begun = await owner.db.rpc('begin_model_attempt', { p_user: owner.userId || null,
    p_request: owner.requestId, p_action: owner.action, p_slot: config.slot,
    p_version: config.version_id, p_model: config.settings.model, p_attempt: id, p_context: owner.versions });
  if (begun.error || begun.data !== id) throw new AttemptLedgerError('模型尝试台账不可用，尚未调用供应商');
  let finished = false;
  return async (status: string, upstream: string | null = null, usage: unknown = null, error: string | null = null) => {
    if (finished) return;
    const result = await owner.db.rpc('finish_model_attempt', { p_attempt: id, p_status: status,
      p_latency: Math.min(2147483647, Date.now() - start), p_upstream: upstream,
      p_usage: usage, p_error: error });
    if (result.error || result.data !== true) throw new AttemptLedgerError('模型尝试结案台账待核对，请查询原请求');
    finished = true;
  };
}

/** 保持流式转发；正常EOF/取消/读取故障均补录原attempt，正文和凭据不写日志。 */
export function trackedModelResponse(response: Response, finish: NonNullable<Awaited<ReturnType<typeof beginModelAttempt>>>) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型响应正文为空');
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0, doneMarker = false;
  let usage: unknown = null, upstream: string | null = response.headers.get('x-request-id');
  const capture = (value: any) => {
    if (typeof value?.id === 'string') upstream = value.id.slice(0, 200);
    if (value?.usage && typeof value.usage === 'object') {
      const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
      if (fields.every(key => value.usage[key] == null || Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0)) usage = value.usage;
    }
  };
  const parseLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') { doneMarker = true; return; }
    try { capture(JSON.parse(data)); } catch { /* 任意供应商注释不构成usage */ }
  };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          buffer += decoder.decode();
          if (streaming) parseLine(buffer);
          else { try { capture(JSON.parse(buffer)); } catch { /* 非JSON响应不推导token用量 */ } }
          await finish(streaming && !doneMarker ? 'interrupted' : 'success', upstream, usage);
          controller.close();
          return;
        }
        bytes += chunk.value.byteLength;
        if (bytes > 32 * 1024 * 1024) throw new Error('模型响应超过传输预算');
        buffer += decoder.decode(chunk.value, { stream: true });
        if (streaming) {
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const line of lines) parseLine(line.trimEnd());
        }
        if (buffer.length > 2 * 1024 * 1024) throw new Error('模型正文超过解析预算');
        controller.enqueue(chunk.value);
      } catch (cause) {
        await reader.cancel().catch(() => {});
        if (!(cause instanceof AttemptLedgerError)) {
          await finish('interrupted', upstream, usage, '响应正文读取失败').catch(() => {});
        }
        controller.error(cause);
      }
    },
    async cancel() {
      await reader.cancel();
      await finish('interrupted', upstream, usage, '请求消费中断');
    },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
