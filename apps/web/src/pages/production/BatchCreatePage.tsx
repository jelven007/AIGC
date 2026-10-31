import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Package, Loader2, RefreshCw, Pause, Play, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listProductPage } from '@/api/products';
import { useWorkspaceEntry } from '@/hooks/useWorkspaceEntry';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import FloatingNotice from '@/components/common/FloatingNotice';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { modelSettingsRequest, type ModelCatalogEntry } from '@/api/modelSettings';
import { BatchJobError, controlBatchVideoJob, createBatchVideoJob, listBatchVideoJobs, quoteBatchVideoJobs,
  type BatchInput, type BatchVideoJob } from '@/api/batchVideoJobs';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';
import { readTaskReceipt } from '@/lib/taskReceipt';

interface Product { id: string; name: string; category: string }
interface PendingBatch { key: string; input: BatchInput }
const states: Record<string, string> = { pending: '等待中', processing: '处理中', paused: '已暂停',
  running: '处理中', waiting: '等待依赖', active: '已排队', unknown: '待核对', awaiting_confirmation: '等待预览确认',
  awaiting_publish: '等待确认发布', cancelling: '等待已提交任务结束', completed: '全部完成', partial: '部分完成', failed: '已失败', cancelled: '已取消' };
const active = (job: BatchVideoJob) => ['pending', 'processing', 'paused', 'cancelling', 'awaiting_publish'].includes(job.status);
const stageNames: Record<string, string> = { video: '镜头', tts: '配音', subtitles: '音轨测量与字幕', render: '成片合成', publish: '发布' };
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
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError('');
    try {
      const first = await listProductPage({ limit: 100 }, user.id, controller.signal);
      const second = first.next_cursor ? await listProductPage({ limit: 100, cursor: first.next_cursor }, user.id, controller.signal) : null;
      if (!controller.signal.aborted) setProducts([...first.products, ...(second?.products || [])]);
    } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [user]);
  useEffect(() => {
    if (open) { setSelected([]); setProducts([]); setSearch(''); void load(); }
    return () => abort.current?.abort();
  }, [open, load]);
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
  const entry = useWorkspaceEntry(user?.id);
  return <BatchWorkspace key={user?.id || 'signed-out'} entry={entry} />;
}

function BatchWorkspace({ entry }: { entry: any }) {
  const { user } = useAuth();
  const activeWorkspace = useRef(false);
  useEffect(() => { activeWorkspace.current = true; return () => { activeWorkspace.current = false; }; }, []);
  const [scriptInput] = useState(() => {
    const input = entry;
    return input?.from === 'script' && Array.isArray(input.scenes) && input.scenes.length >= 2 && input.scenes.length <= 6
      && input.scenes.every((scene: any) => typeof scene.prompt === 'string' && scene.prompt.trim()
        && typeof scene.dialogue === 'string' && scene.dialogue.trim() && Number.isInteger(scene.duration)
        && scene.duration >= 2 && scene.duration <= 15) ? input as {
          productName: string; platform: string; scenes: { prompt: string; dialogue: string; duration: number }[];
        } : null;
  });
  const credits = useCredits();
  const [view, setView] = useState<'create' | 'history'>('create');
  const [products, setProducts] = useState<Product[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState('商品视频批次');
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [quote, setQuote] = useState<number | null>(null);
  const [pipelineCosts, setPipelineCosts] = useState<{ video: number; tts: number; subtitles: number; render: number } | null>(null);
  const [pipelineEnabled, setPipelineEnabled] = useState(!!scriptInput);
  const [shots, setShots] = useState(scriptInput?.scenes.map(scene => scene.prompt.replace(/[\r\n]+/g, ' ')).join('\n') || '商品外观特写\n商品在真实使用场景中的展示');
  const [voice, setVoice] = useState('');
  const [subtitles, setSubtitles] = useState(true);
  const [delivery, setDelivery] = useState<'render' | 'publish'>('render');
  const [configError, setConfigError] = useState('');
  const [settings, setSettings] = useState<BatchInput['settings']>({
    duration: scriptInput?.scenes[0].duration || 5, ratio: '9:16', resolution: '720P', style: '专业商品展示',
    language: scriptInput?.platform === 'tiktok' ? 'en' : 'zh',
  });
  const [overrides, setOverrides] = useState<BatchInput['overrides']>({});
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const submitting = useRef(false);
  const owner = useRef(user?.id); owner.current = user?.id;
  const storageKey = user ? `shoproai:batch-request:${user.id}` : '';
  const validReceipt = (saved: any) => saved && typeof saved.key === 'string' && saved.input?.name && Array.isArray(saved.input.product_ids);
  const { value: pending, write: savePending, error: storageError } = useTaskReceipt<PendingBatch>(storageKey, validReceipt);
  const [legacyError, setLegacyError] = useState('');
  useEffect(() => {
    setLegacyError(''); setBusy(''); submitting.current = false; setError('');
    if (!storageKey) return;
    try {
      const current = readTaskReceipt<PendingBatch>(storageKey, validReceipt);
      if (current.error || current.value) return;
      const stored = sessionStorage.getItem(storageKey);
      const saved = stored ? JSON.parse(stored) : null;
      if (!stored) return;
      if (!validReceipt(saved)) throw new Error('旧批次回执读取失败，请核对原任务后再提交');
      if (savePending(saved)) sessionStorage.removeItem(storageKey);
    } catch (cause) { setLegacyError(message(cause)); }
  }, [storageKey, savePending]);
  const client = useQueryClient(), listKey = useMemo(() => ['tasks', user?.id, 'batch', 'list'], [user?.id]);
  const history = useTaskQuery(useMemo(() => ({ queryKey: listKey,
    queryFn: ({ signal }: { signal: AbortSignal }) => listBatchVideoJobs(user!.id, signal),
  }), [listKey, user?.id]), 'batch', !!user);
  const jobs = history.data || [], loading = history.isPending;
  const setJobs = (update: (previous: BatchVideoJob[]) => BatchVideoJob[]) =>
    client.setQueryData<BatchVideoJob[]>(listKey, previous => update(previous || []));
  const config = useQuery({ queryKey: ['batch-config', user?.id], enabled: !!user, staleTime: 300000, retry: false,
    queryFn: async ({ signal }) => {
      const [catalog, prices] = await Promise.all([
        modelSettingsRequest<{ configs: ModelCatalogEntry[] }>({ action: 'catalog' }, user!.id, signal),
        quoteBatchVideoJobs(user!.id),
      ]);
      return { models: catalog.configs.filter(item => item.category === 'video' && item.enabled), prices };
    } });
  useEffect(() => {
    const enabled = config.data?.models || [];
    setModels(enabled); setQuote(config.data?.prices.unit_cost ?? null);
    setPipelineCosts(config.data?.prices.pipeline_costs || null);
    setProvider(prev => enabled.some(item => item.provider === prev) ? prev : enabled[0]?.provider || '');
    setConfigError(config.error?.message || '');
  }, [config.data, config.error]);
  const loadConfig = useCallback(() => config.refetch(), [config.refetch]);
  const loadJobs = useCallback(async (_quiet = false) => {
    const uid = owner.current;
    try { await history.refetch({ throwOnError: true }); if (owner.current === uid) setError(''); }
    catch (cause) { if (owner.current === uid) setError(message(cause)); }
  }, [history.refetch]);
  const shotList = shots.split('\n').map(value => value.trim()).filter(Boolean);
  const unitCost = pipelineEnabled ? pipelineCosts
    ? shotList.length * pipelineCosts.video + pipelineCosts.tts + (subtitles ? pipelineCosts.subtitles : 0) : null : quote;
  const total = unitCost == null ? null : products.length * unitCost;
  const pipelineValid = !pipelineEnabled || (shotList.length >= 2 && shotList.length <= 6 && shotList.every(shot => shot.length <= 500)
    && voice.trim() && settings.resolution !== '480P' && products.every(product => overrides[product.id]?.narration?.trim()));
  const submit = async () => {
    if (!user || submitting.current || storageError || legacyError) return;
    const uid = user.id;
    const cleanOverrides = Object.fromEntries(Object.entries(overrides).map(([id, value]) => [id, {
      ...(value.prompt?.trim() ? { prompt: value.prompt.trim() } : {}),
      ...(pipelineEnabled && value.narration?.trim() ? { narration: value.narration.trim() } : {}),
    }]).filter(([, value]) => Object.keys(value).length));
    const attempt = pending || (unitCost && products.length && provider && name.trim() && pipelineValid ? {
      key: crypto.randomUUID(), input: { name: name.trim(), provider, product_ids: products.map(p => p.id),
        settings, overrides: cleanOverrides, expected_unit_cost: unitCost, budget: products.length * unitCost,
        ...(pipelineEnabled ? { pipeline: { shots: shotList, voice: voice.trim(), subtitles, transition: 'none', delivery } } : {}) },
    } : null);
    if (!attempt) { toast.error('请选择商品、模型并确认批次名称和预算'); return; }
    submitting.current = true; setBusy('create');
    if (!savePending(attempt)) {
      submitting.current = false; setBusy(''); return;
    }
    try {
      const batch = await createBatchVideoJob(attempt.key, attempt.input, uid);
      if (!activeWorkspace.current || owner.current !== uid) return;
      savePending(null); setProducts([]); setOverrides({}); setView('history'); setExpanded(batch.id);
      setJobs(prev => [batch, ...prev.filter(job => job.id !== batch.id)]);
      toast.success(`批次已保存，当前预占 ${batch.reserved_credits} 积分`);
    } catch (cause) {
      if (!activeWorkspace.current || owner.current !== uid) return;
      toast.error(message(cause));
      // 明确的事务拒绝没有扣费，可以编辑表单；网络/服务故障保留原请求防止重复预占。
      if (cause instanceof BatchJobError && [400, 401, 402, 403, 409, 429].includes(cause.status)) {
        savePending(null);
        if (cause.status === 409) void loadConfig();
      }
    } finally { if (activeWorkspace.current && owner.current === uid) { submitting.current = false; setBusy(''); } }
  };
  const control = async (job: BatchVideoJob, action: 'pause' | 'resume' | 'cancel') => {
    if (!user || busy) return;
    const uid = user.id;
    setBusy(job.id);
    try {
      const updated = await controlBatchVideoJob(job.id, action, uid);
      if (!activeWorkspace.current || owner.current !== uid) return;
      setJobs(prev => prev.map(item => item.id === updated.id ? updated : item));
      toast.success(action === 'pause' ? '后续提交已暂停，已受理任务继续处理'
        : action === 'resume' ? '已恢复后续提交' : `取消已生效，已返还 ${updated.refunded_credits} 积分`);
    } catch (cause) { if (owner.current === uid) { toast.error(message(cause)); void loadJobs(true); } }
    finally { if (owner.current === uid) setBusy(''); }
  };
  return <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
    <PageHeader title="批量生成工作台" description="逐商品生成镜头、配音和成片，关闭页面后后台继续处理。" actions={<>
        <Button variant={view === 'create' ? 'default' : 'outline'} onClick={() => setView('create')}>新建任务</Button>
        <Button variant={view === 'history' ? 'default' : 'outline'} onClick={() => { setView('history'); void loadJobs(); }}>历史任务</Button>
      </>} />
    {(storageError || legacyError || history.error) && <p role="alert" className="text-sm text-destructive break-words">
      {storageError || legacyError || history.error?.message}</p>}
    {view === 'create' ? <>
      {scriptInput && <FloatingNotice id={`batch-script-${user?.id}`} title={`已载入 ${scriptInput.productName} 的分镜要求`} duration={10000}>
        <p>请选择对应商品、填写音色并确认台词和预算。</p>
        <p>当前每镜头统一为 {settings.duration} 秒。请调整下方时长，使配音适合总镜头时长。</p>
      </FloatingNotice>}
      {pending && <FloatingNotice id={`batch-pending-${user?.id}`} title="上次提交结果尚未确认" tone="warning" duration={Infinity}>
        <p>请恢复原请求，避免重复预占积分。</p>
        <p className="text-sm break-words">{pending.input.name} · {pending.input.product_ids.length} 个商品 · 预算 {pending.input.budget} 积分</p>
        <Button onClick={() => void submit()} disabled={!!busy}>{busy ? '恢复中…' : '恢复上次提交'}</Button>
      </FloatingNotice>}
      <Card><CardHeader><CardTitle className="text-base">商品与生成要求</CardTitle>
        <CardDescription>镜头使用已登记商品事实；多镜头模式执行独立配音和真实音轨字幕，发布前可预览成片。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pipelineEnabled} disabled={!!pending || !!busy}
            onChange={e => setPipelineEnabled(e.target.checked)} />启用多镜头配音与合成</label>
          {pipelineEnabled && <fieldset disabled={!!pending || !!busy} className="rounded-lg border p-4 space-y-3">
            <div><label htmlFor="batch-shots" className="text-sm">镜头要求（每行一个，2–6个）</label>
              <Textarea id="batch-shots" maxLength={3005} value={shots} onChange={e => setShots(e.target.value)} /></div>
            <div><label htmlFor="batch-voice" className="text-sm">供应商音色ID</label>
              <Input id="batch-voice" maxLength={200} value={voice} onChange={e => setVoice(e.target.value)} placeholder="填写已配置TTS供应商的音色ID" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subtitles} onChange={e => setSubtitles(e.target.checked)} />生成时间分段字幕</label>
            <div><label htmlFor="batch-delivery" className="text-sm">交付方式</label>
              <select id="batch-delivery" className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={delivery}
                onChange={e => setDelivery(e.target.value as 'render' | 'publish')}>
                <option value="render">保存合成成片</option><option value="publish">合成后预览并确认多账号发布</option></select></div>
            <p className="text-sm text-muted-foreground">总镜头时长 {shotList.length * settings.duration} 秒。逐商品填写目标语言台词；
              配音超出总时长会停止后续合成，请缩短台词或增加镜头。字幕使用已配置的语音识别，支持最多70段。</p>
            {!pipelineCosts && <p role="alert" className="text-sm text-destructive">配音与字幕价格尚未就绪，请重试配置或联系管理员。</p>}
          </fieldset>}
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
                  const next = { ...prev }; next[product.id] = { ...next[product.id] };
                  if (e.target.value.trim()) next[product.id].prompt = e.target.value; else delete next[product.id].prompt;
                  if (!next[product.id].prompt && !next[product.id].narration) delete next[product.id];
                  return next;
                })} />
              {pipelineEnabled && <div className="mt-3"><label htmlFor={`narration-${product.id}`} className="text-sm">目标语言配音正文（必填）</label>
                <Textarea id={`narration-${product.id}`} maxLength={2000} value={overrides[product.id]?.narration || ''} disabled={!!pending || !!busy}
                  onChange={e => setOverrides(prev => ({ ...prev, [product.id]: { ...prev[product.id], narration: e.target.value } }))} /></div>}
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
            <div><label htmlFor="batch-duration" className="text-sm">{pipelineEnabled ? '每个镜头时长（秒）' : '视频时长（秒）'}</label><Input id="batch-duration" type="number" min={2} max={15}
              value={settings.duration} onChange={e => setSettings(prev => ({ ...prev, duration: Number(e.target.value) }))} /></div>
            <div><label htmlFor="batch-ratio" className="text-sm">画幅</label><select id="batch-ratio" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={settings.ratio} onChange={e => setSettings(prev => ({ ...prev, ratio: e.target.value }))}>
              {['9:16', '16:9', '1:1', '4:3', '3:4'].map(value => <option key={value}>{value}</option>)}</select></div>
            <div><label htmlFor="batch-resolution" className="text-sm">分辨率</label><select id="batch-resolution" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={settings.resolution} onChange={e => setSettings(prev => ({ ...prev, resolution: e.target.value }))}>
              {(pipelineEnabled ? ['720P', '1080P'] : ['480P', '720P', '1080P']).map(value => <option key={value}>{value}</option>)}</select></div>
            <div><label htmlFor="batch-language" className="text-sm">目标语言</label><select id="batch-language" className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={settings.language} onChange={e => setSettings(prev => ({ ...prev, language: e.target.value }))}>
              {Object.entries({ zh: '中文', en: '英语', ja: '日语', ko: '韩语', th: '泰语', vi: '越南语' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="sm:col-span-2"><label htmlFor="batch-style" className="text-sm">统一风格要求</label><Input id="batch-style" maxLength={200} value={settings.style}
              onChange={e => setSettings(prev => ({ ...prev, style: e.target.value }))} /></div>
          </fieldset>
          <p className="text-sm text-muted-foreground">模型可能调整时长与分辨率；不支持的规格或商品图片将整批拒绝，不扣积分。</p>
          <div className="flex flex-wrap justify-between items-center gap-3 pt-4 border-t">
            <div className="text-sm"><p>单个商品 {unitCost ?? '—'} 积分 · 本批预占 <strong>{total ?? '—'}</strong> 积分</p>
              <p className="text-muted-foreground">当前余额 {credits.loading ? '读取中…' : credits.error ? '暂不可用' : credits.creditsLeft} 积分</p></div>
            <Button onClick={() => void submit()} disabled={!!pending || !!busy || !products.length || !provider || unitCost == null || !name.trim() || !pipelineValid
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
          {item.stages && <ol className="space-y-1 text-sm">{item.stages.map(stage => <li key={stage.id} className="flex flex-wrap justify-between gap-2">
            <span>{stageNames[stage.kind] || stage.kind}{stage.kind === 'video' ? ` ${stage.position + 1}` : ''} · {states[stage.status] || stage.status}</span>
            <span className="text-muted-foreground">{stage.credit_cost} 积分 · {stage.billing_state === 'refunded' ? '已返还'
              : stage.billing_state === 'settled' ? '已结算' : stage.billing_state === 'free' ? '免积分' : '预占中'}</span>
          </li>)}</ol>}
          <div className="flex flex-wrap gap-3 text-sm">{item.project_id && (!job.pipeline || item.video_url) && <Link className="underline" to={`/video/edit?importId=${encodeURIComponent(item.project_id)}`}>打开工程</Link>}
            {item.video_url && <a className="underline" href={item.video_url} target="_blank" rel="noreferrer">打开成片</a>}
            {item.status === 'awaiting_publish' && item.project_id && <Link className="underline"
              to={`/publish?projectId=${item.project_id}&batchItemId=${item.id}&batchRequestKey=${item.stages?.find(stage => stage.kind === 'publish')?.request_key || ''}`}>预览并确认发布</Link>}</div>
        </div>)}</div>}
      </CardContent></Card>)}
    </div>}
    <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} excluded={products.map(p => p.id)}
      onSelect={added => {
        setProducts(prev => [...prev, ...added.filter(p => !prev.some(item => item.id === p.id))].slice(0, 50));
        if (scriptInput) setOverrides(prev => ({ ...prev, ...Object.fromEntries(added.filter(p => p.name === scriptInput.productName)
          .map(p => [p.id, { ...prev[p.id], narration: scriptInput.scenes.map(scene => scene.dialogue).join('\n') }])) }));
      }} />
  </div>;
}
