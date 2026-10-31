import { createParser } from 'eventsource-parser';
import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
import { transcribeAudio, synthesizeSpeech, base64ToBlob } from '@/services/audio';
import { requireAccountSession } from '@/api/accountSession';

export interface DeepSeekStreamOptions {
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  knowledge_job_id?: string;
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
  expectedUserId?: string;
}

/** 方舟及备用通道由服务端配置；中断或失败不会用模板伪造成模型结果。 */
export async function sendDeepSeekStreamRequest(options: DeepSeekStreamOptions): Promise<void> {
  const { messages, max_tokens, temperature, onData, onComplete, onError, signal } = options;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const userId = (await requireAccountSession(options.expectedUserId)).user.id;
    const response = await authenticatedEdgeRequest('text-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens, temperature, stream: true, knowledge_job_id: options.knowledge_job_id }),
      signal,
    }, '', userId);
    if (!response.body) throw new Error('AI 服务未返回响应');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = false;
    let done = false;
    let streamError: Error | undefined;
    const parser = createParser({
      onEvent(event) {
        if (event.data === '[DONE]') { done = true; return; }
        if (!event.data) return;
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            streamError = new Error(data.error.message || '文本生成失败');
            return;
          }
          const text = data.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text) {
            received = true;
            onData(text);
          }
        } catch {
          streamError = new Error('AI 服务返回了无效流式数据');
        }
      },
    });
    while (!done) {
      const chunk = await reader.read();
      await requireAccountSession(userId);
      if (chunk.done) break;
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    parser.feed(decoder.decode());
    if (signal?.aborted) return;
    if (streamError) throw streamError;
    if (!received) throw new Error('模型未返回正文，请检查模型配置');
    if (!done) throw new Error('文本生成连接中断，请重试');
    await requireAccountSession(userId);
    onComplete();
  } catch (cause) {
    if (!signal?.aborted) onError(cause instanceof Error ? cause : new Error('文本生成失败'));
  } finally {
    await reader?.cancel().catch(() => {});
  }
}

export type StepFlashStreamOptions = DeepSeekStreamOptions;
export const sendStepFlashStreamRequest = sendDeepSeekStreamRequest;

export interface StepASROptions {
  audioData: string;
  expectedUserId?: string;
  format?: { type: string; codec: string; rate: number; bits: number; channel: number };
  language?: string;
  onData: (text: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function sendStepAudioASR(options: StepASROptions): Promise<void> {
  try {
    const result = await transcribeAudio({
      file: base64ToBlob(options.audioData, 'audio/wav'),
      signal: options.signal,
      language: options.language,
      expectedUserId: options.expectedUserId,
    });
    if (options.signal?.aborted) return;
    if (!result.text.trim()) throw new Error('未识别到清晰语音，请重试或键入提示词');
    options.onData(result.text.trim());
    options.onComplete();
  } catch (cause) {
    if (!options.signal?.aborted) options.onError(cause instanceof Error ? cause : new Error('语音识别失败'));
  }
}

export interface StepTTSOptions {
  input: string;
  voice?: string;
  speed?: number;
  instruction?: string;
  response_format?: string;
}

export async function sendStepAudioTTS(options: StepTTSOptions): Promise<string> {
  const result = await synthesizeSpeech({
    input: options.input,
    voice: options.voice,
    speed: options.speed,
    instruction: options.instruction,
    response_format: options.response_format as 'mp3' | 'wav' | 'opus',
  });
  return result.audioUrl;
}
