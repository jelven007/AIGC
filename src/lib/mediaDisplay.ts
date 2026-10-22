import { canonicalMedia } from './privateMedia';

/** 过滤旧公开演示地址与未签名私有引用；上传文件的同名文件不受影响。 */
export function displayMedia(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (/^\/(?:Video\/(?:covers\/)?CreatOK_\d+\.(?:mp4|jpg|webp)|Shopro\.mp4)$/i.test(url.pathname)
      || /(^|\.)unsplash\.com$/i.test(url.hostname)) return undefined;
    if (canonicalMedia(value) === value && url.pathname.includes('/storage/v1/object/authenticated/')) return undefined;
    return value;
  } catch { return undefined; }
}
