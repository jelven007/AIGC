import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveModel } from './model-registry.ts';
import { mediaObject, validateMediaTree } from './private-media.ts';
import { validateRender } from './render-spec.ts';
import { editInput } from './edit-contract.ts';
import type { BatchRequest } from './batch-video.ts';

export async function pipelineVersions(db: SupabaseClient, request: BatchRequest, videoVersion: string) {
  const tts = await resolveModel('audio.tts', db);
  const asr = request.pipeline!.subtitles ? await resolveModel('audio.asr', db) : null;
  if (asr && (asr.settings.protocol !== 'openai-asr' || asr.settings.model !== 'whisper-1')) {
    throw new Error('批次字幕需配置Whisper分段识别协议与whisper-1模型');
  }
  return { [`video.${request.provider}`]: videoVersion, 'audio.tts': tts.version_id,
    ...(asr ? { 'audio.asr': asr.version_id } : {}) };
}

export function pipelinePayload(stage: any, dependencies: any[], supabaseUrl: string) {
  const request = stage.request as BatchRequest;
  const duration = request.settings.duration * request.pipeline!.shots.length;
  const privateUrl = (value: unknown) => {
    if (typeof value !== 'string' || !mediaObject(value, supabaseUrl)) throw new Error('批次前置结果缺少私有素材');
    return value;
  };
  const voice = dependencies.find(item => item.kind === 'tts');
  if (stage.kind === 'tts') return stage.spec;
  if (stage.kind === 'subtitles') return { ...editInput({
    mode: request.pipeline!.subtitles ? 'subtitles' : 'beats', title: `${stage.product_name} · 配音测量`.slice(0, 80),
    source: { id: voice.id, type: 'audio', url: privateUrl(voice.result?.url), start: 0, duration, sourceStart: 0, speed: 1 },
    confirmed_credit_cost: stage.credit_cost,
  }), pipeline_audio: true };
  if (stage.kind !== 'render') throw new Error('此阶段不能自动启动');
  const measured = dependencies.find(item => item.kind === 'subtitles')?.result;
  if (!measured || !Number.isFinite(measured.duration) || measured.duration <= 0 || measured.duration > duration) {
    throw new Error('批次缺少真实配音时长证据');
  }
  const videos = dependencies.filter(item => item.kind === 'video').sort((a, b) => a.position - b.position);
  if (videos.length !== request.pipeline!.shots.length) throw new Error('批次镜头数量不一致');
  const tracks: Record<string, any>[] = videos.map((item, index) => ({
    id: item.id, name: `${stage.product_name} · 镜头${index + 1}`, type: 'video', trackId: 'video', url: privateUrl(item.result?.video_url),
    start: index * request.settings.duration, duration: request.settings.duration, sourceStart: 0, speed: 1, volume: 0,
  }));
  tracks.push({ id: voice.id, name: `${stage.product_name} · 配音`, type: 'audio', trackId: 'audio', url: privateUrl(voice.result?.url),
    start: 0, duration: measured.duration, sourceStart: 0, speed: 1, volume: 100 });
  if (request.pipeline!.subtitles) {
    if (!Array.isArray(measured.segments) || measured.segments.length < 1 || measured.segments.length > 70) {
      throw new Error('字幕分段超过单工程70段上限或缺少实际时间戳');
    }
    tracks.push(...measured.segments.map((segment: any, index: number) => ({
      id: `subtitle-${index}`, type: 'text', trackId: 'text', start: segment.start, duration: segment.end - segment.start,
      name: segment.text, text: segment.text, fontSize: 36, x: 50, y: 85, fontColor: '#ffffff', strokeColor: '#000000', strokeWidth: 2,
    })));
  }
  return validateRender({ version: 1, title: `${stage.product_name} · 批量成片`.slice(0, 80),
    duration, ratio: request.settings.ratio, height: request.settings.resolution === '1080P' ? 1080 : 720,
    fps: 30, transition: request.pipeline!.transition, transitionDuration: .25, tracks });
}

export async function processBatchPipeline(db: SupabaseClient): Promise<boolean> {
  const candidates = await db.rpc('advance_batch_pipeline', { p_batch: null });
  if (candidates.error || !Array.isArray(candidates.data)) throw new Error('批次编排推进失败');
  for (const stage of candidates.data) {
    const dependencies = stage.depends_on.length
      ? await db.from('batch_pipeline_state').select('*').in('id', stage.depends_on).eq('user_id', stage.user_id)
      : { data: [], error: null };
    if (dependencies.error) throw new Error('批次依赖读取失败');
    let payload;
    try {
      payload = pipelinePayload(stage, dependencies.data || [], Deno.env.get('SUPABASE_URL')!);
    } catch (cause) {
      const failed = await db.rpc('fail_batch_pipeline_stage', { p_stage: stage.id,
        p_error: cause instanceof Error ? cause.message : '批次前置结果非法' });
      if (failed.error) throw new Error('批次阶段结案失败');
      return true;
    }
    // 存储临时故障不视为模型确定失败，原阶段与预算继续保留。
    await validateMediaTree(db, payload, stage.user_id);
    const started = await db.rpc('start_batch_pipeline_stage', { p_stage: stage.id, p_payload: payload });
    if (started.error) throw new Error('批次阶段启动结果待恢复');
    if (started.data) return true;
  }
  return false;
}
