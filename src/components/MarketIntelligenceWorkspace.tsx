import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { intelligenceRequest, type IntelligenceCatalog, type IntelligenceItem } from '@/api/intelligence';
import { uploadProductImage } from '@/api/products';
import { canonicalMediaTree } from '@/lib/privateMedia';
import { EdgeRequestError } from '@/lib/edgeRequest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TASK_STATUSES } from '@/lib/taskCenter';
import { Download, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';
import { rememberTask } from '@/lib/taskQueries';

const sourceNames: Record<string,string> = { 'intelligence.youtube': 'YouTube 官方公开统计', 'intelligence.ebay': 'eBay 官方商品搜索', 'intelligence.licensed': '授权数据商' };
const platforms: Record<string,string> = { douyin: '抖音', tiktok: 'TikTok', xiaohongshu: '小红书', kuaishou: '快手', shopee: 'Shopee', lazada: 'Lazada', amazon: 'Amazon' };
const markets: Record<string,string> = { US: '美国', GB: '英国', DE: '德国', FR: '法国', IT: '意大利', ES: '西班牙', AU: '澳大利亚', CA: '加拿大', MY: '马来西亚', TH: '泰国', VN: '越南', PH: '菲律宾', SG: '新加坡', ID: '印度尼西亚', CN: '中国' };
type Receipt = Record<string,unknown> & { action: string; request_key: string };
const empty: IntelligenceCatalog = { targets: [], sources: [], prices: {}, jobs: [] };
const fmt = (n?: number | null) => n == null ? '未提供' : new Intl.NumberFormat('zh-CN').format(n);
export default function MarketIntelligenceWorkspace({ mode, request = intelligenceRequest }: { mode: 'competitor' | 'products'; request?: typeof intelligenceRequest }) {
  const { user } = useAuth(), navigate = useNavigate(), kind = `intelligence_${mode}`;
  const [selected, setSelected] = useState('');
  const [source, setSource] = useState(mode === 'competitor' ? 'intelligence.youtube' : 'intelligence.ebay');
  const [subject, setSubject] = useState(''), [name, setName] = useState(''), [platform, setPlatform] = useState('tiktok'), [market, setMarket] = useState('US');
  const [searchMode, setSearchMode] = useState('keyword');
  const [image, setImage] = useState<{ url: string; hash: string; preview: string; name: string } | null>(null);
  const [query, setQuery] = useState(''), [runs, setRuns] = useState(7), [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false), owner = useRef(user?.id); owner.current = user?.id;
  const storageKey = user ? `shopro:intelligence:${mode}:${user.id}` : '';
  const client = useQueryClient();
  const { value: pending, write: saveReceipt, error: storageError } = useTaskReceipt<Receipt>(storageKey,
    value => value && typeof value.request_key === 'string' && ['save_target', 'collect', 'schedule'].includes(value.action));
  const queryState = useTaskQuery(useMemo(() => ({ queryKey: ['tasks', user?.id, 'intelligence', kind, 'catalog'],
    queryFn: ({ signal }: { signal: AbortSignal }) => request<IntelligenceCatalog>({ action: 'catalog', kind }, user!.id, signal),
  }), [user?.id, kind, request]), 'production', !!user);
  const catalog = queryState.data || empty, loading = queryState.isPending;
  useEffect(() => {
    setSelected(value => catalog.targets.some(target => target.id === value) ? value : catalog.targets[0]?.id || '');
  }, [queryState.data]);
  useEffect(() => {
    locked.current = false; setBusy(''); setError(''); setSelected(''); setImage(null);
  }, [user?.id, kind]);
  const load = useCallback(async () => {
    const uid = owner.current;
    try { await queryState.refetch({ throwOnError: true }); }
    catch (cause) { if (uid === owner.current) setError(cause instanceof Error ? cause.message : '读取失败'); }
  }, [queryState.refetch]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.preview); }, [image]);
  const target = catalog.targets.find(item => item.id === selected);
  const sample = target?.latest, items = sample?.data.items || [], price = catalog.prices[kind];
  useEffect(() => { setChecked([]); setQuery(''); }, [selected, sample?.job_id]);
  const available = (slot: string) => !!queryState.data && catalog.sources.some(item => item.slot === slot && item.enabled);
  const commit = async (receipt?: Receipt) => {
    if (!user || !storageKey || locked.current || !queryState.data || storageError) return;
    const uid = user.id;
    const body = canonicalMediaTree(pending || receipt) as Receipt | null | undefined;
    if (!body) return;
    locked.current = true; setBusy(body.action); setError('');
    try {
      if (!saveReceipt(body)) return;
      const result = await request<{ target?: { id: string }; job?: IntelligenceCatalog['jobs'][number] }>(body, uid);
      if (owner.current !== uid) return;
      if (result.job) rememberTask(client, 'production', uid, result.job);
      saveReceipt(null);
      if (result.target?.id) setSelected(result.target.id);
      if (body.action === 'save_target') { setName(''); setSubject(''); setImage(null); }
      toast.success(body.action === 'collect' ? '采集任务已提交，后台继续处理' : body.action === 'schedule' ? '监控计划已保存' : '对象已保存，可确认积分后采集');
      await load();
    } catch (cause) {
      if (owner.current !== uid) return;
      setError(cause instanceof Error ? cause.message : '响应待确认');
      if (cause instanceof EdgeRequestError && [400,401,402,403,409,424,429].includes(cause.status)) {
        saveReceipt(null);
      }
    } finally { if (owner.current === uid) { locked.current = false; setBusy(''); } }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'products' && searchMode === 'image' && (!image || source !== 'intelligence.ebay')) return;
    void commit({ action: 'save_target', request_key: crypto.randomUUID(), kind, source_slot: source,
      name: name.trim() || (mode === 'products' && searchMode === 'image' ? `图片选品 · ${markets[market]}` : subject.trim()),
      params: mode === 'competitor' ? { account_id: subject.trim(), platform } : searchMode === 'image'
        ? { search_mode: 'image', image_url: image!.url, image_hash: image!.hash, market }
        : { query: subject.trim(), market, platform } });
  };
  const upload = async (file?: File) => {
    if (!file || !user || busy || pending) return;
    const uid = user.id;
    setBusy('upload'); setError('');
    try {
      const url = await uploadProductImage(file, uid);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (owner.current !== uid) return;
      setImage({ url: canonicalMediaTree(url), hash, preview: URL.createObjectURL(file), name: file.name });
    } catch (cause) { if (owner.current === uid) setError(cause instanceof Error ? cause.message : '图片上传失败'); }
    finally { if (owner.current === uid) setBusy(''); }
  };
  const schedule = (count: number) => {
    if (!target || price === undefined) return;
    void commit({ action: 'schedule', request_key: crypto.randomUUID(), target_id: target.id, runs: count, budget: count * price, confirmed_credit_cost: price });
  };
  const remove = async () => {
    if (!user || !target || busy || pending || !window.confirm(`删除「${target.name}」和采集快照？已创建的商品保留在商品库。`)) return;
    const uid = user.id;
    setBusy('delete'); setError('');
    try { await request({ action: 'delete', target_id: target.id }, uid); if (owner.current === uid) await load(); }
    catch (cause) { if (owner.current === uid) setError(cause instanceof Error ? cause.message : '删除失败'); }
    finally { if (owner.current === uid) setBusy(''); }
  };
  const importItems = async (ids: string[]) => {
    if (!user || !sample || busy || !ids.length) return;
    const uid = user.id;
    setBusy('import'); setError(''); let count = 0;
    try {
      for (const item_id of ids) {
        await request({ action: 'import_product', sample_id: sample.job_id, item_id }, uid);
        if (owner.current !== uid) return;
        count++;
      }
      toast.success(`已加入${count}个商品，请在商品库确认分类与卖点`); setChecked([]);
    } catch (cause) { if (owner.current === uid) setError(`已成功${count}个，其余可按原来源重试。${cause instanceof Error ? cause.message : '导入失败'}`); }
    finally { if (owner.current === uid) setBusy(''); }
  };
  const exportItems = () => {
    if (!sample) return;
    const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, match => `'${match}`).replace(/"/g,'""')}"`;
    const rows = [['来源','来源版本','观测时间','标题','原网页','价格','币种','7天销量','播放','点赞','评论','分享'],
      ...items.map(item => [sample.data.source.name,sample.data.source.version_id,sample.data.source.observed_at,item.title,item.url,
        item.price,item.currency,item.sold_7d,item.views,item.likes,item.comments,item.shares])];
    const url = URL.createObjectURL(new Blob(['\ufeff'+rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `intelligence-${sample.job_id}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const reference = (item: IntelligenceItem) => navigate('/script', { state: { ...(mode === 'products' ? { productName: item.title } : {}),
    prompt: `创作参考：${item.title}\n来源：${item.url}\n观测：${sample?.data.source.observed_at}\n此标题仅是参考；请依据我确认的商品卖点创作，不沿用竞品的优惠、销量、功效或素材。` } });
  const active = !!target && catalog.jobs.some(job => job.target_id === target.id && ['pending','running','unknown'].includes(job.status));
  const filtered = items.filter(item => item.title.toLowerCase().includes(query.toLowerCase()));
  return <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h1 className="text-2xl font-semibold">{mode === 'competitor' ? '竞品监控' : '智能选品'}</h1>
        <p className="text-sm text-muted-foreground mt-2">{mode === 'competitor' ? '跟踪授权账号的公开统计，保存采样历史，参考真实标题创作。' : '按市场搜索在售商品，保留原币种和来源，确认后加入商品库。'}</p></div>
      <Button variant="outline" disabled={!!busy} onClick={() => { setError(''); void load(); }}><RefreshCw className="h-4 w-4 mr-2" />刷新情报记录</Button>
    </div>
    {(storageError || error || queryState.error) && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive break-words">
      {storageError || error || queryState.error?.message}</p>}
    {pending && <div className="border rounded-lg p-4 text-sm space-y-3"><p>上次操作响应待确认。恢复会使用原标识和原预算。</p>
      <Button disabled={!!busy || loading} onClick={() => void commit()}>恢复原情报请求</Button></div>}
    <form onSubmit={save} aria-label="新增情报对象" className="rounded-xl border bg-card p-4 md:p-6 space-y-4">
      <h2 className="font-semibold">{mode === 'competitor' ? '添加监控账号' : '保存市场搜索'}</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="space-y-2 text-sm">数据源<select aria-label="数据源" value={source} onChange={event => {
          setSource(event.target.value);
          if (event.target.value !== 'intelligence.ebay') setSearchMode('keyword');
          if (event.target.value==='intelligence.ebay' && !['US','GB','DE','FR','IT','ES','AU','CA'].includes(market)) setMarket('US');
        }} className="w-full h-10 rounded-md border bg-background px-3">
          {[mode === 'competitor' ? 'intelligence.youtube' : 'intelligence.ebay','intelligence.licensed'].map(slot => <option key={slot} value={slot}>{sourceNames[slot]} · {available(slot) ? '已启用' : '未配置'}</option>)}</select></label>
        <label className="space-y-2 text-sm">显示名称（选填）<Input value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label>
        {mode === 'products' && source === 'intelligence.ebay' && <label className="space-y-2 text-sm">选品方式<select aria-label="选品方式" value={searchMode}
          disabled={!!busy || !!pending} onChange={event => setSearchMode(event.target.value)} className="w-full h-10 rounded-md border bg-background px-3">
          <option value="keyword">关键词搜索</option><option value="image">上传图片搜索</option></select></label>}
        {(mode === 'competitor' || searchMode === 'keyword') && <label className="space-y-2 text-sm">{mode === 'competitor' ? '账号ID / @handle' : '商品关键词'}<Input required value={subject} maxLength={100} onChange={event => setSubject(event.target.value)} placeholder={mode === 'competitor' ? source === 'intelligence.youtube' ? 'UC频道ID或@handle' : '授权数据商支持的账号ID' : '搜索实际商品名称'} /></label>}
        {mode === 'products' && searchMode === 'image' && <div className="space-y-2">
          <label className="block text-sm space-y-2">选品参考图<Input aria-label="上传选品参考图" type="file" accept="image/jpeg,image/png,image/webp"
            disabled={!!busy || !!pending} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
          <p className="text-xs text-muted-foreground">支持5MB以内的JPG、PNG或WebP。图片保存在本人私有素材中，由eBay官方接口搜索相似商品；采集仍需确认积分。</p>
          {image && <div className="flex items-center gap-3"><img src={image.preview} alt="已上传的选品参考图" className="w-20 h-20 rounded-md object-contain border" />
            <p className="text-xs text-muted-foreground break-all">{image.name} · 上传完成</p></div>}
        </div>}
        {source === 'intelligence.licensed' && <label className="space-y-2 text-sm">授权平台<select aria-label="授权平台" value={platform} onChange={event => setPlatform(event.target.value)} className="w-full h-10 rounded-md border bg-background px-3">
          {Object.entries(platforms).filter(([id]) => mode === 'products' || ['douyin','tiktok','xiaohongshu','kuaishou'].includes(id)).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
        {mode === 'products' && <label className="space-y-2 text-sm">目标市场<select aria-label="目标市场" value={market} onChange={event => setMarket(event.target.value)} className="w-full h-10 rounded-md border bg-background px-3">
          {Object.entries(markets).filter(([id]) => source === 'intelligence.licensed' || ['US','GB','DE','FR','IT','ES','AU','CA'].includes(id)).map(([id,label]) => <option key={id} value={id}>{label}（{id}）</option>)}</select></label>}
      </div>
      <div className="flex flex-wrap gap-3 items-center"><Button type="submit" disabled={!!busy || !!pending || loading
        || (mode === 'products' && searchMode === 'image' ? !image : !subject.trim())}>保存情报对象</Button>
        {!available(source) && <p className="text-sm text-muted-foreground">此数据源未启用，请由管理员在模型接口设置中配置。</p>}</div>
    </form>
    {loading ? <p role="status" className="flex gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取情报记录</p>
      : !catalog.targets.length ? <p className="border rounded-xl p-8 text-center text-sm text-muted-foreground">还没有情报对象。保存账号或搜索后，可确认积分并开始采集。</p>
        : <section aria-label="情报对象与结果" className="space-y-4">
          <label className="block space-y-2 text-sm">选择已保存对象<select aria-label="选择已保存对象" value={selected} onChange={event => setSelected(event.target.value)} className="w-full h-10 rounded-md border bg-background px-3">
            {catalog.targets.map(item => <option key={item.id} value={item.id}>{item.name} · {sourceNames[item.source_slot]}</option>)}</select></label>
          {target && <div className="rounded-xl border p-4 space-y-4">
            <div className="flex flex-wrap gap-3 justify-between"><div><h2 className="font-semibold break-words">{sample?.data.account?.name || target.name}</h2>
              <p className="text-xs text-muted-foreground mt-1">{sourceNames[target.source_slot]} · {mode === 'products'
                ? `${target.params.market} / ${target.params.search_mode === 'image' ? '图片相似搜索' : target.params.query}` : target.params.account_id}</p>
              {target.params.image_hash && <p className="text-xs text-muted-foreground mt-2 break-all">原图SHA-256：{target.params.image_hash}</p>}</div>
              <Button variant="ghost" size="sm" disabled={!!busy || !!pending} onClick={() => void remove()}>删除对象</Button></div>
            <div className="flex flex-wrap gap-3 items-center">
              <Button disabled={!!busy || !!pending || active || price === undefined || !available(target.source_slot)}
                onClick={() => void commit({ action: 'collect', target_id: target.id, request_key: crypto.randomUUID(), confirmed_credit_cost: price })}>立即采集 · {price ?? '—'}积分</Button>
              {target.monitoring ? <Button variant="outline" disabled={!!busy || !!pending} onClick={() => schedule(0)}>停止自动监控</Button> : <>
                <label className="text-sm flex items-center gap-2">监控次数<Input className="w-20" type="number" min={1} max={30} value={runs} onChange={event => setRuns(Number(event.target.value))} /></label>
                <Button variant="outline" disabled={!!busy || !!pending || !Number.isInteger(runs) || runs<1 || runs>30 || price === undefined || !available(target.source_slot)}
                  onClick={() => schedule(runs)}>每天一次 · 确认上限{price === undefined ? '—' : runs*price}积分</Button>
              </>}
            </div>
            <p className="text-xs text-muted-foreground">自动监控最多30次，逐次扣费；余额不足、权限失败或数据源版本变更时停止。手动采集另行确认积分。</p>
            {target.monitoring && <p role="status" className="text-sm">剩余{target.remaining_runs}次 · 剩余上限{target.remaining_budget}积分 · 下次{target.next_run_at ? new Date(target.next_run_at).toLocaleString() : '待调度'}</p>}
            {target.last_error && <p className="text-sm text-destructive break-words">{target.last_error}</p>}
            {!sample ? <p className="text-sm text-muted-foreground">尚无正式采集快照，请先采集。</p> : <>
              <div className="border-t pt-4 text-sm space-y-2">
                <p className="text-muted-foreground break-words">{sample.data.source.definition}</p>
                <p className="text-xs text-muted-foreground break-all">来源版本 {sample.data.source.version_id} · 观测 {new Date(sample.data.source.observed_at).toLocaleString()}</p>
                {sample.data.account && <p>订阅/粉丝：{fmt(sample.data.account.followers)} · <a href={sample.data.account.url} target="_blank" rel="noreferrer" className="underline">查看原账号</a></p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex-1 min-w-40"><span className="sr-only">筛选采集标题</span><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="在当前快照中筛选标题" /></label>
                <Button variant="outline" onClick={exportItems}><Download className="w-4 h-4 mr-2" />导出来源CSV</Button>
                {mode === 'products' && <Button disabled={!!busy || !checked.length} onClick={() => void importItems(checked)}>加入所选商品（{checked.length}）</Button>}
              </div>
              {!filtered.length ? <p className="text-sm text-muted-foreground py-4">当前采集没有匹配结果。请调整关键词或确认账号存在公开内容。</p> : <div className="divide-y">
                {filtered.map(item => <article key={item.id} className="py-4 space-y-3 min-w-0">
                  <div className="flex items-start gap-3">{mode === 'products' && <input className="mt-1 h-4 w-4 shrink-0" type="checkbox" aria-label={`选择商品 ${item.title}`} checked={checked.includes(item.id)}
                    onChange={event => setChecked(value => event.target.checked ? [...value,item.id] : value.filter(id => id!==item.id))} />}
                    <h3 className="text-sm font-medium break-words">{item.title}</h3></div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm text-muted-foreground">
                    {mode === 'products' ? <><p>标价 {item.price} {item.currency}</p><p>近7天销量 {fmt(item.sold_7d)}</p><p>库存 {fmt(item.stock)}</p><p className="break-words">卖家 {item.seller || '未提供'}</p></>
                      : <><p>播放 {fmt(item.views)}</p><p>点赞 {fmt(item.likes)}</p><p>评论 {fmt(item.comments)}</p><p>分享 {fmt(item.shares)}</p></>}
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex gap-1 items-center text-sm underline">原网页<ExternalLink className="h-3 w-3" /></a>
                    <Button variant="outline" size="sm" onClick={() => reference(item)}>参考标题创作</Button>
                    {mode === 'competitor' && <Button variant="outline" size="sm" onClick={() => navigate('/style-copy', { state: {
                      competitor_reference: { sample_id: sample.job_id, item_id: item.id }, title: item.title } })}>上传素材分析风格</Button>}
                    {mode === 'products' && <Button size="sm" disabled={!!busy} onClick={() => void importItems([item.id])}>加入商品库</Button>}
                  </div>
                </article>)}
              </div>}
              {mode === 'competitor' && target.history.length>1 && <details className="border-t pt-3"><summary className="text-sm cursor-pointer">最近30次订阅/粉丝采样</summary>
                <ul className="mt-3 space-y-2 text-xs text-muted-foreground">{target.history.map(row => <li key={row.collected_at}>{new Date(row.collected_at).toLocaleString()} · {fmt(row.followers)}</li>)}</ul></details>}
            </>}
          </div>}
        </section>}
    <section aria-label="后台采集任务" className="space-y-3"><h2 className="font-semibold flex items-center gap-2"><Search className="h-4 w-4" />后台采集任务</h2>
      {!catalog.jobs.length ? <p className="text-sm text-muted-foreground">还没有采集任务。</p> : catalog.jobs.map(job => <div key={job.id} className="border-b pb-3 space-y-1 text-sm">
        <p>{TASK_STATUSES[job.status]} · {job.credit_cost}积分{job.status === 'failed' ? ' · 已按原流水返还' : ''} · {new Date(job.created_at).toLocaleString()}</p>
        {job.error_message && <p className="text-destructive break-words">{job.error_message}</p>}
      </div>)}
    </section>
  </div>;
}
