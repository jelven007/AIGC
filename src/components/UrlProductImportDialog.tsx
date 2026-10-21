import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Link } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types/types';
import { productDraft, productRequest, ProductRequestError, readProductMutation, storeProductMutation, pendingProductKey,
  type ProductImportJob, type ProductMutation } from '@/api/products';
import { ProductFields, type ProductEditor } from './ProductFields';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { cn } from '@/lib/utils';

export interface UrlProductImportDialogProps {
  open: boolean; onOpenChange: (open: boolean) => void; onSuccess?: (product: Product) => void; zIndexClass?: string;
}
type Extraction = { action: 'extract'; request_key: string; input: { mode: string; content: string } };
export function UrlProductImportDialog({ open, onOpenChange, onSuccess, zIndexClass = 'z-[70]' }: UrlProductImportDialogProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState('url'), [content, setContent] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<ProductImportJob[]>([]), [current, setCurrent] = useState<ProductImportJob | null>(null);
  const [draft, setDraft] = useState<ProductEditor | null>(null);
  const [pending, setPending] = useState<Extraction | null>(null);
  const [mutation, setMutation] = useState<ProductMutation | null>(null);
  const owner = useRef(user?.id); owner.current = user?.id;
  const extractionKey = `shopro-product-extraction-${user?.id || ''}`;
  const unresolved = !!pending || !!mutation;
  const load = async (active = current) => {
    const requestedOwner = owner.current;
    const result = await productRequest({ action: 'imports' });
    if (owner.current !== requestedOwner) return;
    setJobs(result.jobs);
    if (active) {
      const fresh = result.jobs.find((job: ProductImportJob) => job.id === active.id);
      if (fresh) {
        setCurrent(fresh);
        if (fresh.status === 'completed' && fresh.result?.draft && !draft) setDraft(fresh.result.draft);
      }
    }
  };
  useEffect(() => {
    setJobs([]); setCurrent(null); setDraft(null); setPending(null); setMutation(null); setError('');
  }, [user?.id]);
  useEffect(() => {
    if (!open || !user) return;
    let stopped = false;
    try {
      const raw = localStorage.getItem(extractionKey);
      setPending(raw ? JSON.parse(raw) : null);
      const prior = readProductMutation(user.id);
      setMutation(prior);
      if (prior?.action === 'save' && prior.items[0]?.import_job_id) setDraft(prior.items[0].draft!);
    } catch { setError('本地恢复记录不可读取'); }
    void load().catch(cause => { if (!stopped) setError(cause.message); });
    return () => { stopped = true; };
  }, [open, user?.id]);
  useEffect(() => {
    if (!open || !jobs.some(job => ['pending', 'running'].includes(job.status))) return;
    const timer = setInterval(() => { void load().catch(cause => setError(cause.message)); }, 5000);
    return () => clearInterval(timer);
  }, [open, jobs, current, draft]);
  const selectJob = (job: ProductImportJob) => {
    if (unresolved) return;
    setCurrent(job); setError(''); setDraft(job.result?.draft || null);
  };
  const extract = async () => {
    if (!user || busy) return;
    const request: Extraction = pending || { action: 'extract', request_key: crypto.randomUUID(), input: { mode, content: content.trim() } };
    setBusy(true); setError('');
    try {
      localStorage.setItem(extractionKey, JSON.stringify(request)); setPending(request);
      const result = await productRequest(request);
      localStorage.removeItem(extractionKey); setPending(null); setCurrent(result.job); setDraft(result.job.result?.draft || null);
      await load(result.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提取回执未能确认');
      if (cause instanceof ProductRequestError && cause.outcome === 'rejected') {
        localStorage.removeItem(extractionKey); setPending(null);
      }
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!user || busy || !draft || !current && !mutation) return;
    setBusy(true); setError('');
    try {
      const request: ProductMutation = mutation || { action: 'save', request_key: crypto.randomUUID(),
        items: [{ draft: productDraft(draft), import_job_id: current!.id }] };
      storeProductMutation(user.id, request); setMutation(request);
      const result = await productRequest(request);
      localStorage.removeItem(pendingProductKey(user.id)); setMutation(null);
      const product = result.products?.find((item: Product) => item.id === result.ids[0]);
      if (!product) { setError('原操作已保存；商品随后被删除，请返回商品库核对'); return; }
      toast.success(`商品「${product.name}」已导入`);
      onSuccess?.(product); onOpenChange(false); setDraft(null); setCurrent(null); setContent('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '商品保存回执未能确认');
      if (cause instanceof ProductRequestError && cause.outcome === 'rejected') {
        localStorage.removeItem(pendingProductKey(user.id)); setMutation(null);
      }
    } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy && !uploading) onOpenChange(value); }}>
    <DialogContent className={cn('max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden p-0', zIndexClass)}>
      <DialogHeader className="p-5 pb-3 shrink-0">
        <DialogTitle className="flex gap-2 items-center"><Link className="w-5 h-5 text-primary" />链接与商品资料导入</DialogTitle>
        <DialogDescription>提取任务在后台继续运行，无需保持页面打开。提取免费，确认资料后保存为商品。</DialogDescription>
      </DialogHeader>
      <div className="px-5 overflow-y-auto space-y-4 pb-4">
        {error && <p role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm whitespace-pre-wrap">{error}</p>}
        {!user && <p role="alert">请先登录后导入商品。</p>}
        {mutation && <p className="text-sm text-muted-foreground">有一笔商品操作回执待确认。请恢复原请求后继续编辑。</p>}
        <fieldset disabled={busy || unresolved || !user} className="space-y-2">
          <Label htmlFor="product-import-mode">资料类型</Label>
          <select id="product-import-mode" value={mode} className="h-10 w-full px-3 rounded-md border bg-background" onChange={event => setMode(event.target.value)}>
            <option value="url">商品详情链接</option><option value="text">商品资料 / 分享文本</option>
          </select>
          <Label htmlFor="product-import-content">{mode === 'url' ? '商品详情 HTTPS 链接' : '商品资料文本'}</Label>
          <Textarea id="product-import-content" rows={3} maxLength={8000} value={content} onChange={event => setContent(event.target.value)}
            placeholder={mode === 'url' ? '粘贴可公开访问的单个商品详情页' : '商品名称：商家确认的标题\n粘贴商品描述、规格和卖点原文'} />
          <p className="text-xs text-muted-foreground">网页需提供 JSON-LD 商品数据。登录或口令限制页，请改用资料文本。</p>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !user || !!mutation || !pending && !content.trim()} onClick={extract}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{pending ? '恢复原提取请求' : '提取商品资料'}
          </Button>
          <Button variant="outline" disabled={busy || !user} onClick={() => { void load().catch(cause => setError(cause.message)); }}>刷新提取记录</Button>
        </div>
        {current && <p role="status" className="text-sm">{current.status === 'completed' ? '提取完成，请核对资料'
          : current.status === 'failed' ? `提取失败：${current.error_message}` : current.status === 'unknown' ? '原提取任务待核对' : '后台正在提取商品资料…'}</p>}
        {jobs.length > 0 && <div className="space-y-2">
          <p className="text-xs text-muted-foreground">最近20条提取任务 · 未导入结果保留30天</p>
          <select aria-label="选择商品提取任务" className="h-10 w-full border rounded-md bg-background px-3" value={current?.id || ''}
            disabled={busy || unresolved} onChange={event => { const job = jobs.find(item => item.id === event.target.value); if (job) selectJob(job); }}>
            <option value="">选择历史提取任务</option>
            {jobs.map(job => <option key={job.id} value={job.id}>{job.result?.draft?.name || new Date(job.created_at).toLocaleString('zh-CN')} · {
              ({ completed: '提取完成', failed: '失败', pending: '等待中', running: '处理中', unknown: '待核对', cancelled: '已取消' })[job.status]}</option>)}
          </select>
        </div>}
        {current?.result?.expired && <p role="alert" className="text-sm text-muted-foreground">该提取结果已过期，请重新提供商品资料。</p>}
        {draft && user && <>
          {current?.result?.warnings.map((warning, index) => <p key={index} className="text-xs text-muted-foreground">{warning}</p>)}
          {current?.result?.source.url && <a href={current.result.source.url} target="_blank" rel="noreferrer" className="text-sm text-primary break-all">查看商品来源</a>}
          <ProductFields value={draft} onChange={setDraft} uid={user.id} disabled={busy || unresolved} onUploadChange={setUploading} />
        </>}
      </div>
      <DialogFooter className="p-5 pt-3 border-t shrink-0">
        <Button variant="outline" disabled={busy || uploading} onClick={() => onOpenChange(false)}>关闭</Button>
        <Button disabled={busy || uploading || !user || !draft || !!pending || !!mutation && mutation.action !== 'save'} onClick={save}>
          <CheckCircle2 className="w-4 h-4 mr-2" />{mutation ? '恢复原商品保存请求' : '确认并导入商品'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
