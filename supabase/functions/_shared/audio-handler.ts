import { authenticateRequest, createServiceClient } from './auth.ts';
import { getCorsHeaders, handleCorsPreflight } from './cors.ts';
import { modelFetch, resolveModel } from './model-registry.ts';

export async function handleAudio(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return Response.json({ error: '仅支持 POST' }, { status: 405, headers });
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return Response.json({ error: '请先登录' }, { status: 401, headers });
    const multipart = req.headers.get('content-type')?.includes('multipart/form-data');
    const body = multipart ? null : await req.json().catch(() => null);
    const action = new URL(req.url).searchParams.get('action') || body?.action || 'tts';
    if (!['tts', 'asr'].includes(action)) return Response.json({ error: '音频操作不支持' }, { status: 400, headers });
    const db = createServiceClient();
    const start = Math.floor(Date.now() / 60000) * 60000;
    const limit = await db.rpc('upsert_rate_limit', { p_window_key: `audio:${auth.user.id}:${start}`,
      p_client_id: `audio:${auth.user.id}`, p_reset_at: new Date(start + 60000).toISOString(), p_max_req: 10 });
    if (limit.error) throw new Error('音频限流服务不可用');
    if (!limit.data) return Response.json({ error: '音频请求过于频繁' }, { status: 429, headers });
    const config = await resolveModel(`audio.${action}`, db);
    if (action === 'tts') {
      if (typeof body?.input !== 'string' || !body.input.trim() || body.input.length > 8000) throw new Error('配音文本应为 1–8000 字');
      const format = body.response_format || 'mp3';
      if (!['mp3', 'wav', 'opus'].includes(format)) throw new Error('配音格式不支持');
      if (body.voice && (typeof body.voice !== 'string' || body.voice.length > 200)) throw new Error('音色参数不正确');
      const upstream = await modelFetch(config, JSON.stringify({
        model: config.settings.model, input: body.input, voice: body.voice || config.settings.voice,
        response_format: format, stream: false,
        ...(config.settings.protocol === 'step-tts' ? { instruction: String(body.instruction || '').slice(0, 500) } : {}),
      }));
      return new Response(upstream.body, { headers: { ...headers,
        'Content-Type': format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg' } });
    }
    let file: File | null = null;
    if (multipart) {
      const value = (await req.formData()).get('file');
      if (value instanceof File) file = value;
    }
    if (config.settings.protocol === 'openai-asr') {
      if (!file || file.size > 20 * 1024 * 1024) throw new Error('请上传不超过 20MB 的音频文件');
      const form = new FormData(); form.append('file', file); form.append('model', config.settings.model);
      const upstream = await modelFetch(config, form, false);
      const data = await upstream.json().catch(() => null);
      if (typeof data?.text !== 'string') throw new Error('语音识别未返回正文');
      return Response.json({ text: data.text }, { headers });
    }
    let audioData = body?.audioData;
    if (file) {
      if (file.size > 20 * 1024 * 1024) throw new Error('音频文件超过 20MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      audioData = btoa(binary);
    }
    if (typeof audioData !== 'string' || !audioData || audioData.length > 28_000_000) throw new Error('音频数据不正确');
    const format = body?.format || (file ? { type: file.name.endsWith('.wav') ? 'wav' : 'mp3' }
      : { type: 'pcm', codec: 'pcm_s16le', rate: 16000, bits: 16, channel: 1 });
    const upstream = await modelFetch(config, JSON.stringify({ audio: {
      data: audioData, input: { transcription: { model: config.settings.model, language: body?.language || 'zh', enable_itn: true }, format },
    } }));
    if (body?.stream) return new Response(upstream.body, { headers: { ...headers, 'Content-Type': 'text/event-stream' } });
    if (!upstream.body) throw new Error('语音识别未返回正文');
    const reader = upstream.body.getReader(), decoder = new TextDecoder();
    let buffer = '', text = '';
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') return;
      try { const data = JSON.parse(raw); text += data.choices?.[0]?.delta?.content || data.text || ''; } catch {}
    };
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(consume);
      if (text.length > 100000 || buffer.length > 1000000) { await reader.cancel(); throw new Error('识别响应过大'); }
    }
    consume(buffer);
    if (!text.trim()) throw new Error('语音识别未返回正文');
    return Response.json({ text }, { headers });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : '音频服务暂不可用' }, { status: 503, headers });
  }
}
