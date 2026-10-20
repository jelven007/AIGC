import { authenticatedEdgeRequest } from '@/lib/edgeRequest';

export interface TranscriptionOptions {
  file: Blob | File;
  model?: string;
  signal?: AbortSignal;
}
export interface SpeechOptions {
  input: string;
  voice?: string;
  model?: string;
  response_format?: 'mp3' | 'wav' | 'opus';
  stream?: boolean;
}
export function base64ToBlob(data: string, contentType = 'audio/wav'): Blob {
  const bytes = atob(data.replace(/^data:[^,]+,/, ''));
  return new Blob([Uint8Array.from(bytes, character => character.charCodeAt(0))], { type: contentType });
}
export async function transcribeAudio(options: TranscriptionOptions): Promise<{ text: string }> {
  const form = new FormData();
  form.append('file', options.file, options.file instanceof File ? options.file.name : 'audio.wav');
  const response = await authenticatedEdgeRequest('siliconflow-audio', {
    method: 'POST', body: form, signal: options.signal,
  }, '?action=asr');
  const data = await response.json();
  if (typeof data.text !== 'string') throw new Error('语音服务未返回识别结果');
  return { text: data.text };
}
export async function synthesizeSpeech(options: SpeechOptions): Promise<{ audioUrl: string; blob: Blob }> {
  const response = await authenticatedEdgeRequest('siliconflow-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: options.input, voice: options.voice, response_format: options.response_format || 'mp3',
    }),
  }, '?action=tts');
  const blob = await response.blob();
  return { audioUrl: URL.createObjectURL(blob), blob };
}
