import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { asrModel, encodeAudio, jsonModelResponse, safeMediaDownload, ttsModel } from './audio-provider.ts';
import { modelFetch, resolveModel, validateEndpoint } from './model-registry.ts';
import { canonicalMediaTree, mediaReference, signedMedia, validateMediaTree } from './private-media.ts';
import { jobEvent, publicProductionJob, type ProductionJob } from './production-jobs.ts';

export const MEDIA_JOB_SLOTS: Record<string, string> = {
  tts: 'audio.tts', asr: 'audio.asr', voice_clone: 'audio.voice_clone', avatar: 'avatar.photo', lipsync: 'avatar.lipsync',
};
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
function normalizedInput(kind: string, raw: any): Record<string, any> {
  if (!MEDIA_JOB_SLOTS[kind] || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('媒体任务参数非法');
  const text = (key: string, max: number, required = true) => {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new Error(`参数 ${key} 不正确`);
    return value.trim();
  };
  const url = (key: string) => { const value = text(key, 2048); const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('素材应为 HTTPS 地址');
    return value; };
  if (kind === 'tts') {
    const result: Record<string, any> = { input: text('input', 8000), voice: text('voice', 200, false),
      response_format: raw.response_format || 'mp3', speed: raw.speed ?? 1, instruction: text('instruction', 500, false) };
    if (!['mp3', 'wav', 'opus'].includes(result.response_format) || !Number.isFinite(result.speed)
      || result.speed < 0.5 || result.speed > 2) throw new Error('配音格式或语速不支持');
    if (raw.voice_clone_id) {
      if (!uuid(raw.voice_clone_id) || result.speed < 0.7 || result.speed > 1.2 || result.response_format !== 'mp3') {
        throw new Error('克隆声纹仅支持 MP3，语速范围0.7–1.2');
      }
      result.voice_clone_id = raw.voice_clone_id;
    }
    return result;
  }
  if (kind === 'asr' || kind === 'voice_clone') {
    const filename = text('filename', 120);
    if (!/\.(wav|mp3|m4a|ogg|webm|flac|mp4)$/i.test(filename) || /[/\\]/.test(filename)) throw new Error('音频文件名不支持');
    const result: Record<string, any> = { audio_url: url('audio_url'), filename };
    if (kind === 'voice_clone') {
      if (raw.consent !== true) throw new Error('请确认已取得样本声音的克隆授权');
      return { ...result, name: text('name', 80), consent: true };
    }
    const language = text('language', 10, false);
    if (language && !/^[a-z]{2,3}$/.test(language)) throw new Error('语言应为ISO语言代码');
    return { ...result, language };
  }
  if (raw.consent !== true) throw new Error('请确认已取得人物形象及音频使用授权');
  return { title: text('title', 100), audio_url: url('audio_url'), consent: true,
    ...(kind === 'avatar' ? { image_url: url('image_url') } : { video_url: url('video_url') }) };
}
export function mediaJobInput(kind: string, raw: any): Record<string, any> {
  const input = normalizedInput(kind, raw);
  if (raw.confirmed_credit_cost !== undefined) {
    if (!Number.isInteger(raw.confirmed_credit_cost) || raw.confirmed_credit_cost < 0 || raw.confirmed_credit_cost > 100000) throw new Error('确认价格非法');
    input.confirmed_credit_cost = raw.confirmed_credit_cost;
  }
  return input;
}
export async function createMediaJob(db: SupabaseClient, uid: string, kind: string, key: string, raw: unknown, projectId?: string) {
  if (!uuid(key) || projectId && !uuid(projectId)) throw new Error('缺少有效的任务标识');
  const input = canonicalMediaTree(mediaJobInput(kind, raw), uid);
  const prior = await db.from('production_jobs').select('*').eq('user_id', uid).eq('request_key', key).maybeSingle();
  if (prior.error) throw new Error('原任务核对失败');
  if (prior.data) {
    const comparable = (value: Record<string, any>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    if (prior.data.kind !== kind || comparable(prior.data.payload) !== comparable(input)
      || projectId && prior.data.project_id !== projectId) throw new Error('同一请求标识不能用于不同任务');
    return publicProductionJob(db, prior.data);
  }
  await validateMediaTree(db, input, uid);
  let clone;
  if (input.voice_clone_id) {
    const found = await db.from('voice_clones').select('*').eq('id', input.voice_clone_id).eq('user_id', uid).maybeSingle();
    if (found.error || !found.data || found.data.requires_verification) throw new Error('声纹不存在或需完成供应商验证');
    clone = found.data;
  }
  const config = await resolveModel(clone ? 'audio.voice_clone' : MEDIA_JOB_SLOTS[kind], db, clone?.model_config_version_id);
  if (kind === 'tts' && !clone && !input.voice && !config.settings.voice) throw new Error('请填写供应商音色ID或由管理员设置默认音色');
  if (kind === 'tts' && config.settings.protocol === 'step-tts' && input.speed !== 1) throw new Error('Step协议请在配音指令中描述语速，数值语速设为1');
  if (kind === 'asr' && config.settings.protocol === 'step-asr' && !/\.(wav|mp3)$/i.test(input.filename)) throw new Error('Step ASR 当前仅接受 WAV/MP3');
  const created = await db.rpc('create_production_job', { p_user_id: uid, p_request_key: key, p_kind: kind,
    p_payload: input, p_project_id: projectId || null, p_version: config.version_id });
  if (created.error) throw new Error(created.error.message.includes('积分不足') ? '积分不足'
    : /队列|配置已更新|价格已更新|声纹|同一请求标识/.test(created.error.message) ? created.error.message : '任务创建结果待确认，请使用原请求恢复');
  return publicProductionJob(db, created.data);
}
async function archive(db: SupabaseClient, job: ProductionJob, bytes: Uint8Array, type: string, extension: string) {
  const path = `${job.user_id}/media-jobs/${job.id}/output.${extension}`;
  const result = await db.storage.from('materials').upload(path, new Blob([bytes], { type }), { contentType: type, upsert: true });
  if (result.error) throw new Error('媒体归档失败，将继续恢复');
  return { url: mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', path), size: bytes.length };
}
export async function processMediaJob(db: SupabaseClient, kind: string, id?: string): Promise<boolean> {
  const claimed = await db.rpc('claim_production_job', { p_kind: kind, p_job_id: id || null });
  if (claimed.error) throw new Error('媒体任务领取失败');
  if (!claimed.data) return false;
  const job = claimed.data as ProductionJob;
  let submitted = false, checkpointed = !!job.evidence, leaseFailed = false;
  const heartbeat = setInterval(() => {
    void jobEvent(db, job, 'heartbeat').catch(() => { leaseFailed = true; });
  }, 30000);
  const executing = async () => {
    if (leaseFailed) throw new Error('任务租约已失效');
    await jobEvent(db, job, 'executing'); submitted = true;
  };
  const checkpoint = async (data: any) => { await jobEvent(db, job, 'checkpoint', data); job.evidence = data; checkpointed = true; };
  try {
    if (job.resolution) { await jobEvent(db, job, job.resolution.event, job.resolution.data); return true; }
    const config = await resolveModel(job.kind === 'tts' && job.payload.voice_clone_id ? 'audio.voice_clone'
      : MEDIA_JOB_SLOTS[job.kind], db, job.model_config_version_id!);
    if (kind === 'tts') {
      if (!job.evidence) {
        let voiceId;
        if (job.payload.voice_clone_id) {
          const clone = await db.from('voice_clones').select('*').eq('id', job.payload.voice_clone_id)
            .eq('user_id', job.user_id).eq('model_config_version_id', job.model_config_version_id).single();
          if (clone.error || !clone.data || clone.data.requires_verification) throw new Error('任务声纹不可用');
          voiceId = clone.data.provider_voice_id;
        }
        await executing();
        const audio = await ttsModel(config, job.payload, voiceId);
        await checkpoint({ audio_b64: encodeAudio(audio.bytes), type: audio.type });
      }
      const bytes = Uint8Array.from(atob(job.evidence.audio_b64), char => char.charCodeAt(0));
      const output = await archive(db, job, bytes, job.evidence.type, job.payload.response_format || 'mp3');
      await jobEvent(db, job, 'completed', { ...output, format: job.payload.response_format || 'mp3' });
    } else if (kind === 'asr' || kind === 'voice_clone') {
      if (!job.evidence) {
        const url = await signedMedia(db, job.payload.audio_url, job.user_id, 3600);
        const audio = await safeMediaDownload(url, 20 * 1024 * 1024);
        if (!audio.type.startsWith('audio/') && audio.type !== 'video/mp4') throw new Error('素材不是音频文件');
        const file = new File([audio.bytes], job.payload.filename, { type: audio.type });
        let data;
        if (kind === 'asr') { await executing(); data = await asrModel(config, file, job.payload.language); }
        else {
          const form = new FormData(); form.append('name', job.payload.name); form.append('files', file);
          const selected = { ...config, settings: { ...config.settings, endpoint: `${config.settings.endpoint.replace(/\/$/, '')}/voices/add` } };
          await executing();
          data = await jsonModelResponse(await modelFetch(selected, form, false));
          if (typeof data?.voice_id !== 'string' || !data.voice_id || typeof data.requires_verification !== 'boolean') throw new Error('供应商未返回有效声纹');
          data = { voice_id: data.voice_id, requires_verification: data.requires_verification };
        }
        await checkpoint(data);
      }
      await jobEvent(db, job, 'completed', job.evidence);
    } else {
      if (!job.evidence) {
        const payload = await Promise.all([
          signedMedia(db, job.payload.image_url || job.payload.video_url, job.user_id, 3600),
          signedMedia(db, job.payload.audio_url, job.user_id, 3600),
        ]);
        for (const value of payload) { const url = new URL(value); url.search = ''; await validateEndpoint(url.href); }
        const upstreamBody = kind === 'avatar'
          ? { source_url: payload[0], script: { type: 'audio', audio_url: payload[1] }, user_data: job.id }
          : { model: config.settings.model, input: [{ type: 'video', url: payload[0] }, { type: 'audio', url: payload[1] }] };
        await executing();
        const selected = kind === 'lipsync' ? { ...config, headers: { ...config.headers, 'Idempotency-Key': job.id } } : config;
        const data = await jsonModelResponse(await modelFetch(selected, JSON.stringify(upstreamBody)));
        if (typeof data?.id !== 'string' || !/^[\w@.-]{1,200}$/.test(data.id)) throw new Error('供应商未返回有效任务ID');
        await checkpoint({ provider_task_id: data.id });
      }
      const query = `${config.settings.query_endpoint.replace(/\/$/, '')}/${encodeURIComponent(job.evidence.provider_task_id)}`;
      await validateEndpoint(query);
      const response = await fetch(query, { headers: config.headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`查询返回 HTTP ${response.status}`);
      const data = await jsonModelResponse(response);
      const status = kind === 'avatar' ? data.status : String(data.status).toLowerCase();
      if (['error', 'failed', 'rejected'].includes(status)) {
        await jobEvent(db, job, 'failed', { error: '供应商确认数字人任务失败，请核对输入素材和供应商控制台' }); return true;
      }
      if (!['done', 'completed'].includes(status)) {
        if (Date.now() - Date.parse(job.created_at) > 48 * 3600000) {
          await jobEvent(db, job, 'unknown', { error: '供应商超过48小时未返回终态，需核对原任务' });
        } else await jobEvent(db, job, 'retry', { waiting: true });
        return true;
      }
      const url = kind === 'avatar' ? data.result_url : data.outputUrl;
      if (typeof url !== 'string') throw new Error('供应商完成结果缺少媒体地址');
      const media = await safeMediaDownload(url, 80 * 1024 * 1024);
      if (new TextDecoder().decode(media.bytes.subarray(4, 8)) !== 'ftyp') throw new Error('供应商未返回有效MP4');
      const output = await archive(db, job, media.bytes, 'video/mp4', 'mp4');
      const duration = kind === 'avatar' ? data.metadata?.duration ?? data.duration : data.outputDuration;
      await jobEvent(db, job, 'completed', { ...output, ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}) });
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '媒体任务失败';
    if (submitted && !checkpointed && /模型返回 HTTP (400|401|402|403|404|405|413|415|422|429|451)\b/.test(message)) {
      await jobEvent(db, job, 'failed', { error: message });
    } else if (checkpointed || !submitted) await jobEvent(db, job, 'retry', { error: message });
    else await jobEvent(db, job, 'unknown', { error: '供应商受理结果待核对，原任务与积分预占保留，禁止重复提交' });
  } finally { clearInterval(heartbeat); }
  return true;
}
