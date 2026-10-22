export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const optionFlags = ['disable_comment', 'disable_duet', 'disable_stitch',
  'brand_content_toggle', 'brand_organic_toggle', 'is_aigc'] as const;
export type PublishOptions = Record<typeof optionFlags[number], boolean> & { consent: boolean; privacy_level: string };
export type PublishTarget = { connection_id: string; options: PublishOptions };
export type PublishGroupRequest = {
  project_id: string; title: string; description: string; tags: string[];
  source_url: string; duration: number; scheduled_at: string | null; targets: PublishTarget[];
  batch_item_id?: string;
};
export function publishOptions(value: any): PublishOptions {
  if (!value || value.consent !== true || typeof value.privacy_level !== 'string' || !value.privacy_level
    || optionFlags.some(flag => typeof value[flag] !== 'boolean')) {
    throw new Error('请逐账号确认发布、可见范围和完整发布选项');
  }
  return { consent: true, privacy_level: value.privacy_level,
    ...Object.fromEntries(optionFlags.map(flag => [flag, value[flag]])) } as PublishOptions;
}
export function groupRequest(body: any): PublishGroupRequest {
  if (!uuid(body.request_key) || !uuid(body.project_id) || typeof body.title !== 'string'
    || !body.title.trim() || body.title.length > 150 || typeof body.description !== 'string'
    || body.description.length > 1000 || !Array.isArray(body.tags) || body.tags.length > 10
    || body.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 30)
    || typeof body.source_url !== 'string' || !body.source_url.startsWith('https://') || body.source_url.length > 4000
    || !Number.isFinite(body.duration) || body.duration <= 0
    || !Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > 10
    || body.targets.some((target: any) => !target || !uuid(target.connection_id))
    || body.batch_item_id !== undefined && !uuid(body.batch_item_id)) {
    throw new Error('请选择成片和1至10个账号，标题、简介或标签超出限制');
  }
  const targets: PublishTarget[] = body.targets.map((target: any) => ({
    connection_id: target.connection_id.toLowerCase(), options: publishOptions(target.options),
  })).sort((a: PublishTarget, b: PublishTarget) => a.connection_id.localeCompare(b.connection_id));
  if (new Set(targets.map(target => target.connection_id)).size !== targets.length) throw new Error('不能重复选择同一账号');
  if (body.scheduled_at != null && (typeof body.scheduled_at !== 'string' || !Number.isFinite(Date.parse(body.scheduled_at)))) {
    throw new Error('定时发布时间无效');
  }
  return { project_id: body.project_id.toLowerCase(), title: body.title, description: body.description,
    tags: body.tags, source_url: body.source_url, duration: body.duration,
    scheduled_at: body.scheduled_at == null ? null : new Date(body.scheduled_at).toISOString(), targets,
    ...(body.batch_item_id ? { batch_item_id: body.batch_item_id.toLowerCase() } : {}) };
}
export function capabilityError(info: any, options: PublishOptions, duration: number): string | null {
  if (!Array.isArray(info?.privacy_level_options) || !info.privacy_level_options.includes(options.privacy_level)) {
    return '可见范围不符合账号权限';
  }
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(info.max_video_post_duration_sec)
    || duration > info.max_video_post_duration_sec) return '视频时长不符合账号限制';
  if (info.platform === 'tiktok') {
    if (info.comment_disabled && !options.disable_comment || info.duet_disabled && !options.disable_duet
      || info.stitch_disabled && !options.disable_stitch) return '互动选项不符合账号权限，请刷新账号选项';
    if (options.brand_content_toggle && options.privacy_level === 'SELF_ONLY') return '付费合作推广不能设为仅自己可见';
  }
  return null;
}
