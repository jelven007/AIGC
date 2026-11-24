import type { CanvasDocument, CanvasProject } from '@/types/canvas';
import { validateCanvasDocument } from './canvasDocument';
import { canonicalMediaTree } from './privateMedia';
import { writeTaskReceipt } from './taskReceipt';

export interface CanvasDraft { title: string; document: CanvasDocument; baseRevision: number }
export const canvasDraftKey = (userId: string, canvasId: string) => `aigc:canvas-draft:${userId}:${canvasId}`;
export function readCanvasDraft(userId: string, canvasId: string): CanvasDraft | null {
  try {
    const raw = localStorage.getItem(canvasDraftKey(userId, canvasId));
    if (raw === null) return null;
    const value = JSON.parse(raw) as CanvasDraft;
    if (typeof value.title !== 'string' || !Number.isInteger(value.baseRevision) || value.baseRevision < 1) throw new Error();
    return { ...value, document: validateCanvasDocument(value.document) };
  } catch { throw new Error('画布恢复副本读取失败，原内容已保留；请恢复浏览器存储或导出工程'); }
}
export function writeCanvasDraft(userId: string, canvasId: string, draft: CanvasDraft | null) {
  writeTaskReceipt(canvasDraftKey(userId, canvasId), canonicalMediaTree(draft));
}
export class CanvasSaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  current: CanvasProject;
  constructor(project: CanvasProject, private write: (revision: number, title: string, document: CanvasDocument) => Promise<CanvasProject>) {
    this.current = project;
  }
  save(title: string, document: CanvasDocument): Promise<CanvasProject> {
    const result = this.tail.then(async () => {
      const saved = await this.write(this.current.revision, title, document);
      this.current = saved;
      return saved;
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
