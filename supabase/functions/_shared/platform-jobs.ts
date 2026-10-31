import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { connectionToken, creatorInfo, officialJson, PlatformError, type Platform } from './platforms.ts';
import { jobEvent, type ProductionJob } from './production-jobs.ts';
import { signedMedia } from './private-media.ts';
import { mediaFetch, validateMediaEndpoint } from './media-endpoint.ts';
import { capabilityError } from './publish-contract.ts';

export async function publishSource(db: SupabaseClient, job: ProductionJob): Promise<Uint8Array> {
  const source = await signedMedia(db, job.payload.source_url, job.user_id, 3600);
  const checked = new URL(source); checked.search = '';
  await validateMediaEndpoint(checked.href);
  const response = await mediaFetch(source, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('video/')) throw new Error('发布素材读取失败');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 50 * 1024 * 1024) throw new Error('当前发布通道支持50MB以内成片，请先压缩');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('成片为空');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function douyinVideo(token: string, openId: string, itemId: string) {
  const data = await officialJson('douyin',
    `https://open.douyin.com/api/douyin/v1/video/video_data/?open_id=${encodeURIComponent(openId)}`, token,
    { item_ids: [itemId] });
  return data.list?.find((item: any) => item.item_id === itemId);
}

export async function processPublishJob(db: SupabaseClient): Promise<boolean> {
  const claimed = await db.rpc('claim_production_job', { p_kind: 'publish', p_job_id: null });
  if (claimed.error) throw new Error('发布任务领取失败');
  if (!claimed.data) return false;
  const job = claimed.data as ProductionJob;
  let executing = false, evidence = job.evidence, leaseFailed = false;
  const heartbeat = setInterval(() => {
    void jobEvent(db, job, 'heartbeat').catch(() => { leaseFailed = true; });
  }, 30000);
  const updateTask = async (values: Record<string, unknown>) => {
    const result = await db.from('publish_tasks').update(values).eq('job_id', job.id);
    if (result.error) throw new Error('发布记录写入失败');
  };
  const execute = async () => {
    if (leaseFailed) throw new Error('发布租约失效');
    await jobEvent(db, job, 'executing'); executing = true;
  };
  const checkpoint = async (value: any) => {
    await jobEvent(db, job, 'checkpoint', value); evidence = value; executing = false;
  };
  try {
    if (job.resolution) {
      await jobEvent(db, job, job.resolution.event, job.resolution.data);
      return true;
    }
    const { connection, token } = await connectionToken(db, job.payload.connection_id, job.user_id);
    const platform = connection.platform as Platform, options = job.payload.options;
    const caption = [job.payload.title, job.payload.description, ...job.payload.tags.map((tag: string) => `#${tag}`)].filter(Boolean).join(' ');
    if (!evidence) {
      const info = await creatorInfo(db, connection.id, job.user_id);
      const invalid = options?.consent !== true ? '缺少发布确认' : capabilityError(info, options, job.payload.duration);
      if (invalid) {
        await updateTask({ status: 'failed', error_message: invalid });
        await jobEvent(db, job, 'failed', { error: invalid }); return true;
      }
      const bytes = await publishSource(db, job);
      await updateTask({ status: 'publishing', error_message: null });
      if (platform === 'tiktok') {
        await execute();
        const initialized = await officialJson('tiktok', 'https://open.tiktokapis.com/v2/post/publish/video/init/', token, {
          post_info: {
            title: caption.slice(0, 2200), privacy_level: options.privacy_level,
            disable_comment: options.disable_comment || info.comment_disabled,
            disable_duet: options.disable_duet || info.duet_disabled, disable_stitch: options.disable_stitch || info.stitch_disabled,
            brand_content_toggle: options.brand_content_toggle, brand_organic_toggle: options.brand_organic_toggle, is_aigc: options.is_aigc,
          },
          source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
        });
        if (!initialized.publish_id || !initialized.upload_url) throw new Error('平台缺少发布标识');
        await checkpoint({ publish_id: initialized.publish_id, upload_url: initialized.upload_url, uploaded: false, platform });
      } else {
        // 上传不发布作品；失败可以重新上传。创建作品前保存上传标识。
        const form = new FormData(); form.append('video', new Blob([bytes], { type: 'video/mp4' }), 'video.mp4');
        const uploaded = await fetch(`https://open.douyin.com/api/douyin/v1/video/upload_video/?open_id=${encodeURIComponent(connection.open_id)}`, {
          method: 'POST', headers: { 'access-token': token }, body: form, redirect: 'error', signal: AbortSignal.timeout(60000),
        }).then(result => result.json());
        if (uploaded.data?.error_code !== 0 || !uploaded.data.video?.video_id) throw new Error('抖音素材上传失败');
        await checkpoint({ uploaded_video_id: uploaded.data.video.video_id, platform });
      }
    }
    if (platform === 'douyin' && !evidence.item_id) {
      await execute();
      const published = await officialJson('douyin',
        `https://open.douyin.com/api/douyin/v1/video/create_video/?open_id=${encodeURIComponent(connection.open_id)}`, token,
        { video_id: evidence.uploaded_video_id, text: caption.slice(0, 1000), private_status: Number(options.privacy_level) });
      if (!published.item_id) throw new Error('平台缺少发布标识');
      await checkpoint({ ...evidence, item_id: published.item_id, video_id: published.video_id });
    }
    if (platform === 'tiktok') {
      const status = await officialJson('tiktok', 'https://open.tiktokapis.com/v2/post/publish/status/fetch/', token, { publish_id: evidence.publish_id });
      if (status.status === 'PROCESSING_UPLOAD' && !evidence.uploaded) {
        // 原发布ID与平台返回的字节偏移恢复上传，禁止重新初始化。
        const uploadedBytes = Number(status.uploaded_bytes || 0);
        const bytes = await publishSource(db, job);
        if (!Number.isSafeInteger(uploadedBytes) || uploadedBytes < 0 || uploadedBytes > bytes.length) throw new Error('平台上传偏移无效');
        if (uploadedBytes < bytes.length) {
          const uploadUrl = new URL(evidence.upload_url);
          if (uploadUrl.protocol !== 'https:' || uploadUrl.username || uploadUrl.password
            || uploadUrl.hostname !== 'open-upload.tiktokapis.com') throw new Error('平台上传地址不正确');
          const uploaded = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${uploadedBytes}-${bytes.length - 1}/${bytes.length}` },
            body: bytes.subarray(uploadedBytes), redirect: 'error', signal: AbortSignal.timeout(60000) });
          if (![200, 201, 206].includes(uploaded.status)) throw new Error('平台视频上传失败');
        }
        await checkpoint({ ...evidence, uploaded: true });
      }
      if (status.status === 'FAILED') {
        await updateTask({ status: 'failed', error_message: `平台确认失败：${String(status.fail_reason).slice(0, 120)}` });
        await jobEvent(db, job, 'failed', { error: '平台确认发布失败' });
      } else if (status.status === 'PUBLISH_COMPLETE') {
        const videoId = status.publicaly_available_post_id?.[0] ? String(status.publicaly_available_post_id[0]) : null;
        await updateTask({ status: 'published', published_at: new Date().toISOString(),
          platform_video_id: videoId, platform_url: null, error_message: null });
        await jobEvent(db, job, 'completed', { publish_id: evidence.publish_id, video_id: videoId });
      } else {
        await updateTask({ status: 'submitted' });
        await jobEvent(db, job, 'retry', { error: '等待平台处理与审核', waiting: true });
      }
    } else {
      const video = await douyinVideo(token, connection.open_id, evidence.item_id);
      if (video?.video_status === 1 && video.is_reviewed === true) {
        await updateTask({ status: 'published', platform_video_id: evidence.item_id, platform_url: video.share_url || null,
          published_at: new Date().toISOString(), error_message: null });
        await jobEvent(db, job, 'completed', { item_id: evidence.item_id, video_id: evidence.video_id });
      } else if (video?.video_status === 2 && video.is_reviewed === true) {
        await updateTask({ status: 'failed', platform_video_id: evidence.item_id, error_message: '平台审核未通过公开发布' });
        await jobEvent(db, job, 'failed', { error: '平台审核未通过' });
      } else {
        await updateTask({ status: 'moderating', platform_video_id: evidence.item_id, error_message: '平台已受理，等待确认公开状态' });
        await jobEvent(db, job, 'retry', { error: '等待平台审核结果', waiting: true });
      }
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : '发布处理失败';
    if (executing && cause instanceof PlatformError && cause.rejected) {
      await jobEvent(db, job, 'rejected'); executing = false;
    }
    if (executing) {
      await updateTask({ status: 'unknown', error_message: '发布受理结果未知，请核对平台，禁止重复发布' });
      await jobEvent(db, job, 'unknown', { error: '发布受理结果未知，请核对平台' });
    } else {
      const updated = await jobEvent(db, job, 'retry', { error, waiting: !!evidence?.publish_id || !!evidence?.item_id });
      await updateTask({ ...(updated.status === 'unknown' ? { status: 'unknown' } : {}), error_message: error });
    }
  } finally { clearInterval(heartbeat); }
  return true;
}

export function videoCounts(video: any, platform: Platform): Record<string, number | null> {
  const raw = platform === 'douyin' ? video.statistics || {} : video;
  const fields = platform === 'douyin' ? ['play_count', 'digg_count', 'comment_count', 'share_count']
    : ['view_count', 'like_count', 'comment_count', 'share_count'];
  return Object.fromEntries(['view_count', 'like_count', 'comment_count', 'share_count'].map((field, i) => {
    const value = raw[fields[i]];
    return [field, typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null];
  }));
}

export async function collectPlatformMetrics(db: SupabaseClient, userId?: string) {
  let query = db.from('publish_tasks').select('*').in('status', ['published', 'moderating']).not('connection_id', 'is', null);
  if (userId) query = query.eq('user_id', userId);
  else query = query.lte('metrics_next_at', new Date().toISOString());
  const tasks = await query.order('metrics_next_at', { ascending: true }).limit(20);
  if (tasks.error) throw new Error('数据任务读取失败');
  let collected = 0;
  for (const task of tasks.data || []) {
    if (!task.platform_video_id) continue;
    let error: string | null = null;
    try {
      const { connection, token } = await connectionToken(db, task.connection_id, task.user_id);
      let video;
      if (connection.platform === 'tiktok') {
        const data = await officialJson('tiktok',
          'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count,share_url', token,
          { filters: { video_ids: [task.platform_video_id] } });
        video = data.videos?.find((item: any) => String(item.id) === task.platform_video_id);
      } else video = await douyinVideo(token, connection.open_id, task.platform_video_id);
      if (!video) throw new Error('平台未返回此视频，可能仍在审核或不公开');
      const counts = videoCounts(video, connection.platform);
      const result = await db.rpc('save_platform_metrics', { p_task: task.id, p_metrics: counts, p_url: video.share_url || null });
      if (result.error) throw new Error('指标保存失败');
      collected++;
    } catch (cause) { error = cause instanceof Error ? cause.message : '官方指标暂时不可用'; }
    const saved = await db.from('publish_tasks').update({ metrics_error: error,
      metrics_next_at: new Date(Date.now() + 15 * 60000).toISOString() }).eq('id', task.id);
    if (saved.error) throw new Error('指标同步状态保存失败');
  }
  return collected;
}
