import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { editInput, type EditRequest } from './edit-contract.ts';
import { canonicalMediaTree, validateMediaTree, signedMedia, mediaObject } from './private-media.ts';
import { resolveModel } from './model-registry.ts';
import { asrModel, safeMediaDownload } from './audio-provider.ts';
import { jobEvent, publicProductionJob, type ProductionJob } from './production-jobs.ts';
import { timedTranscript } from './structured-analysis.ts';
import { workloadPolicy } from './workload-policy.ts';

export async function createEditJob(db: SupabaseClient, uid: string, key: string, raw: any, projectId?: string) {
  const input = canonicalMediaTree(editInput(raw), uid) as EditRequest;
  if (!mediaObject(input.source.url, Deno.env.get('SUPABASE_URL')!)) throw new Error('请先上传私有音轨素材');
  const prior = await db.from('production_jobs').select('*').eq('user_id', uid).eq('request_key', key).maybeSingle();
  if (prior.error) throw new Error('原剪辑分析请求核对失败');
  if (prior.data) {
    if (prior.data.kind !== 'edit_analysis' || (prior.data.project_id || null) !== (projectId || null)
      || JSON.stringify(editInput(prior.data.payload)) !== JSON.stringify(input)) {
      throw new Error('同一请求标识不能用于不同任务');
    }
    return publicProductionJob(db, prior.data);
  }
  await validateMediaTree(db, input, uid);
  const config = input.mode === 'subtitles' ? await resolveModel('audio.asr', db) : null;
  if (config && (config.settings.protocol !== 'openai-asr' || config.settings.model !== 'whisper-1')) {
    throw new Error('时间轴字幕需配置Whisper分段识别协议与whisper-1模型');
  }
  const created = await db.rpc('create_production_job', { p_user_id: uid, p_request_key: key, p_kind: 'edit_analysis',
    p_payload: input, p_project_id: projectId || null, p_version: config?.version_id || null });
  if (created.error) throw workloadPolicy(created.error) || new Error(/积分不足|队列|价格已更新|配置已更新|同一请求标识|工程不存在|无权/.test(created.error.message)
    ? created.error.message : '剪辑分析创建结果待确认，请恢复原请求');
  return publicProductionJob(db, created.data);
}
export async function processEditJob(db: SupabaseClient): Promise<boolean> {
  const claimed = await db.rpc('claim_production_job', { p_kind: 'edit_analysis', p_job_id: null });
  if (claimed.error) throw new Error('剪辑分析任务领取失败');
  if (!claimed.data) return false;
  const job = claimed.data as ProductionJob;
  let executing = false, leaseFailed = false;
  const heartbeat = setInterval(() => { void jobEvent(db, job, 'heartbeat').catch(() => { leaseFailed = true; }); }, 30000);
  try {
    if (job.resolution) { await jobEvent(db, job, job.resolution.event, job.resolution.data); return true; }
    if (job.payload.mode !== 'subtitles' || !job.evidence?.audio_url) throw new Error('字幕音轨证据缺失');
    if (!job.evidence.output) {
      const audio = await safeMediaDownload(await signedMedia(db, job.evidence.audio_url, job.user_id), 20 * 1024 * 1024);
      const config = await resolveModel('audio.asr', db, job.model_config_version_id!);
      if (leaseFailed) throw new Error('字幕任务租约失效');
      await jobEvent(db, job, 'executing'); executing = true;
      const transcript = await asrModel(config, new File([audio.bytes], 'timeline.wav', { type: 'audio/wav' }));
      const segments = timedTranscript(transcript.segments, job.evidence.duration);
      if (segments.some(segment => segment.text.length > 2000 || segment.end - segment.start < .02)) {
        throw new Error('ASR时间戳或单段正文不适合时间轴');
      }
      const output = { mode: 'subtitles', source: job.payload.source, duration: job.evidence.duration,
        source_hash: job.evidence.source_hash, segments, text: transcript.text, asr_version: job.model_config_version_id };
      const evidence = { ...job.evidence, output };
      await jobEvent(db, job, 'checkpoint', evidence); job.evidence = evidence; executing = false;
    }
    await jobEvent(db, job, 'completed', job.evidence.output);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '字幕识别失败';
    if (/模型返回 HTTP (400|401|402|403|404|405|413|415|422|429)\b|ASR未提供|ASR时间戳|语音识别未返回/.test(message)) {
      await jobEvent(db, job, 'failed', { error: message });
    } else if (executing) await jobEvent(db, job, 'unknown', { error: '字幕识别受理结果未知，请核对原请求，避免重复识别' });
    else await jobEvent(db, job, 'retry', { error: message });
  } finally { clearInterval(heartbeat); }
  return true;
}
