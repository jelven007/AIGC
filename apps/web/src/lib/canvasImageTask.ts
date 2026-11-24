import { requireAccountSession } from '@/api/accountSession';
import { createProductionJob, productionRequest, ProductionJobError, type ProductionJob } from '@/api/productionJobs';
import { canonicalMediaTree } from './privateMedia';
import { readTaskReceipt, writeTaskReceipt } from './taskReceipt';
import type { CanvasTask } from '@/types/canvas';

export interface CanvasImageReceipt {
  nodeId: string;
  request_key: string;
  input?: Record<string, unknown>;
  jobId?: string;
}
export class CanvasImageTask {
  receipt: CanvasImageReceipt | null;
  private key: string;
  private busy = false;
  constructor(private userId: string, canvasId: string, private signal?: AbortSignal) {
    this.key = `aigc:canvas-image:${userId}:${canvasId}`;
    const saved = readTaskReceipt<CanvasImageReceipt>(this.key, value =>
      value && typeof value.nodeId === 'string' && typeof value.request_key === 'string');
    if (saved.error) throw new Error(saved.error);
    this.receipt = saved.value;
  }
  private write(receipt: CanvasImageReceipt | null) {
    writeTaskReceipt(this.key, canonicalMediaTree(receipt));
    this.receipt = receipt;
  }
  adopt(nodeId: string, task: CanvasTask) {
    if (!this.receipt) this.write({ nodeId, request_key: task.request_key, jobId: task.jobId });
  }
  async start(nodeId: string, input: Record<string, unknown>): Promise<ProductionJob> {
    await requireAccountSession(this.userId); this.signal?.throwIfAborted();
    if (this.busy || this.receipt) throw new Error('画布已有未结束或待确认的图片任务，请先恢复进度');
    this.busy = true;
    try {
      const receipt = { nodeId, request_key: crypto.randomUUID(), input: canonicalMediaTree(input) };
      this.write(receipt);
      const job = await createProductionJob('image', receipt.request_key, receipt.input, undefined, this.userId, this.signal);
      await requireAccountSession(this.userId); this.signal?.throwIfAborted();
      if (!job?.id || job.request_key !== receipt.request_key) throw new Error('图片任务回执不匹配，请恢复原请求');
      this.write({ ...receipt, jobId: job.id });
      return job;
    } catch (cause) {
      if (cause instanceof ProductionJobError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) this.write(null);
      throw cause;
    } finally { this.busy = false; }
  }
  async restore(): Promise<ProductionJob | null> {
    await requireAccountSession(this.userId); this.signal?.throwIfAborted();
    const receipt = this.receipt;
    if (!receipt) return null;
    let job: ProductionJob;
    try {
      job = (await productionRequest({ action: 'query', ...(receipt.jobId
        ? { job_id: receipt.jobId } : { request_key: receipt.request_key }) }, this.userId, this.signal)).job;
    } catch (cause) {
      if (!(cause instanceof ProductionJobError) || cause.status !== 404 || !receipt.input) throw cause;
      job = await createProductionJob('image', receipt.request_key, receipt.input, undefined, this.userId, this.signal);
    }
    await requireAccountSession(this.userId); this.signal?.throwIfAborted();
    if (!job || job.request_key !== receipt.request_key) throw new Error('图片任务回执不匹配');
    this.write({ ...receipt, jobId: job.id });
    return job;
  }
  finish() { this.write(null); }
}
