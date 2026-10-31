/**
 * Video First-Frame Snapshot Extractor
 * Captures first frame (t=0.1s) from video URL using HTML5 Canvas
 */
export async function extractVideoFirstFrame(videoUrl: string): Promise<string> {
  const meta = await extractVideoMeta(videoUrl);
  return meta ? meta.frame : '';
}

/**
 * 提取视频首帧与真实分辨率元数据（用于素材列表封面/分辨率精准对齐）
 */
export async function extractVideoMeta(videoUrl: string): Promise<{ frame: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!videoUrl) {
      resolve(null);
      return;
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const timer = setTimeout(() => {
      video.remove();
      resolve(null);
    }, 3500);

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const meta = { frame: dataUrl, width: video.videoWidth || canvas.width, height: video.videoHeight || canvas.height };
          video.remove();
          resolve(meta);
          return;
        }
      } catch (err) {
        console.warn('Canvas first frame extraction failed:', err);
      }
      video.remove();
      resolve(null);
    };

    video.onerror = () => {
      clearTimeout(timer);
      video.remove();
      resolve(null);
    };

    video.src = videoUrl;
  });
}

export async function getVideoCoverImage(videoUrl: string, firstFrame?: string): Promise<string> {
  // 1. 首选：直接从成片 Canvas 抽取真实第一帧（保证封面就是视频本身画面）
  const extracted = await extractVideoFirstFrame(videoUrl);
  if (extracted && extracted.startsWith('data:image')) {
    return extracted;
  }

  // 2. 用户在工作台上传的首帧图：它本身就是成片的起始画面，等价于真实首帧
  if (firstFrame && firstFrame.startsWith('data:image')) return firstFrame;

  // 提取失败时保留空封面，由调用方显示原始视频或读取失败状态，
  //    返回空串由调用方保留空封面，待列表页异步首帧提取重试
  return '';
}
