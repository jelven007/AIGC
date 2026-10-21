import { useCallback, useEffect, useRef, useState } from 'react';
import { Languages, Loader2, Download, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types/types';
import { PRODUCT_LANGUAGES, productRequest, ProductRequestError, type ProductTranslationInput,
  type ProductTranslationJob, type ProductTranslationResult } from '@/api/products';
import { queryProductionJob } from '@/api/productionJobs';
import { TASK_STATUSES } from '@/lib/taskCenter';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

type Receipt = { action: 'translate'; request_key: string; input: ProductTranslationInput };
export function ProductTranslationDialog({ open, onOpenChange, product, onApply, initialJobId }: {
  open: boolean; onOpenChange: (open: boolean) => void; product: Product | null;
  onApply: (result: ProductTranslationResult) => void; initialJobId?: string | null;
}) {
  const { user } = useAuth();
  const [language, setLanguage] = useState('en'), [includeImage, setIncludeImage] = useState(false);
  const [cost, setCost] = useState<number | null>(null), [jobs, setJobs] = useState<ProductTranslationJob[]>([]);
  const [selected, setSelected] = useState(''), [pending, setPending] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), owner = useRef(user?.id); owner.current = user?.id;
  const storageKey = `shopro:product-translation:${user?.id || ''}`;
  const load = useCallback(async () => {
    const uid = owner.current;
    const data = await productRequest({ action: 'translations' });
    if (initialJobId && !data.jobs.some((job: ProductTranslationJob) => job.id === initialJobId)) {
      const job = await queryProductionJob(initialJobId);
      if (job.kind !== 'product_translate') throw new Error('该任务不是商品翻译');
      data.jobs = [job, ...data.jobs];
    }
    if (uid !== owner.current) return;
    setJobs(data.jobs); setCost(data.cost);
  }, [initialJobId]);
  useEffect(() => {
    setJobs([]); setCost(null); setPending(null); setSelected(''); setError(''); setIncludeImage(false);
  }, [user?.id]);
  useEffect(() => { setSelected(''); setIncludeImage(false); }, [product?.id]);
  useEffect(() => { if (open && initialJobId) setSelected(initialJobId); }, [open, initialJobId]);
  useEffect(() => {
    if (!open || !user) return;
    try {
      const receipt = JSON.parse(localStorage.getItem(storageKey) || 'null');
      setPending(receipt?.action === 'translate' && typeof receipt.request_key === 'string' && receipt.input ? receipt : null);
    } catch { setError('原翻译记录读取失败，请到任务中心核对'); }
    void load().catch(cause => setError(cause.message));
  }, [open, user?.id, storageKey, load]);
  useEffect(() => {
    if (!open || !jobs.some(job => ['pending', 'running'].includes(job.status))) return;
    const timer = setInterval(() => { void load().catch(cause => setError(cause.message)); }, 5000);
    return () => clearInterval(timer);
  }, [open, jobs, load]);
  const submit = async () => {
    if (!user || lock.current || !pending && (!product || cost === null)) return;
    const uid = user.id;
    const receipt: Receipt = pending || { action: 'translate', request_key: crypto.randomUUID(), input: {
      product_id: product!.id, expected_updated_at: product!.updated_at, target_language: language,
      include_image: includeImage, confirmed_credit_cost: cost!,
    } };
    lock.current = true; setBusy(true); setError('');
    try {
      localStorage.setItem(storageKey, JSON.stringify(receipt)); setPending(receipt);
      const data = await productRequest(receipt);
      localStorage.removeItem(storageKey);
      if (uid !== owner.current) return;
      setPending(null); setSelected(data.job.id); await load();
      toast.success('翻译任务已提交，关闭后可从翻译记录或任务中心查看');
    } catch (cause) {
      if (uid !== owner.current) return;
      setError(cause instanceof Error ? cause.message : '翻译回执待确认');
      if (cause instanceof ProductRequestError && cause.outcome === 'rejected') {
        localStorage.removeItem(storageKey); setPending(null);
      }
    } finally { lock.current = false; setBusy(false); }
  };
  const visible = product ? jobs.filter(job => job.product_id === product.id || job.result?.product_id === product.id) : jobs;
  const current = jobs.find(job => job.id === selected) || visible[0];
  const result = current?.status === 'completed' && current.result && !current.result.expired ? current.result : null;
  const exportResult = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `商品译文-${result.target_language}-${current!.id}.json`;
    link.click(); URL.revokeObjectURL(url);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden p-0">
      <DialogHeader className="p-5 pb-3 shrink-0">
        <DialogTitle className="flex items-center gap-2"><Languages className="w-5 h-5 text-primary" />商品翻译</DialogTitle>
        <DialogDescription>翻译标题、描述、卖点与规格，可识别主图文字。结果保留30天，核对后可带入商品编辑。</DialogDescription>
      </DialogHeader>
      <div className="px-5 pb-4 overflow-y-auto space-y-4">
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        {pending && <div className="border rounded-lg p-3 space-y-2 text-sm">
          <p>翻译回执待确认。恢复使用原商品版本、目标语言、积分和请求标识。</p>
          <Button disabled={busy} onClick={() => void submit()}>恢复原翻译请求</Button>
        </div>}
        {product && <fieldset disabled={busy || !!pending || !user} className="space-y-3">
          <p className="text-sm break-words">原商品：{product.name}</p>
          <label className="block text-sm space-y-2">目标语言<select aria-label="翻译目标语言" value={language}
            onChange={event => setLanguage(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3">
            {Object.entries(PRODUCT_LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={includeImage}
            disabled={!product.cover_image} onChange={event => setIncludeImage(event.target.checked)} />识别并翻译主图文字{!product.cover_image && '（请先保存商品主图）'}</label>
          <p className="text-xs text-muted-foreground">主图识别只输出文字对照；译文不会自动保存到商品。</p>
          <Button disabled={cost === null} onClick={() => void submit()}>{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            确认翻译 · {cost ?? '—'}积分</Button>
          <p className="text-xs text-muted-foreground">确定失败按原流水返还积分；受理结果未知时保留原任务供核对。</p>
        </fieldset>}
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">最近20条翻译记录{product && ' · 当前商品'}</p>
          <Button size="sm" variant="outline" disabled={busy || !user} onClick={() => void load().catch(cause => setError(cause.message))}>刷新翻译记录</Button>
        </div>
        {!visible.length ? <p className="text-sm text-muted-foreground">还没有翻译记录。</p> : <select aria-label="选择商品翻译任务"
          value={current?.id || ''} onChange={event => setSelected(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3">
          {visible.map(job => <option key={job.id} value={job.id}>{new Date(job.created_at).toLocaleString('zh-CN')} · {TASK_STATUSES[job.status]}</option>)}
        </select>}
        {current && <p role="status" className="text-sm">{TASK_STATUSES[current.status]} · {current.credit_cost}积分</p>}
        {current?.error_message && <p className="text-sm text-destructive break-words">{current.error_message}</p>}
        {current?.result?.expired && <p className="text-sm text-muted-foreground">该翻译结果已过期，请重新提交商品资料。</p>}
        {result && <section aria-label="商品译文" className="space-y-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">{PRODUCT_LANGUAGES[result.target_language]} · {new Date(result.created_at).toLocaleString('zh-CN')}</p>
          <h3 className="font-semibold break-words" dir="auto">{result.translation.name}</h3>
          <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{result.translation.description}</p>
          <ul className="list-disc pl-5 text-sm space-y-1" dir="auto">{result.translation.selling_points.map((point, index) => <li key={index}>{point}</li>)}</ul>
          <dl className="text-sm space-y-2">{result.translation.specs.map((spec, index) => <div key={index} className="flex flex-wrap gap-2" dir="auto">
            <dt className="text-muted-foreground">{spec.name}</dt><dd className="break-words">{spec.value}</dd></div>)}</dl>
          {!!result.image_text.length && <div className="space-y-2"><h4 className="text-sm font-medium">主图文字对照</h4>
            {result.image_text.map((item, index) => <div key={index} className="border rounded-md p-3 text-sm space-y-1">
              <p className="text-muted-foreground break-words" dir="auto">{item.original}</p><p className="break-words" dir="auto">{item.translated}</p>
            </div>)}<p className="text-xs text-muted-foreground">{result.image_note}</p></div>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportResult}><Download className="w-4 h-4 mr-2" />导出译文JSON</Button>
            <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(result, null, 2))
              .then(() => toast.success('译文已复制')).catch(() => setError('复制失败，请使用JSON导出')); }}><Copy className="w-4 h-4 mr-2" />复制译文</Button>
            <Button disabled={!!pending || busy} onClick={() => onApply(result)}>带入商品编辑</Button>
          </div>
          <details className="text-xs text-muted-foreground break-all"><summary className="cursor-pointer">原资料与模型依据</summary>
            <p className="mt-2">原商品版本：{result.source_updated_at}</p><p>原资料SHA-256：{result.source_hash}</p>
            <p>主图SHA-256：{result.image_hash || '未识别主图'}</p><p>模型版本：{result.version_id}</p>
          </details>
        </section>}
      </div>
      <DialogFooter className="border-t p-5 pt-3 shrink-0"><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
