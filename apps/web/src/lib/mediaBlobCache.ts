import { mediaPreview } from '@/api/media';
import { canonicalMedia } from './privateMedia';

/** 页面/账号内有界缓存；合并重复请求，离开页面即取消并释放。 */
export class MediaBlobCache {
  private entries = new Map<string, { url: string; bytes: number }>();
  private pending = new Map<string, Promise<string>>();
  private controllers = new Set<AbortController>();
  private size = 0;
  private bufferedBytes = 0;
  private generation = 0;
  constructor(private maxBytes = 128 * 1024 * 1024, private maxFileBytes = 50 * 1024 * 1024) {}
  async get(source: string): Promise<string> {
    const key = canonicalMedia(source), entry = this.entries.get(key);
    if (entry) return entry.url;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const task = this.read(source, key);
    this.pending.set(key, task);
    try { return await task; } finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
  private async read(source: string, key: string) {
    const generation = this.generation;
    const signed = await mediaPreview(source);
    if (generation !== this.generation) return signed;
    const controller = new AbortController(); this.controllers.add(controller);
    let reserved = 0;
    try {
      const response = await fetch(signed, { signal: controller.signal });
      const declaredSize = Number(response.headers.get('content-length'));
      if (!response.ok || !response.body || declaredSize > this.maxFileBytes || this.size >= this.maxBytes) {
        await response.body?.cancel(); return signed;
      }
      const reader = response.body.getReader(), chunks: ArrayBuffer[] = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > this.maxFileBytes || this.size + this.bufferedBytes + chunk.value.length > this.maxBytes) {
          await reader.cancel(); return signed;
        }
        this.bufferedBytes += chunk.value.length; reserved += chunk.value.length;
        chunks.push(new Uint8Array(chunk.value).buffer);
      }
      if (generation !== this.generation || this.size + size > this.maxBytes) return signed;
      const url = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' }));
      this.entries.set(key, { url, bytes: size }); this.size += size; return url;
    } catch (cause) {
      if (controller.signal.aborted) return signed;
      return signed;
    } finally { this.controllers.delete(controller); this.bufferedBytes -= reserved; }
  }
  dispose() {
    this.generation++;
    this.controllers.forEach(controller => controller.abort()); this.controllers.clear();
    this.entries.forEach(entry => URL.revokeObjectURL(entry.url)); this.entries.clear(); this.pending.clear(); this.size = 0;
  }
}
