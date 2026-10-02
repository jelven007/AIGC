/**
 * MiniMax H3 视频生成模型对接 (OpenAI Next Gateway)
 * Base URL: https://api.openai-next.com (Dev Proxy: /openai-next-api, Vercel Rewrite 同名)
 * 采用 OpenAI 兼容视频异步协议（/v1/videos 标准入口，上游为 MiniMax 官方 V2 协议）：
 *   - 提交任务: POST /v1/videos  -> { id, object: 'video', status: 'submitted' }
 *   - 轮询结果: GET  /v1/videos/{task_id}/content
 *       * HTTP 200 + content-type=video/mp4  → 任务完成，响应体为成片二进制
 *       * HTTP 400 + "task status is NOT_START/IN_PROGRESS, not completed" → 排队/生成中
 * 由于网关不回传视频直链（GET /v1/videos/{id} 状态接口不可用），完成后的二进制
 * 需转存至 Supabase Storage(materials 公共桶)，以公开 URL 作为 video_url 落库，
 * 同时保证作品封面 Canvas 抽帧不受上游 CORS 限制。
 * 实测规格守卫（避免 400 "resolution must be 768P"）：
 *   - MiniMax-H3 渠道 resolution 强制 768P（大写 P），duration 6 实测通过
 *   - 该 key 网关目录中不存在 MiniMax-H3-Max（503 无渠道），仅有 MiniMax-H3
 * 注意: API Key 仅通过 .env (VITE_OPENAI_NEXT_API_KEY) 注入，禁止在前端源码硬编码。
 */
import { supabase } from '@/db/supabase';

const DEFAULT_OPENAI_NEXT_BASE_URL = 'https://api.openai-next.com';

/** OpenAI Next 网关上绑定的 MiniMax 视频渠道模型名（如后续开通 Max 只需改此常量） */
export const MINIMAX_VIDEO_MODEL = 'MiniMax-H3';

/** 读取 OpenAI Next 网关密钥（优先专用变量，回退历史命名） */
function getApiKey(): string {
  return (
    import.meta.env.VITE_OPENAI_NEXT_API_KEY ||
    import.meta.env.VITE_MINIMAX_API_KEY ||
    ''
  );
}

/** 候选基础地址：代理前缀优先，最后回退直连（无 CORS 头时直连会失败，仅兜底） */
function getCandidateBaseUrls(): string[] {
  const envUrl = import.meta.env.VITE_OPENAI_NEXT_BASE_URL;
  const urls: string[] = [];
  if (envUrl) urls.push(envUrl.replace(/\/+$/, ''));
  urls.push('/openai-next-api');
  urls.push(DEFAULT_OPENAI_NEXT_BASE_URL);
  return Array.from(new Set(urls));
}

export interface MiniMaxContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';
}

export interface MiniMaxVideoPayload {
  /** 画面描述提示词 */
  prompt: string;
  /** 视频时长（秒），文档示例支持 6 / 8 等 */
  duration?: number;
  /** 分辨率（上游强制 768P，保留字段仅为接口兼容） */
  resolution?: string;
  /** 宽高比，纯文生视频必填且不能为 adaptive */
  ratio?: string;
  /** 首帧图片 URL */
  first_frame?: string;
  /** 尾帧图片 URL */
  last_frame?: string;
  /** 参考图片 URL 列表 */
  reference_images?: string[];
  /** 参考视频 URL 列表 */
  reference_videos?: string[];
  /** 参考音频 URL 列表 */
  reference_audios?: string[];
}

export interface MiniMaxSubmitResult {
  task_id: string;
}

export type MiniMaxQueryStatus = 'success' | 'processing' | 'queued' | 'failed';

export interface MiniMaxQueryResult {
  status: MiniMaxQueryStatus;
  video_url?: string;
  error?: string;
  progress?: number;
  outcome?: { video_url?: string; thumbnail_image_url?: string };
}

/** 组装 OpenAI V2 多模态 content 数组（首帧/尾帧/参考素材角色与旧协议一致） */
function buildContent(payload: MiniMaxVideoPayload): {
  content: MiniMaxContentItem[];
  hasVisualRef: boolean;
} {
  const {
    prompt,
    first_frame,
    last_frame,
    reference_images = [],
    reference_videos = [],
    reference_audios = [],
  } = payload;

  const content: MiniMaxContentItem[] = [];
  content.push({ type: 'text', text: prompt || '生成一段精致带货短视频' });

  let hasVisualRef = false;

  if (first_frame) {
    content.push({ type: 'image_url', image_url: { url: first_frame }, role: 'first_frame' });
    hasVisualRef = true;
  }
  if (last_frame) {
    content.push({ type: 'image_url', image_url: { url: last_frame }, role: 'last_frame' });
    hasVisualRef = true;
  }
  reference_images.forEach((url) => {
    if (url && url !== first_frame && url !== last_frame) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
      hasVisualRef = true;
    }
  });
  reference_videos.forEach((url) => {
    if (url) {
      content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
      hasVisualRef = true;
    }
  });
  reference_audios.forEach((url) => {
    if (url) {
      content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
    }
  });

  return { content, hasVisualRef };
}

/**
 * 提交 MiniMax H3 视频生成任务（POST /v1/videos）。
 * 网关无幂等键：提交发生网络异常时绝不自动重发，避免重复建任务计费；
 * 仅在明确的路由错误（404/405）时切换下一个候选地址。
 */
export async function submitMiniMaxVideo(
  payload: MiniMaxVideoPayload,
): Promise<MiniMaxSubmitResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('未配置 OpenAI Next API Key (VITE_OPENAI_NEXT_API_KEY)');

  const candidateUrls = getCandidateBaseUrls();
  const { content, hasVisualRef } = buildContent(payload);

  const requestBody: Record<string, unknown> = {
    model: MINIMAX_VIDEO_MODEL,
    // 实测上游 MiniMax 渠道强制 resolution=768P（大写 P），传入其它规格返回 400
    resolution: '768P',
    duration: Number(payload.duration) || 6,
    content,
  };

  // 仅在纯文生视频（无图片参考）时传 ratio，且必须为具体比例
  if (!hasVisualRef) {
    const ratio = payload.ratio && payload.ratio !== 'adaptive' ? payload.ratio : '16:9';
    requestBody.ratio = ratio;
  }

  let lastError: Error | null = null;

  for (let i = 0; i < candidateUrls.length; i++) {
    const baseUrl = candidateUrls[i];
    const isLastCandidate = i === candidateUrls.length - 1;
    try {
      const response = await fetch(`${baseUrl}/v1/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      // 405 / 404 表示该代理端点不支持此路径，尝试下一个候选地址
      if ((response.status === 405 || response.status === 404) && !isLastCandidate) {
        console.warn(`[MiniMax/OpenAI-Next] Base URL ${baseUrl} returned ${response.status}, trying fallback...`);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`MiniMax H3 API HTTP ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      const taskId = resData?.id || resData?.task_id || resData?.data?.id;

      if (!taskId) {
        throw new Error(`MiniMax H3 提交响应无效: ${JSON.stringify(resData)}`);
      }

      return { task_id: taskId };
    } catch (err) {
      lastError = err as Error;
      // 提交请求一旦可能已到达上游，网络异常绝不换地址重发（防重复计费），直接抛出
      if (!(err instanceof TypeError) || isLastCandidate) throw err;
    }
  }

  throw lastError || new Error('MiniMax H3 视频提交失败（所有端点均不可用）。');
}

/**
 * 将完成后的成片二进制转存 Supabase Storage（materials 公共桶），返回公开 URL。
 * 路径按任务 ID 固定 + upsert，轮询期间重复调用是幂等的。
 */
async function persistVideoToStorage(taskId: string, blob: Blob, userId?: string | null): Promise<string> {
  const path = `generated-videos/${userId || 'anonymous'}/${taskId}.mp4`;
  const { error: upErr } = await supabase.storage
    .from('materials')
    .upload(path, blob, { contentType: 'video/mp4', upsert: true });
  if (upErr) throw new Error(`成片转存失败: ${upErr.message}`);
  const { data: urlData } = supabase.storage.from('materials').getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * 轮询 MiniMax H3 任务结果：GET /v1/videos/{task_id}/content
 *   - 200 且为视频二进制 → 转存 Storage → success + 公开 video_url
 *   - 400 "not completed" → 按 NOT_START/IN_PROGRESS 映射 queued/processing
 *   - 其它明确失败态 → failed
 * GET 请求幂等，网络异常可安全切换候选地址重试。
 */
export async function queryMiniMaxVideo(taskId: string, userId?: string | null): Promise<MiniMaxQueryResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('未配置 OpenAI Next API Key (VITE_OPENAI_NEXT_API_KEY)');

  const candidateUrls = getCandidateBaseUrls();
  let lastError: Error | null = null;

  for (let i = 0; i < candidateUrls.length; i++) {
    const baseUrl = candidateUrls[i];
    const isLastCandidate = i === candidateUrls.length - 1;
    try {
      const response = await fetch(`${baseUrl}/v1/videos/${taskId}/content`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if ((response.status === 405 || response.status === 404) && !isLastCandidate) {
        console.warn(`[MiniMax/OpenAI-Next] Query Base URL ${baseUrl} returned ${response.status}, trying fallback...`);
        continue;
      }

      if (response.status === 400) {
        // 未完成（NOT_START / IN_PROGRESS）或其它构建失败：解析 JSON 错误信息区分状态
        const errText = await response.text().catch(() => '');
        if (/NOT_START/i.test(errText)) return { status: 'queued', progress: 5 };
        if (/IN_PROGRESS/i.test(errText)) return { status: 'processing', progress: 10 };
        if (/expired|cancelled|failed/i.test(errText)) {
          return { status: 'failed', error: `MiniMax H3 视频生成任务失败: ${errText.slice(0, 160)}` };
        }
        return { status: 'processing', progress: 10 };
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`MiniMax H3 查询失败 HTTP ${response.status}: ${errText.slice(0, 160)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('video/')) {
        // 网关偶发返回 JSON 包装：尝试解析任务态
        const text = await response.text();
        try {
          const j = JSON.parse(text);
          const s = String(j?.status || '').toLowerCase();
          if (s === 'failed' || s === 'cancelled' || s === 'expired') {
            return { status: 'failed', error: j?.error?.message || 'MiniMax H3 视频生成任务失败' };
          }
        } catch { /* 非 JSON 内容按生成中处理 */ }
        return { status: 'processing', progress: 10 };
      }

      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const publicUrl = await persistVideoToStorage(taskId, blob, userId);
      return {
        status: 'success',
        video_url: publicUrl,
        outcome: { video_url: publicUrl },
      };
    } catch (err) {
      lastError = err as Error;
      if (isLastCandidate) throw err;
    }
  }

  throw lastError || new Error('MiniMax H3 视频查询失败（所有端点均不可用）。');
}
