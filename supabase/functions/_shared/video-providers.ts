// 模型协议只在服务端执行；提交 POST 不自动重发。
export type VideoProvider = 'ArkSeedance' | 'MiniMax' | 'SeedanceMini' | 'Wan3' | 'HappyHorse' | 'Kling' | 'Seedance';
export interface VideoInput {
  prompt: string;
  title: string;
  duration: number;
  resolution: string;
  ratio: string;
  first_frame?: string;
  last_frame?: string;
  reference_images: string[];
  reference_videos: string[];
}
export interface ProviderConfig {
  provider: VideoProvider;
  createUrl: string;
  queryUrl: string;
  headers: Record<string, string>;
}
export class SubmissionError extends Error {
  constructor(message: string, readonly confirmedRejected: boolean) { super(message); }
}
const providers = new Set(['ArkSeedance', 'MiniMax', 'SeedanceMini', 'Wan3', 'HappyHorse', 'Kling', 'Seedance']);
const env = (key: string) => Deno.env.get(key) || '';

export function providerConfig(provider: string): ProviderConfig {
  if (!providers.has(provider)) throw new Error('该视频模型尚未接入服务端');
  if (provider === 'ArkSeedance') {
    const apiKey = env('ARK_API_KEY');
    if (!apiKey || !env('ARK_VIDEO_MODEL')) throw new Error('请在服务端配置 ARK_API_KEY 和 ARK_VIDEO_MODEL');
    const base = (env('ARK_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('方舟地址必须使用 HTTPS');
    const endpoint = `${base}/contents/generations/tasks`;
    return { provider: 'ArkSeedance', createUrl: endpoint, queryUrl: endpoint,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } };
  }
  const prefixes: Record<string, string> = {
    MiniMax: 'OPENAI_NEXT', SeedanceMini: 'SEEDANCE_MINI', Wan3: 'WAN3',
    HappyHorse: 'HAPPYHORSE', Seedance: 'CDANCE', Kling: 'KLING',
  };
  const prefix = prefixes[provider];
  const apiKey = env(`${prefix}_API_KEY`)
    || (provider === 'Kling' ? env('INTEGRATIONS_API_KEY')
      : provider === 'Seedance' ? env('VECTRUST_API_KEY')
      : provider === 'MiniMax' ? env('MINIMAX_API_KEY') : env('TOKENDANCE_API_KEY'));
  if (!apiKey) throw new Error(`${provider} 服务端密钥未配置`);
  const base = (env(`${prefix}_BASE_URL`) || (provider === 'MiniMax'
    ? 'https://api.openai-next.com' : provider === 'Seedance' ? 'https://ai.dxkp.com/v1'
      : 'https://tokendance.space')).replace(/\/+$/, '');
  if (!base.startsWith('https://')) throw new Error('模型服务地址必须使用 HTTPS');
  const paths: Record<string, string> = {
    MiniMax: '/v1/videos', SeedanceMini: '/gateway/ark/v3/generations/tasks',
    Wan3: '/gateway/alibaba/wan3/v1/video-synthesis',
    HappyHorse: '/gateway/alibaba/happyhorse/v1/video-synthesis', Seedance: '/video/generations',
  };
  const createUrl = provider === 'Kling'
    ? env('KLING_CREATE_URL')
    : base + paths[provider];
  const queryUrl = provider === 'Kling'
    ? env('KLING_QUERY_URL')
    : provider === 'Wan3' ? `${base}/gateway/alibaba/wan3/v1/tasks`
      : provider === 'HappyHorse' ? `${base}/gateway/alibaba/happyhorse/v1/tasks` : createUrl;
  if (!createUrl?.startsWith('https://') || !queryUrl?.startsWith('https://')) {
    throw new Error('请配置模型提交与查询 HTTPS 地址');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [provider === 'Kling' ? 'X-Gateway-Authorization' : 'Authorization']: `Bearer ${apiKey}`,
  };
  if (provider === 'HappyHorse' || provider === 'Wan3') headers['X-DashScope-Async'] = 'enable';
  return { provider: provider as VideoProvider, createUrl, queryUrl, headers };
}

function mediaUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('参考素材需为已上传的 HTTPS 地址');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('参考素材需为已上传的 HTTPS 地址');
  return url.href;
}
export function validateVideoInput(provider: string, raw: Record<string, unknown>): VideoInput {
  if (!providers.has(provider)) throw new Error('该视频模型尚未接入服务端');
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 8000) {
    throw new Error('视频描述长度应为 1–8000 字');
  }
  const duration = Number(raw.duration ?? 5);
  if (!Number.isInteger(duration) || duration < 2 || duration > 15) throw new Error('视频时长应为 2–15 秒');
  const ratio = String(raw.ratio ?? '16:9');
  if (!['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'].includes(ratio)) throw new Error('不支持的视频比例');
  const resolution = String(raw.resolution ?? '720P').toUpperCase();
  if (!['480P', '720P', '768P', '1080P'].includes(resolution)) throw new Error('不支持的视频分辨率');
  const list = (key: string) => {
    const values = raw[key] ?? [];
    if (!Array.isArray(values) || values.length > 4) throw new Error('参考素材每类最多 4 个');
    return values.map(mediaUrl).filter((url): url is string => !!url);
  };
  const input: VideoInput = {
    prompt: raw.prompt.trim(),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : raw.prompt.trim().slice(0, 30),
    duration: provider === 'SeedanceMini' ? Math.max(4, duration) : provider === 'HappyHorse' ? Math.max(3, duration) : duration,
    resolution: provider === 'MiniMax' ? '768P' : provider === 'SeedanceMini'
      ? (resolution === '480P' ? '480P' : '720P') : resolution,
    ratio, first_frame: mediaUrl(raw.first_frame), last_frame: mediaUrl(raw.last_frame),
    reference_images: list('reference_images'), reference_videos: list('reference_videos'),
  };
  // 不再静默丢弃表单中模型不支持的素材。
  if (provider === 'ArkSeedance') {
    if (input.resolution === '768P') throw new Error('方舟视频不支持 768P');
    if (input.last_frame && !input.first_frame) throw new Error('尾帧必须与首帧一起使用');
    if ((input.first_frame || input.last_frame) && (input.reference_images.length || input.reference_videos.length)) {
      throw new Error('方舟首尾帧与多模态参考不能混用');
    }
    if (input.reference_videos.length > 3) throw new Error('方舟最多支持 3 个参考视频');
  }
  if (provider === 'Wan3' && (input.last_frame || input.reference_images.length || input.reference_videos.length)) {
    throw new Error('Wan3 当前仅支持文本及首帧图片');
  }
  if (['HappyHorse', 'Kling'].includes(provider) && (input.last_frame || input.reference_videos.length)) {
    throw new Error('该模型当前不支持尾帧及参考视频');
  }
  return input;
}

function content(input: VideoInput) {
  const items: Record<string, unknown>[] = [{ type: 'text', text: input.prompt }];
  const add = (type: string, url: string | undefined, role: string) => {
    if (url) items.push({ type, [type]: { url }, role });
  };
  add('image_url', input.first_frame, 'first_frame');
  add('image_url', input.last_frame, 'last_frame');
  for (const url of input.reference_images) {
    if (url !== input.first_frame && url !== input.last_frame) add('image_url', url, 'reference_image');
  }
  for (const url of input.reference_videos) add('video_url', url, 'reference_video');
  return items;
}
export function providerBody(provider: VideoProvider, input: VideoInput): Record<string, unknown> {
  const items = content(input);
  if (provider === 'ArkSeedance') {
    const model = env('ARK_VIDEO_MODEL');
    if (!model) throw new Error('服务端未配置 ARK_VIDEO_MODEL');
    return { model, content: items, duration: input.duration,
      resolution: input.resolution.toLowerCase(), ratio: input.ratio, watermark: false, generate_audio: true };
  }
  if (provider === 'MiniMax') return {
    model: 'MiniMax-H3', content: items, duration: input.duration, resolution: '768P',
    ...(items.length === 1 ? { ratio: input.ratio === 'adaptive' ? '16:9' : input.ratio } : {}),
  };
  if (provider === 'SeedanceMini') return {
    model: 'seedance-2.0-mini', content: items, duration: input.duration,
    resolution: input.resolution.toLowerCase(), ratio: items.length > 1 && input.ratio === '16:9' ? 'adaptive'
      : input.ratio === 'adaptive' && items.length === 1 ? '16:9' : input.ratio,
  };
  if (provider === 'Seedance') return {
    model: 'Cdance2.0-A', prompt: input.prompt, seconds: String(input.duration),
    metadata: { generate_audio: true, resolution: input.resolution.toLowerCase(), ratio: input.ratio,
      watermark: false, ...(items.length > 1 ? { content: items.slice(1) } : {}) },
  };
  if (provider === 'Kling') return {
    prompt: input.prompt, duration: String(input.duration), aspect_ratio: input.ratio,
    ...(input.first_frame || input.reference_images.length
      ? { image_list: [...(input.first_frame ? [input.first_frame] : []), ...input.reference_images] } : {}),
  };
  if (provider === 'Wan3') return {
    model: 'wan3.0-video-prime', input: { prompt: input.prompt,
      ...(input.first_frame ? { media: [{ type: 'first_frame', url: input.first_frame }] } : {}) },
    parameters: { duration: input.duration, resolution: input.resolution, ratio: input.ratio, audio: false, watermark: false },
  };
  const sizes: Record<string, number[]> = { '16:9': [1280, 720], '9:16': [720, 1280],
    '1:1': [720, 720], '4:3': [960, 720], '3:4': [720, 960] };
  const factor = input.resolution === '1080P' ? 1.5 : 1;
  return {
    model: 'happyhorse-1.1-t2v',
    input: { prompt: input.prompt, ...(input.first_frame ? { img_url: input.first_frame } : {}),
      ...(input.reference_images.length ? { ref_images_url: input.reference_images } : {}) },
    parameters: { duration: input.duration, size: (sizes[input.ratio] || sizes['16:9']).map(n => n * factor).join('*') },
  };
}

export async function submitVideo(config: ProviderConfig, input: VideoInput): Promise<string> {
  let response: Response;
  try {
    response = await fetch(config.createUrl, {
      method: 'POST', headers: config.headers, body: JSON.stringify(providerBody(config.provider, input)),
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
  } catch {
    throw new SubmissionError('上游受理结果未知，需核对后处理', false);
  }
  if (!response.ok) {
    // 408/409/5xx 可能在受理后返回；仅确定的请求拒绝允许释放积分。
    const rejected = [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(response.status);
    throw new SubmissionError(`模型提交返回 HTTP ${response.status}`, rejected);
  }
  try {
    const data = await response.json();
    const id = data.output?.task_id || data.task_id || data.id || data.request_id || data.data?.id || data.data?.task_id;
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('missing task id');
    return id;
  } catch {
    throw new SubmissionError('上游已响应但缺少可核对任务标识', false);
  }
}

export interface VideoOutcome {
  state: 'pending' | 'completed' | 'failed';
  progress?: number;
  url?: string;
  binary?: Response;
  error?: string;
}
export function parseVideoOutcome(provider: VideoProvider, data: Record<string, any>): VideoOutcome {
  const task = data.output || data.data || data;
  const status = String(task.task_status || task.status || '').toLowerCase();
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) {
    return { state: 'failed', error: `${provider} 上游确认任务${status}` };
  }
  if (['success', 'succeeded', 'completed'].includes(status)) {
    const url = task.video_url || task.content?.video_url || task.result_url
      || task.results?.[0]?.url || task.task_result?.videos?.[0]?.url || task.data?.content?.video_url;
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('上游成功响应缺少视频地址');
    return { state: 'completed', url };
  }
  const progress = Number(task.progress);
  // UNKNOWN、接口错误码、缺少状态都不是失败证据。
  return { state: 'pending', progress: Number.isFinite(progress) ? Math.max(0, Math.min(95, progress)) : undefined };
}
export async function queryVideo(config: ProviderConfig, taskId: string): Promise<VideoOutcome> {
  const response = await fetch(`${config.queryUrl}/${encodeURIComponent(taskId)}${config.provider === 'MiniMax' ? '/content' : ''}`, {
    headers: config.headers, signal: AbortSignal.timeout(45_000), redirect: 'error',
  });
  if (config.provider === 'MiniMax' && response.status === 400) {
    // 网关 content 接口通过 400 JSON 返回未完成状态，只读取结构化任务态。
    const data = await response.json().catch(() => ({}));
    const rawStatus = data.task_status || data.status || data.error?.task_status;
    if (rawStatus) return parseVideoOutcome('MiniMax', { status: rawStatus });
    // 此网关也会以固定文本返回任务态；只匹配明确的 task status 语句。
    const match = String(data.error?.message || data.message || '')
      .match(/\btask status is\s+(NOT_START|IN_PROGRESS|FAILED|CANCELLED|CANCELED|EXPIRED)\b/i);
    if (match) return parseVideoOutcome('MiniMax', { status: match[1] });
    throw new Error('MiniMax 查询未返回可确认任务状态');
  }
  if (!response.ok) throw new Error(`模型查询返回 HTTP ${response.status}`);
  if (config.provider === 'MiniMax' && response.headers.get('content-type')?.startsWith('video/')) {
    return { state: 'completed', binary: response };
  }
  return parseVideoOutcome(config.provider, await response.json());
}
