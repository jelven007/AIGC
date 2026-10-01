/**
 * Cdance2.0 Official Video Generation Model Integration
 * Base URL: https://ai.dxkp.com/v1 (Proxies: /dxkp-api/v1, /api/dxkp/v1)
 * Endpoint: POST /v1/video/generations & GET /v1/video/generations/{task_id}
 */

const DEFAULT_CDANCE_BASE_URL = 'https://ai.dxkp.com/v1';

function getApiKey(): string {
  const apiKey =
    import.meta.env.VITE_CDANCE_API_KEY ||
    import.meta.env.VITE_VECTRUST_API_KEY ||
    import.meta.env.VITE_SEEDANCE_API_KEY ||
    import.meta.env.VITE_DEEPSEEK_API_KEY || '';
  return apiKey;
}

function getCandidateBaseUrls(): string[] {
  const envUrl = import.meta.env.VITE_CDANCE_BASE_URL;
  const urls: string[] = [];
  if (envUrl) urls.push(envUrl);
  urls.push('/dxkp-api/v1');
  urls.push('/api/dxkp/v1');
  urls.push(DEFAULT_CDANCE_BASE_URL);
  return Array.from(new Set(urls));
}

export interface VectrustVideoPayload {
  prompt: string;
  duration?: number | string;
  resolution?: string;
  ratio?: string;
  first_frame?: string;
  last_frame?: string;
  reference_images?: string[];
  reference_videos?: string[];
  reference_audios?: string[];
  watermark?: boolean;
  generate_audio?: boolean;
}

/**
 * Submit video generation task to Cdance2.0 official API with multi-endpoint fallback
 */
export async function submitVectrustSeedanceVideo(payload: VectrustVideoPayload): Promise<{ request_id: string }> {
  const apiKey = getApiKey();
  const candidateUrls = getCandidateBaseUrls();
  const {
    prompt,
    duration = 5,
    resolution = '720p',
    ratio = '16:9',
    first_frame,
    last_frame,
    reference_images = [],
    reference_videos = [],
    reference_audios = [],
    watermark = false,
    generate_audio = true,
  } = payload;

  const contentItems: any[] = [];

  if (first_frame) {
    contentItems.push({
      type: 'image_url',
      image_url: { url: first_frame },
      role: 'first_frame',
    });
  }

  if (last_frame) {
    contentItems.push({
      type: 'image_url',
      image_url: { url: last_frame },
      role: 'last_frame',
    });
  }

  if (reference_images && reference_images.length > 0) {
    reference_images.forEach((url) => {
      if (url && url !== first_frame && url !== last_frame) {
        contentItems.push({
          type: 'image_url',
          image_url: { url },
          role: 'reference_image',
        });
      }
    });
  }

  if (reference_videos && reference_videos.length > 0) {
    reference_videos.forEach((url) => {
      if (url) {
        contentItems.push({
          type: 'video_url',
          video_url: { url },
          role: 'reference_video',
        });
      }
    });
  }

  if (reference_audios && reference_audios.length > 0) {
    reference_audios.forEach((url) => {
      if (url) {
        contentItems.push({
          type: 'audio_url',
          audio_url: { url },
          role: 'reference_audio',
        });
      }
    });
  }

  const requestBody: any = {
    model: 'Cdance2.0-A',
    prompt: prompt || '生成一段精致带货短视频',
    seconds: String(duration),
    metadata: {
      generate_audio: Boolean(generate_audio),
      resolution: resolution || '720p',
      ratio: ratio || '16:9',
      watermark: Boolean(watermark),
    },
  };

  if (contentItems.length > 0) {
    requestBody.metadata.content = contentItems;
  }

  let lastError: Error | null = null;

  for (const baseUrl of candidateUrls) {
    try {
      const response = await fetch(`${baseUrl}/video/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      // If HTTP 405 / 404, server doesn't proxy this endpoint, try next candidate URL
      if ((response.status === 405 || response.status === 404) && candidateUrls.indexOf(baseUrl) < candidateUrls.length - 1) {
        console.warn(`Base URL ${baseUrl} returned ${response.status}, trying fallback endpoint...`);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Cdance2.0 API HTTP ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      const requestId = resData.task_id || resData.id;

      if (!requestId) {
        throw new Error(`Invalid response from Cdance2.0 API: ${JSON.stringify(resData)}`);
      }

      return { request_id: requestId };
    } catch (err: any) {
      lastError = err;
      if (candidateUrls.indexOf(baseUrl) === candidateUrls.length - 1) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Cdance2.0 video submission failed across all endpoints.');
}

/**
 * Query task status from Cdance2.0 official API with multi-endpoint fallback
 */
export async function queryVectrustSeedanceVideo(requestId: string): Promise<any> {
  const apiKey = getApiKey();
  const candidateUrls = getCandidateBaseUrls();

  let lastError: Error | null = null;

  for (const baseUrl of candidateUrls) {
    try {
      const response = await fetch(`${baseUrl}/video/generations/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if ((response.status === 405 || response.status === 404) && candidateUrls.indexOf(baseUrl) < candidateUrls.length - 1) {
        console.warn(`Query Base URL ${baseUrl} returned ${response.status}, trying fallback endpoint...`);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Cdance2.0 query error HTTP ${response.status}: ${errText}`);
      }

      const resData = await response.json();

      if (resData.code && resData.code !== 'success') {
        return {
          status: 'failed',
          error: resData.message || '查询视频生成状态失败',
        };
      }

      const taskData = resData.data || resData;
      const status = (taskData.status || '').toUpperCase();

      if (status === 'SUCCESS') {
        const videoUrl = taskData.result_url || taskData.data?.content?.video_url;
        return {
          status: 'success',
          video_url: videoUrl,
          outcome: {
            video_url: videoUrl,
            thumbnail_image_url: `${videoUrl}?vframe/jpg/offset/1`,
          },
        };
      } else if (status === 'FAILED') {
        return {
          status: 'failed',
          error: taskData.fail_reason || '视频生成任务失败',
        };
      } else {
        const progressVal = parseInt(taskData.progress || '0') || 10;
        return {
          status: 'processing',
          progress: progressVal,
        };
      }
    } catch (err: any) {
      lastError = err;
      if (candidateUrls.indexOf(baseUrl) === candidateUrls.length - 1) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Cdance2.0 video query failed across all endpoints.');
}
