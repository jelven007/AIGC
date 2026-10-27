import { ConfigError, ModelRequestError, modelFetch, resolveModel } from './model-registry.ts';
import { AttemptLedgerError } from './model-context.ts';
export class TextModelUnavailable extends Error {
  constructor(public rejected: boolean) { super('文本主备模型不可用，请核对模型设置与权限'); }
}
export interface TextMessage {
  role: string;
  content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
}

export async function requestTextModel(
  messages: TextMessage[],
  options: { stream?: boolean; temperature?: number; max_tokens?: number; requireVision?: boolean; totalTimeoutMs?: number } = {},
) {
  const budget = options.totalTimeoutMs ?? 60000;
  if (!Number.isInteger(budget) || budget < 1 || budget > 120000) throw new Error('文本总超时预算不正确');
  const signal = AbortSignal.timeout(budget);
  let uncertain = false;
  for (const slot of ['text.primary', 'text.fallback']) {
    try {
      signal.throwIfAborted();
      const config = await resolveModel(slot);
      signal.throwIfAborted();
      if (options.requireVision && config.settings.supports_vision !== true) continue;
      return await modelFetch(config, JSON.stringify({
        model: config.settings.model, messages, stream: options.stream ?? false,
        temperature: options.temperature ?? 0.7, max_tokens: options.max_tokens ?? 4096,
      }), true, signal);
    } catch (cause) {
      if (cause instanceof AttemptLedgerError) throw cause;
      if (!(cause instanceof ConfigError) && !(cause instanceof ModelRequestError && cause.outcome === 'rejected')) uncertain = true;
      signal.throwIfAborted();
      if (slot === 'text.fallback') throw new TextModelUnavailable(!uncertain);
    }
  }
  throw new TextModelUnavailable(true);
}

export async function generateText(messages: TextMessage[], options: { requireVision?: boolean; allowEmpty?: boolean } = {}): Promise<string> {
  const response = await requestTextModel(messages, options);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim() && !options.allowEmpty) throw new Error('文本模型未返回正文');
  return text;
}
