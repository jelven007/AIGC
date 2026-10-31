import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Plus, Search, LayoutGrid, List, Trash2, Download, FileSpreadsheet, Video, Link, Loader2, Languages,
  MoreHorizontal, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types/types';
import { PRODUCT_CATEGORIES, listProducts, productDraft, productRequest, ProductRequestError,
  pendingProductKey, type ProductMutation, type ProductTranslationResult } from '@/api/products';
import { productCsv, parseProductCsv } from '@/lib/productCsv';
import { productPrice } from '@/lib/productDisplay';
import { ProductFields, ProductImage, emptyProduct, type ProductEditor } from '@/components/ProductFields';
import { UrlProductImportDialog } from '@/components/UrlProductImportDialog';
import { ProductTranslationDialog } from '@/components/ProductTranslationDialog';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import FloatingNotice from '@/components/common/FloatingNotice';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';

const STATUS = { active: '已上架', inactive: '已下架', draft: '草稿' };
function ProductStatus({ status }: { status: Product['status'] }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap',
    status === 'active' ? 'border-success/30 bg-success/10 text-success'
      : status === 'draft' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border bg-muted text-muted-foreground')}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{STATUS[status]}
  </span>;
}
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
export default function ProductsPage() {
  const navigate = useNavigate(), { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const translationJob = params.get('translationJob');
  const [products, setProducts] = useState<Product[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [status, setStatus] = useState('all'), [sort, setSort] = useState('created_at_desc');
  const [view, setView] = useState('grid'), [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false), [importOpen, setImportOpen] = useState(false), [csvOpen, setCsvOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false), [translationProduct, setTranslationProduct] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | null>(null), [draft, setDraft] = useState<ProductEditor>(emptyProduct);
  const [deleting, setDeleting] = useState<Product[]>([]);
  const { value: pending, write: saveReceipt, error: storageError } = useTaskReceipt<ProductMutation>(user ? pendingProductKey(user.id) : '',
    value => value && ['save', 'delete'].includes(value.action) && typeof value.request_key === 'string' && Array.isArray(value.items));
  const owner = useRef(user?.id); owner.current = user?.id;
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const generation = ++sequence.current;
    if (!user) { setProducts([]); setTotal(0); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const listed = await listProducts({ search, category, status, sort, offset: page * 50, limit: 50 }, user.id);
      if (generation !== sequence.current) return;
      setProducts(listed.products); setTotal(listed.total);
      setSelected(previous => new Set([...previous].filter(id => listed.products.some(product => product.id === id))));
    } catch (cause) { if (generation === sequence.current) setError(cause instanceof Error ? cause.message : '商品读取失败'); }
    finally { if (generation === sequence.current) setLoading(false); }
  }, [user?.id, search, category, status, sort, page]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 250); return () => { clearTimeout(timer); sequence.current++; }; }, [load]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [search, category, status, sort, user?.id]);
  useEffect(() => {
    setProducts([]); setOpen(false); setDeleting([]); setBusy(false);
    setTranslationOpen(false); setTranslationProduct(null);
  }, [user?.id]);
  useEffect(() => {
    if (translationJob && user) { setTranslationProduct(null); setTranslationOpen(true); }
  }, [translationJob, user?.id]);
  const execute = async (request: ProductMutation) => {
    if (!user || busy || storageError) return;
    const uid = user.id;
    setBusy(true); setError('');
    try {
      if (!saveReceipt(request)) return;
      const result = await productRequest(request, uid);
      if (owner.current !== uid) return;
      saveReceipt(null);
      toast.success(result.action === 'delete' ? `已删除${result.count}个商品` : `已保存${result.count}个商品`);
      setOpen(false); setCsvOpen(false); setDeleting([]); setSelected(new Set());
      await load();
    } catch (cause) {
      if (owner.current !== uid) return;
      setError(cause instanceof Error ? cause.message : '商品操作回执未能确认');
      if (cause instanceof ProductRequestError && cause.outcome === 'rejected') {
        saveReceipt(null);
      }
    } finally { if (owner.current === uid) setBusy(false); }
  };
  const save = () => {
    try {
      const normalized = productDraft(draft);
      void execute({ action: 'save', request_key: crypto.randomUUID(), items: [{
        ...(editing ? { id: editing.id, expected_updated_at: editing.updated_at } : {}), draft: normalized }] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '商品参数非法'); }
  };
  const toggleStatus = (product: Product) => {
    try {
      void execute({ action: 'save', request_key: crypto.randomUUID(), items: [{ id: product.id, expected_updated_at: product.updated_at,
        draft: productDraft({ ...product, status: product.status === 'active' ? 'inactive' : 'active' }) }] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '请先编辑并核对商品资料'); }
  };
  const startEdit = (product?: Product) => {
    setEditing(product || null); setDraft(product ? { ...emptyProduct(), ...product, currency: product.currency || 'CNY' } : emptyProduct());
    setError(''); setOpen(true);
  };
  const applyTranslation = (result: ProductTranslationResult) => {
    const original = products.find(product => product.id === result.product_id);
    if (unavailable || !original) { toast.error('请先在商品库找到对应商品，再打开它的翻译记录'); return; }
    if (original.updated_at !== result.source_updated_at) {
      toast.error('商品已被更新，请核对原译文或重新翻译当前版本'); return;
    }
    setEditing(original);
    setDraft({ ...emptyProduct(), ...original, ...result.translation, currency: original.currency || 'CNY' });
    setTranslationOpen(false); setError(''); setOpen(true);
  };
  const select = (id: string, checked: boolean) => setSelected(previous => {
    const next = new Set(previous); checked ? next.add(id) : next.delete(id); return next;
  });
  const unavailable = busy || uploading || !!pending || !!storageError || !user;
  const filtered = !!search || category !== 'all' || status !== 'all' || sort !== 'created_at_desc';
  const clearFilters = () => { setSearch(''); setCategory('all'); setStatus('all'); setSort('created_at_desc'); };
  const actions = (product: Product) => <div className="product-actions flex items-center gap-2">
    <Button size="sm" className="flex-1 h-10 whitespace-nowrap" onClick={() => navigate('/video/create', {
      state: { inputTab: '商品', selectedProduct: product, prefillProductName: product.name } })}><Video className="h-4 w-4" />创建视频</Button>
    <Button size="sm" variant="outline" className="h-10" disabled={unavailable} onClick={() => startEdit(product)}>编辑资料</Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-10 w-10 shrink-0"
        aria-label={`${product.name}更多操作`} disabled={unavailable}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => { setTranslationProduct(product); setTranslationOpen(true); }}>
          <Languages className="h-4 w-4 mr-2" />翻译商品</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleStatus(product)}>{product.status === 'active' ? '下架商品' : '上架商品'}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem aria-label={`删除${product.name}`} className="text-destructive focus:text-destructive"
          onSelect={() => setDeleting([product])}><Trash2 className="h-4 w-4 mr-2" />删除商品</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
  return <div className="product-library p-4 md:p-6 space-y-6">
    <PageHeader title="商品管理" description="管理商品图片、卖点与来源，让资料成为视频创作的起点。" actions={<>
        <Button disabled={unavailable} onClick={() => startEdit()}><Plus className="h-4 w-4" />添加商品</Button>
        <Button variant="outline" disabled={unavailable} onClick={() => setImportOpen(true)}><Link className="h-4 w-4" />链接与资料导入</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="更多操作"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={unavailable} onSelect={() => setCsvOpen(true)}><FileSpreadsheet className="h-4 w-4 mr-2" />批量导入</DropdownMenuItem>
            <DropdownMenuItem disabled={!user} onSelect={() => { setTranslationProduct(null); setTranslationOpen(true); }}>
              <Languages className="h-4 w-4 mr-2" />翻译记录</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={loading || !products.length} onSelect={() => download(productCsv(products), '商品列表_当前页.csv')}>
              <Download className="h-4 w-4 mr-2" />导出当前页</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>} />
    {(storageError || error) && <div role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive whitespace-pre-wrap text-sm">
      {storageError || error}<Button variant="ghost" size="sm" disabled={busy} onClick={() => { void load(); }}>刷新商品</Button></div>}
    {pending && !open && !deleting.length && !csvOpen && !importOpen && !translationOpen &&
      <FloatingNotice id={`products-pending-${user?.id}`} title="商品操作回执待确认" tone="warning" duration={Infinity}>
      <p className="text-sm">原请求已保留，恢复后可继续编辑。</p>
      <Button disabled={busy} onClick={() => { void execute(pending); }}>恢复原商品操作</Button>
    </FloatingNotice>}
    <section aria-label="商品筛选" className="product-filters rounded-2xl border bg-card p-4 md:p-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-[minmax(200px,1.5fr)_1fr_1fr_1fr]">
      <label className="col-span-2 sm:col-span-1 space-y-2 text-sm"><span className="block font-medium">搜索商品</span>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input aria-label="搜索商品名称" className="pl-9 bg-background" value={search} placeholder="搜索名称，找到创作资料" onChange={event => setSearch(event.target.value)} /></div></label>
      <label className="space-y-2 text-sm"><span className="block font-medium">商品分类</span>
      <select aria-label="商品分类筛选" className="w-full border border-input rounded-lg px-3 h-10 bg-background text-foreground text-base md:text-sm" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">全部分类</option>{PRODUCT_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select>
      </label>
      <label className="space-y-2 text-sm"><span className="block font-medium">商品状态</span>
      <select aria-label="商品状态筛选" className="w-full border border-input rounded-lg px-3 h-10 bg-background text-foreground text-base md:text-sm" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">全部状态</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </label>
      <label className="col-span-2 sm:col-span-1 space-y-2 text-sm"><span className="block font-medium">排序方式</span>
      <select aria-label="商品排序" className="w-full border border-input rounded-lg px-3 h-10 bg-background text-foreground text-base md:text-sm" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="created_at_desc">最新创建</option><option value="created_at_asc">最早创建</option><option value="price_desc">价格从高到低</option>
        <option value="price_asc">价格从低到高</option><option value="sales_desc">销量从高到低</option></select>
      </label>
      </div>
      {filtered && <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t text-sm">
        <span className="text-muted-foreground">{loading ? '正在查找商品…' : `当前筛选找到 ${total} 个商品`}</span>
        <Button variant="ghost" size="sm" onClick={clearFilters}>清除筛选</Button>
      </div>}
    </section>
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:flex md:justify-between">
      <div className="flex items-center gap-3 text-sm">
        <h2 className="text-base font-semibold">商品资料</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{total} 个</span>
      </div>
      {products.length > 0 && <div className="col-span-2 order-3 md:order-none flex flex-wrap items-center gap-3 text-sm">
      <label className="flex gap-2 items-center"><input type="checkbox" checked={products.every(product => selected.has(product.id))}
        className="h-4 w-4 accent-[hsl(var(--primary))]"
        onChange={event => setSelected(event.target.checked ? new Set(products.map(product => product.id)) : new Set())} />选择当前页</label>
      {selected.size > 0 && <span className="text-muted-foreground">已选 {selected.size} 个</span>}
      {selected.size > 0 && <Button size="sm" variant="destructive" disabled={unavailable} onClick={() => setDeleting(products.filter(product => selected.has(product.id)))}>批量删除</Button>}
      </div>}
      <div className="inline-flex items-center gap-1 rounded-xl border bg-card p-1">
        <Button variant="ghost" size="icon" className={cn('h-8 w-9', view === 'grid' && 'bg-primary/15 text-primary')}
          aria-label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className={cn('h-8 w-9', view === 'table' && 'bg-primary/15 text-primary')}
          aria-label="列表视图" aria-pressed={view === 'table'} onClick={() => setView('table')}><List className="h-4 w-4" /></Button>
      </div>
    </div>
    {loading && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />正在读取商品…</p>}
    {!loading && !products.length && !error && <div className="product-empty rounded-2xl border border-dashed bg-card/50 flex flex-col items-center py-16 px-5 gap-3 text-center">
      <span className="h-16 w-16 rounded-2xl flex items-center justify-center bg-primary/10 text-primary"><Package className="h-8 w-8" /></span>
      <h2 className="text-lg font-semibold">{filtered ? '换个条件再找找' : '建立你的商品资料库'}</h2>
      <p className="text-sm text-muted-foreground">{filtered ? '未找到匹配商品' : '暂无商品，请添加或导入商品资料'}</p>
      {filtered ? <Button variant="outline" onClick={clearFilters}>重置筛选条件</Button> :
        <Button disabled={unavailable} onClick={() => startEdit()} className="mt-2"><Plus className="h-4 w-4" />添加第一个商品</Button>}
    </div>}
    {view === 'grid' ? <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
      {products.map(product => <Card key={product.id} data-product-id={product.id}
        className={cn('product-card flex flex-col min-w-0 overflow-hidden rounded-2xl border transition-colors hover:border-primary/50',
          selected.has(product.id) && 'ring-2 ring-primary border-primary')}>
        <div className="relative"><ProductImage src={product.cover_image} name={product.name}
          className="product-cover aspect-[3/2] border-b [&_img]:object-contain [&_img]:p-4" />
          <label className="absolute left-3 top-3 h-9 w-9 rounded-lg border bg-card/95 flex items-center justify-center shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <input type="checkbox" aria-label={`选择${product.name}`} checked={selected.has(product.id)} className="h-4 w-4 accent-[hsl(var(--primary))]"
              onChange={event => select(product.id, event.target.checked)} /></label>
          <span className="absolute right-3 top-3 rounded-full bg-card/95"><ProductStatus status={product.status} /></span>
        </div>
        <CardContent className="p-4 md:p-5 space-y-3 flex flex-col flex-1">
          <p className="text-xs font-medium text-muted-foreground">{product.category}{product.sub_category ? ` · ${product.sub_category}` : ''}</p>
          <h2 className="font-semibold text-base line-clamp-2 break-words leading-relaxed min-h-12" title={product.name}>{product.name}</h2>
          <p className={cn('font-semibold tabular-nums', product.sale_price == null && product.original_price == null
            ? 'text-base text-muted-foreground' : 'text-xl text-primary')}>{productPrice(product)}</p>
          <p className="text-xs text-muted-foreground">库存：{product.stock ?? '未提供'} · 累计销量：{product.sales_count ?? '未提供'}</p>
          <div className="flex flex-wrap gap-1.5 min-h-7">{(product.selling_points || []).filter(Boolean).slice(0, 2).map(point =>
            <span key={point} title={point} className="product-point max-w-full truncate rounded-md border px-2 py-1 text-xs">{point}</span>)}
            {!product.selling_points?.filter(Boolean).length && <span className="text-xs text-muted-foreground">补充卖点，让脚本更具体</span>}
          </div>
          {product.source?.url && <a href={product.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">
            查看商品来源<ArrowUpRight className="h-3 w-3" /></a>}
          <div className="pt-3 mt-auto border-t">{actions(product)}</div></CardContent></Card>)}
    </div> : <>
      <div className="hidden md:block overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[900px] text-sm text-left"><thead className="bg-muted/60"><tr>{['选择', '商品资料', '价格', '库存', '销量', '状态', '操作'].map(label => <th key={label} className="px-4 py-3 whitespace-nowrap font-medium text-muted-foreground">{label}</th>)}</tr></thead>
        <tbody>{products.map(product => <tr key={product.id} data-product-id={product.id} className={cn('border-t hover:bg-muted/30', selected.has(product.id) && 'bg-primary/5')}>
          <td className="p-3"><input type="checkbox" aria-label={`选择${product.name}`} checked={selected.has(product.id)} onChange={event => select(product.id, event.target.checked)} /></td>
          <td className="p-4 min-w-[240px] max-w-[320px]"><div className="flex items-center gap-3"><ProductImage src={product.cover_image} name={product.name}
            className="h-14 w-14 rounded-lg shrink-0 [&_span]:hidden [&_img]:object-contain" />
            <div className="min-w-0"><p className="font-medium line-clamp-2" title={product.name}>{product.name}</p><p className="text-xs text-muted-foreground mt-1">{product.category}</p></div></div></td>
          <td className="p-4 whitespace-nowrap font-medium tabular-nums">{productPrice(product)}</td>
          <td className="p-4 tabular-nums">{product.stock ?? '未提供'}</td><td className="p-4 tabular-nums">{product.sales_count ?? '未提供'}</td>
          <td className="p-4"><ProductStatus status={product.status} /></td>
          <td className="p-4 min-w-[280px]">{actions(product)}</td></tr>)}</tbody></table>
      </div>
      <div className="md:hidden rounded-2xl border bg-card divide-y">{products.map(product => <article key={product.id} data-product-id={product.id} className="p-4 space-y-4">
        <div className="flex items-start gap-3"><input type="checkbox" aria-label={`选择${product.name}`} checked={selected.has(product.id)}
          className="h-4 w-4 mt-2 accent-[hsl(var(--primary))]" onChange={event => select(product.id, event.target.checked)} />
          <ProductImage src={product.cover_image} name={product.name} className="h-16 w-16 rounded-lg shrink-0 [&_span]:hidden [&_img]:object-contain" />
          <div className="min-w-0 space-y-1"><p className="text-xs text-muted-foreground">{product.category}</p>
            <h2 className="text-sm font-semibold break-words">{product.name}</h2><p className="text-sm font-medium text-primary">{productPrice(product)}</p></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><ProductStatus status={product.status} />
          <p className="text-xs text-muted-foreground">库存：{product.stock ?? '未提供'} · 累计销量：{product.sales_count ?? '未提供'}</p></div>
        {actions(product)}
      </article>)}</div>
    </>}
    {total > 50 && <div className="flex gap-3 justify-center items-center"><Button variant="outline" disabled={!page || loading} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span className="text-sm">第{page + 1}/{Math.ceil(total / 50)}页</span><Button variant="outline" disabled={(page + 1) * 50 >= total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div>}
    <Dialog open={open} onOpenChange={value => { if (!busy && !uploading) setOpen(value); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[92dvh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-5 border-b"><DialogTitle>{editing ? '编辑商品' : '添加商品'}</DialogTitle><DialogDescription>填写已确认的商品资料，未提供的数值留空。</DialogDescription></DialogHeader>
        <div className="overflow-y-auto px-5 py-5 space-y-3">
          {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}
          {user && <ProductFields value={draft} onChange={setDraft} uid={user.id} disabled={busy || !!pending} onUploadChange={setUploading} />}
        </div>
        <DialogFooter className="p-4 md:px-5 border-t bg-muted/20"><Button variant="outline" disabled={busy || uploading} onClick={() => setOpen(false)}>关闭</Button>
          <Button disabled={busy || uploading || !user} onClick={() => pending ? void execute(pending) : save()}>
            {busy ? '保存中…' : pending ? '恢复原商品操作' : '保存商品'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={deleting.length > 0} onOpenChange={value => { if (!value && !busy) setDeleting([]); }}>
      <DialogContent><DialogHeader><DialogTitle>删除{deleting.length}个商品</DialogTitle><DialogDescription>删除后保留已有视频与账单。此操作无法在商品库撤销。</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting([])}>取消</Button>
          <Button variant="destructive" disabled={busy || !user} onClick={() => { void execute(pending || { action: 'delete', request_key: crypto.randomUUID(),
            items: deleting.map(product => ({ id: product.id, expected_updated_at: product.updated_at })) }); }}>
            {pending ? '恢复原商品操作' : '确认删除'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={csvOpen} onOpenChange={value => { if (!busy) setCsvOpen(value); }}>
      <DialogContent><DialogHeader><DialogTitle>批量导入商品</DialogTitle><DialogDescription>使用当前CSV模板，每批1–100条。全部记录通过校验后整批保存。</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap max-h-40 overflow-y-auto">{error}</p>}
        <Button variant="outline" onClick={() => download(productCsv([{ name: '', category: '其他', status: 'draft', currency: 'CNY' }]), '商品导入模板.csv')}>下载CSV模板</Button>
        <Input type="file" aria-label="选择商品CSV" accept=".csv,text/csv" disabled={unavailable} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          try {
            if (file.size > 1024 * 1024) throw new Error('CSV文件不能超过1MB');
            const drafts = parseProductCsv(await file.text());
            await execute({ action: 'save', request_key: crypto.randomUUID(), items: drafts.map(item => ({ draft: item })) });
          } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败'); }
        }} />
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setCsvOpen(false)}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <UrlProductImportDialog open={importOpen} onOpenChange={setImportOpen} onSuccess={() => { void load(); }} />
    <ProductTranslationDialog open={translationOpen} onOpenChange={value => {
      setTranslationOpen(value);
      if (!value && translationJob) { const next = new URLSearchParams(params); next.delete('translationJob'); setParams(next, { replace: true }); }
    }} product={translationProduct} onApply={applyTranslation} initialJobId={translationJob} />
  </div>;
}
