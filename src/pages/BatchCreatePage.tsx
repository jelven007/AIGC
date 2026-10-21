import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Package, Loader2, RefreshCw, Pause, Play, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { modelSettingsRequest, type ModelCatalogEntry } from '@/api/modelSettings';
import { BatchJobError, controlBatchVideoJob, createBatchVideoJob, listBatchVideoJobs, quoteBatchVideoJobs,
  type BatchInput, type BatchVideoJob } from '@/api/batchVideoJobs';

interface Product { id: string; name: string; category: string; price: number | null }
interface PendingBatch { key: string; input: BatchInput }
const states: Record<string, string> = { pending: '等待中', processing: '处理中', paused: '已暂停',
  cancelling: '等待已提交任务结束', completed: '全部完成', partial: '部分完成', failed: '已失败', cancelled: '已取消' };
const active = (job: BatchVideoJob) => ['pending', 'processing', 'paused', 'cancelling'].includes(job.status);
const message = (cause: unknown) => cause instanceof Error ? cause.message : '操作失败，请重试';

function ProductPicker({ open, onClose, onSelect, excluded }: {
  open: boolean; onClose: () => void; onSelect: (value: Product[]) => void; excluded: string[];
}) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    const result = await supabase.from('products').select('id,name,category,price')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
    if (result.error) setError('商品库加载失败，请重试');
    else setProducts(result.data || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { if (open) { setSelected([]); void load(); } }, [open, load]);
  const filtered = products.filter(p => !excluded.includes(p.id) && `${p.name} ${p.category}`.includes(search));
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[85dvh] flex flex-col">
      <DialogHeader><DialogTitle>选择商品</DialogTitle>
        <DialogDescription>最近 200 个商品，每批最多 50 个。商品资料将保存为任务快照。</DialogDescription></DialogHeader>
      <Input aria-label="搜索商品" placeholder="搜索名称或分类" value={search} onChange={e => setSearch(e.target.value)} />
      {error ? <div role="alert">{error}<Button variant="outline" onClick={() => void load()}>重试</Button></div>
        : loading ? <p role="status">加载商品库…</p> : <div className="overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map(p => <label key={p.id} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer min-w-0">
            <input type="checkbox" checked={selected.includes(p.id)} aria-label={`选择${p.name}`}
              disabled={!selected.includes(p.id) && selected.length + excluded.length >= 50}
              onChange={e => setSelected(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
            <span className="min-w-0 break-words text-sm">{p.name}<span className="block text-muted-foreground">{p.category}</span></span>
          </label>)}
          {!filtered.length && <p className="text-sm text-muted-foreground">暂无符合条件的商品，请先在商品库添加。</p>}
        </div>}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
        <span className="text-sm">已选择 {selected.length} 个</span><Button disabled={!selected.length || loading || !!error}
          onClick={() => { onSelect(products.filter(p => selected.includes(p.id))); onClose(); }}>确认添加</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export default function BatchCreatePage() {
  const { user } = useAuth();
  const credits = useCredits();
  const [view, setView] = useState<'create' | 'history'>('create');
  const [products, setProducts] = useState<Product[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState('商品视频批次');
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [quote, setQuote] = useState<number | null>(null);
  const [configError, setConfigError] = useState('');
  const [settings, setSettings] = useState<BatchInput['settings']>({
    duration: 5, ratio: '9:16', resolution: '720P', style: '专业商品展示', language: 'zh',
  });
  const [overrides, setOverrides] = useState<BatchInput['overrides']>({});
  const [jobs, setJobs] = useState<BatchVideoJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [pending, setPending] = useState<PendingBatch | null>(null);
  const submitting = useRef(false);
  const storageKey = user ? `shoproai:batch-request:${user.id}` : '';
  useEffect(() => {
    if (!storageKey) { setPending(null); return; }
    try {
      const stored = sessionStorage.getItem(storageKey);
      setPending(stored ? JSON.parse(stored) : null);
    } catch { setPending(null); }
  }, [storageKey]);
  const loadConfig = useCallback(async () => {
    setConfigError('');
    try {
      const catalog = await modelSettingsRequest<{ configs: ModelCatalogEntry[] }>({ action: 'catalog' });
      const prices = await quoteBatchVideoJobs();
      const enabled = catalog.configs.filter(item => item.category === 'video' && item.enabled);
      setModels(enabled); setQuote(prices.unit_cost);
      setProvider(prev => enabled.some(item => item.provider === prev) ? prev : enabled[0]?.provider || '');
    } catch (cause) { setConfigError(message(cause)); setQuote(null); }
  }, []);
  const loadJobs = useCallback(async (quiet = false) => {
    if (!user) return;
    if (!quiet) setLoading(true);
    try { setJobs(await listBatchVideoJobs()); setError(''); }
    catch (cause) { setError(message(cause)); }
    finally { if (!quiet) setLoading(false); }
  }, [user]);
  useEffect(() => { if (user) { void loadConfig(); void loadJobs(); } }, [user, loadConfig, loadJobs]);
  const hasActive = jobs.some(active);
  useEffect(() => {
    if (!hasActive || view !== 'history') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (document.visibilityState === 'visible') await loadJobs(true);
      if (!stopped) timer = setTimeout(refresh, 5000);
    };
    timer = setTimeout(refresh, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [hasActive, view, loadJobs]);
  const total = quote == null ? null : products.length * quote;
  const savePending = (value: PendingBatch | null) => {
    setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); }
    catch { /* 内存仍保留原请求；服务端历史可恢复。 */ }
  };
  const submit = async () => {
    if (!user || submitting.current) return;
    const attempt = pending || (quote && products.length && provider && name.trim() ? {
      key: crypto.randomUUID(), input: { name: name.trim(), provider, product_ids: products.map(p => p.id),
        settings, overrides, expected_unit_cost: quote, budget: products.length * quote },
    } : null);
    if (!attempt) { toast.error('请选择商品、模型并确认批次名称和预算'); return; }
    submitting.current = true; setBusy('create'); savePending(attempt);
    try {
      const batch = await createBatchVideoJob(attempt.key, attempt.input);
      savePending(null); setProducts([]); setOverrides({}); setView('history'); setExpanded(batch.id);
      setJobs(prev => [batch, ...prev.filter(job => job.id !== batch.id)]);
      toast.success(`批次已创建，预占 ${batch.reserved_credits} 积分`);
    } catch (cause) {
      toast.error(message(cause));
      // 明确的事务拒绝没有扣费，可以编辑表单；网络/服务故障保留原请求防止重复预占。
      if (cause instanceof BatchJobError && [400, 401, 402, 403, 409, 429].includes(cause.status)) {
        savePending(null);
        if (cause.status === 409) void loadConfig();
      }
    } finally { submitting.current = false; setBusy(''); }
  };
  const control = async (job: BatchVideoJob, action: 'pause' | 'resume' | 'cancel') => {
    if (busy) return;
    setBusy(job.id);
    try {
      const updated = await controlBatchVideoJob(job.id, action);
      setJobs(prev => prev.map(item => item.id === updated.id ? updated : item));
      toast.success(action === 'pause' ? '后续提交已暂停，已受理任务继续处理'
        : action === 'resume' ? '已恢复后续提交' : `取消已生效，已返还 ${updated.refunded_credits} 积分`);
    } catch (cause) { toast.error(message(cause)); void loadJobs(true); }
    finally { setBusy(''); }
  };
  return <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h1 className="text-xl font-bold flex gap-2 items-center"><Layers className="w-5 h-5" />批量生成工作台</h1>
        <p className="text-sm text-muted-foreground mt-1">一商品一条视频，关闭页面后后台继续处理。</p></div>
      <div className="flex gap-2">
        <Button variant={view === 'create' ? 'default' : 'outline'} onClick={() => setView('create')}>新建任务</Button>
        <Button variant={view === 'history' ? 'default' : 'outline'} onClick={() => { setView('history'); void loadJobs(); }}>历史任务</Button>
      </div>
    </div>
    {view === 'create' ? <>
      {pending && <div role="alert" className="border rounded-lg p-4 space-y-2">
        <p>上次提交结果尚未确认。请恢复原请求，避免重复预占积分。</p>
        <p className="text-sm break-words">{pending.input.name} · {pending.input.product_ids.length} 个商品 · 预算 {pending.input.budget} 积分</p>
        <Button onClick={() => void submit()} disabled={!!busy}>{busy ? '恢复中…' : '恢复上次提交'}</Button>
      </div>}
      <Card><CardHeader><CardTitle className="text-base">商品与生成要求</CardTitle>
        <CardDescription>读取商品已登记卖点；目标语言和风格作为生成提示，文字、配音和字幕效果请检查成片。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center gap-3"><p>已选择 {products.length} / 50 个商品</p>
            <Button variant="outline" disabled={!!pending || !!busy} onClick={() => setPickerOpen(true)}><Plus className="w-4 h-4 mr-1" />添加商品</Button></div>
          {!products.length && <p className="py-6 text-center text-muted-foreground"><Package className="w-8 h-8 mx-auto mb-2" />从商品库选择要生成的商品</p>}
          <div className="grid md:grid-cols-2 gap-3">
            {products.map(product => <div key={product.id} className="border rounded-lg p-3 min-w-0">
              <div className="flex gap-2 justify-between"><p className="break-words text-sm font-medium">{product.name}</p>
                <Button aria-label={`移除${product.name}`} size="icon" variant="ghost" disabled={!!pending || !!busy}
                  onClick={() => { setProducts(prev => prev.filter(p => p.id !== product.id));
                    setOverrides(prev => { const next = { ...prev }; delete next[product.id]; return next; }); }}><Trash2 className="w-4 h-4" /></Button></div>
              <label className="text-sm block" htmlFor={`prompt-${product.id}`}>单品补充要求（可选）</label>
              <Textarea id={`prompt-${product.id}`} maxLength={7000} disabled={!!pending || !!busy}
                value={overrides[product.id]?.prompt || ''} placeholder="展示角度、场景或文案要求"
                onChange={e => setOverrides(prev => {
                  const next = { ...prev }; if (e.target.value.trim()) next[product.id] = { prompt: e.target.value }; else delete next[product.id];
                  return next;
                })} />
            </div>)}
          </div>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">模型与积分预算</CardTitle>
        <CardDescription>整批创建成功后预占；确定失败或取消尚未提交的任务时按原流水返还。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {configError && <div role="alert">{configError}<Button variant="outline" onClick={() => void loadConfig()}>重试配置</Button></div>}
          {!configError && !models.length && <p role="status">没有已启用的视频模型，请联系管理员在模型设置中配置。</p>}
          <fieldset disabled={!!pending || !!busy} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><label htmlFor="batch-name" className="text-sm">批次名称</label><Input id="batch-name" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label htmlFor="batch-provider" className="text-sm">视频模型</label><select id="batch-provider" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={provider} onChange={e => setProvider(e.target.value)}>{!models.length && <option value="">尚未配置</option>}
              {models.map(item => <option key={item.slot} value={item.provider}>{item.name}</option>)}</select></div>
            <div><label htmlFor="batch-duration" className="text-sm">视频时长（秒）</label><Input id="batch-duration" type="number" min={2} max={15}
              value={settings.duration} onChange={e => setSettings(prev => ({ ...prev, duration: Number(e.target.value) }))} /></div>
            <div><label htmlFor="batch-ratio" className="text-sm">画幅</label><select id="batch-ratio" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={settings.ratio} onChange={e => setSettings(prev => ({ ...prev, ratio: e.target.value }))}>
              {['9:16', '16:9', '1:1', '4:3', '3:4'].map(value => <option key={value}>{value}</option>)}</select></div>
            <div><label htmlFor="batch-resolution" className="text-sm">分辨率</label><select id="batch-resolution" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={settings.resolution} onChange={e => setSettings(prev => ({ ...prev, resolution: e.target.value }))}>
              {['480P', '720P', '1080P'].map(value => <option key={value}>{value}</option>)}</select></div>
            <div><label htmlFor="batch-language" className="text-sm">目标语言</label><select id="batch-language" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={settings.language} onChange={e => setSettings(prev => ({ ...prev, language: e.target.value }))}>
              {Object.entries({ zh: '中文', en: '英语', ja: '日语', ko: '韩语', th: '泰语', vi: '越南语' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="sm:col-span-2"><label htmlFor="batch-style" className="text-sm">统一风格要求</label><Input id="batch-style" maxLength={200} value={settings.style}
              onChange={e => setSettings(prev => ({ ...prev, style: e.target.value }))} /></div>
          </fieldset>
          <p className="text-sm text-muted-foreground">模型可能调整时长与分辨率；不支持的规格或商品图片将整批拒绝，不扣积分。</p>
          <div className="flex flex-wrap justify-between items-center gap-3 pt-4 border-t">
            <div className="text-sm"><p>单条 {quote ?? '—'} 积分 · 本批预占 <strong>{total ?? '—'}</strong> 积分</p>
              <p className="text-muted-foreground">当前余额 {credits.loading ? '读取中…' : credits.creditsLeft} 积分</p></div>
            <Button onClick={() => void submit()} disabled={!!pending || !!busy || !products.length || !provider || quote == null || !name.trim()
              || !settings.style.trim() || !Number.isInteger(settings.duration) || settings.duration < 2 || settings.duration > 15}>
              {busy === 'create' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}确认预算并创建批次</Button>
          </div>
        </CardContent></Card>
    </> : <div className="space-y-4">
      <div className="flex justify-end"><Button variant="outline" disabled={loading} onClick={() => void loadJobs()}><RefreshCw className="w-4 h-4 mr-1" />刷新状态</Button></div>
      {error && <p role="alert" className="text-destructive">{error}；已加载的数据暂时保留。</p>}
      {loading && !jobs.length && <p role="status">读取批次状态…</p>}
      {!loading && !error && !jobs.length && <p className="text-center py-10 text-muted-foreground">暂无批量任务，请先创建一个批次。</p>}
      {jobs.map(job => <Card key={job.id}><CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div className="min-w-0"><h2 className="font-medium break-words">{job.name}</h2><Badge variant="secondary">{states[job.status] || '待核对'}</Badge>
            <p className="text-sm text-muted-foreground mt-1">{job.provider || '旧批次'} · {new Date(job.created_at).toLocaleString('zh-CN')}</p></div>
          <div className="flex flex-wrap gap-2">
            {!job.legacy && active(job) && job.status !== 'cancelling' && <>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void control(job, job.status === 'paused' ? 'resume' : 'pause')}>
                {job.status === 'paused' ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}{job.status === 'paused' ? '恢复' : '暂停后续提交'}</Button>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void control(job, 'cancel')}><X className="w-4 h-4 mr-1" />取消未提交项</Button>
            </>}
            <Button variant="ghost" size="sm" aria-expanded={expanded === job.id} onClick={() => setExpanded(prev => prev === job.id ? null : job.id)}>
              {expanded === job.id ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}子任务</Button>
          </div>
        </div>
        <p className="text-sm">总计 {job.total_count} · 成功 {job.completed_count} · 失败 {job.failed_count} · 取消 {job.cancelled_count}</p>
        <Progress value={job.progress} aria-label={`${job.name}进度`} />
        <p className="text-sm text-muted-foreground">预占 {job.reserved_credits} · 已结算 {job.settled_credits} · 已返还 {job.refunded_credits} 积分</p>
        {job.attention_count > 0 && <p role="status" className="text-sm">有 {job.attention_count} 个任务等待核对上游受理结果，保留原任务与预占积分。</p>}
        {job.status === 'paused' && <p className="text-sm text-muted-foreground">后续提交已暂停；已受理任务继续查询和归档。</p>}
        {expanded === job.id && <div className="border-t pt-3 space-y-3">{job.items.map(item => <div key={item.id} className="rounded-lg bg-muted/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm break-words min-w-0">{item.product_name || '已删除商品'}</p>
            <span className="text-sm">{item.needs_attention ? '待核对' : states[item.status] || item.status}</span></div>
          {item.error_message && <p className="text-sm text-destructive break-words">{item.error_message}</p>}
          <div className="flex gap-3 text-sm">{item.project_id && <Link className="underline" to={`/video/edit?importId=${encodeURIComponent(item.project_id)}`}>打开工程</Link>}
            {item.status === 'completed' && item.video_url && <a className="underline" href={item.video_url} target="_blank" rel="noreferrer">打开成片</a>}</div>
        </div>)}</div>}
      </CardContent></Card>)}
    </div>}
    <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} excluded={products.map(p => p.id)}
      onSelect={added => setProducts(prev => [...prev, ...added.filter(p => !prev.some(item => item.id === p.id))].slice(0, 50))} />
  </div>;
}
