import { modelFetch, resolveModel } from './model-registry.ts';
export interface TextMessage { role: string; content: string }

export async function requestTextModel(
  messages: TextMessage[],
  options: { stream?: boolean; temperature?: number; max_tokens?: number } = {},
) {
  for (const slot of ['text.primary', 'text.fallback']) {
    try {
      const config = await resolveModel(slot);
      return await modelFetch(config, JSON.stringify({
        model: config.settings.model, messages, stream: options.stream ?? false,
        temperature: options.temperature ?? 0.7, max_tokens: options.max_tokens ?? 4096,
      }));
    } catch {
      if (slot === 'text.fallback') throw new Error('文本主备模型不可用，请核对模型设置与权限');
    }
  }
  throw new Error('文本模型不可用');
}

export async function generateText(messages: TextMessage[]): Promise<string> {
  const response = await requestTextModel(messages);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('文本模型未返回正文');
  return text;
}
