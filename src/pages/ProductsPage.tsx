import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Plus, Search, LayoutGrid, List, Edit2, Trash2, Download, FileSpreadsheet, Video, Link, Loader2, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types/types';
import { PRODUCT_CATEGORIES, listProducts, productDraft, productRequest, ProductRequestError,
  readProductMutation, storeProductMutation, pendingProductKey, type ProductMutation, type ProductTranslationResult } from '@/api/products';
import { productCsv, parseProductCsv } from '@/lib/productCsv';
import { productPrice } from '@/lib/productDisplay';
import { ProductFields, ProductImage, emptyProduct, type ProductEditor } from '@/components/ProductFields';
import { UrlProductImportDialog } from '@/components/UrlProductImportDialog';
import { ProductTranslationDialog } from '@/components/ProductTranslationDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const STATUS = { active: '已上架', inactive: '已下架', draft: '草稿' };
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
  const [deleting, setDeleting] = useState<Product[]>([]), [pending, setPending] = useState<ProductMutation | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const generation = ++sequence.current;
    if (!user) { setProducts([]); setTotal(0); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const listed = await listProducts({ search, category, status, sort, offset: page * 50, limit: 50 });
      if (generation !== sequence.current) return;
      setProducts(listed.products); setTotal(listed.total);
      setSelected(previous => new Set([...previous].filter(id => listed.products.some(product => product.id === id))));
    } catch (cause) { if (generation === sequence.current) setError(cause instanceof Error ? cause.message : '商品读取失败'); }
    finally { if (generation === sequence.current) setLoading(false); }
  }, [user?.id, search, category, status, sort, page]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 250); return () => { clearTimeout(timer); sequence.current++; }; }, [load]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [search, category, status, sort, user?.id]);
  useEffect(() => {
    setProducts([]); setPending(user ? readProductMutation(user.id) : null); setOpen(false); setDeleting([]);
    setTranslationOpen(false); setTranslationProduct(null);
  }, [user?.id]);
  useEffect(() => {
    if (translationJob && user) { setTranslationProduct(null); setTranslationOpen(true); }
  }, [translationJob, user?.id]);
  const execute = async (request: ProductMutation) => {
    if (!user || busy) return;
    setBusy(true); setError('');
    try {
      storeProductMutation(user.id, request); setPending(request);
      const result = await productRequest(request);
      localStorage.removeItem(pendingProductKey(user.id)); setPending(null);
      toast.success(result.action === 'delete' ? `已删除${result.count}个商品` : `已保存${result.count}个商品`);
      setOpen(false); setCsvOpen(false); setDeleting([]); setSelected(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '商品操作回执未能确认');
      if (cause instanceof ProductRequestError && cause.outcome === 'rejected') {
        localStorage.removeItem(pendingProductKey(user.id)); setPending(null);
      }
    } finally { setBusy(false); }
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
  const unavailable = busy || uploading || !!pending || !user;
  const actions = (product: Product) => <div className="flex flex-wrap items-center gap-1.5">
    <Button size="sm" className="h-8 text-xs" onClick={() => navigate('/video/create', {
      state: { inputTab: '商品', selectedProduct: product, prefillProductName: product.name } })}><Video className="w-3 h-3 mr-1" />创建视频</Button>
    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={unavailable} onClick={() => startEdit(product)}><Edit2 className="w-3 h-3 mr-1" />编辑</Button>
    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={unavailable} onClick={() => {
      setTranslationProduct(product); setTranslationOpen(true); }}><Languages className="w-3 h-3 mr-1" />翻译</Button>
    <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={unavailable} onClick={() => toggleStatus(product)}>{product.status === 'active' ? '下架' : '上架'}</Button>
    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`删除${product.name}`} disabled={unavailable}
      onClick={() => setDeleting([product])}><Trash2 className="w-4 h-4" /></Button>
  </div>;
  return <div className="p-4 md:p-6 space-y-5">
    <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between bg-card/60 p-4 rounded-2xl border border-border/50">
      <div><h1 className="text-xl font-bold flex items-center gap-2"><Package className="w-5 h-5 text-primary" />商品管理</h1>
        <p className="text-xs text-muted-foreground mt-1">保存商品事实、图片与来源，用于带货视频创作</p></div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={unavailable} onClick={() => { setImportOpen(true); }}><Link className="w-4 h-4 mr-1" />链接与资料导入</Button>
        <Button disabled={unavailable} onClick={() => startEdit()}><Plus className="w-4 h-4 mr-1" />添加商品</Button>
        <Button variant="outline" disabled={unavailable} onClick={() => setCsvOpen(true)}><FileSpreadsheet className="w-4 h-4 mr-1" />批量导入</Button>
        <Button variant="outline" disabled={!user} onClick={() => { setTranslationProduct(null); setTranslationOpen(true); }}>翻译记录</Button>
        <Button variant="outline" disabled={loading || !products.length} onClick={() => download(productCsv(products), '商品列表_当前页.csv')}>
          <Download className="w-4 h-4 mr-1" />导出当前页</Button>
      </div>
    </div>
    {error && <div role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive whitespace-pre-wrap text-sm">
      {error}<Button variant="ghost" size="sm" disabled={busy} onClick={() => { void load(); }}>刷新商品</Button></div>}
    {pending && <div className="p-3 rounded-lg bg-warning/10 space-y-2">
      <p className="text-sm">商品操作回执待确认，原请求已保留。恢复后可继续编辑。</p>
      <Button disabled={busy} onClick={() => { void execute(pending); }}>恢复原商品操作</Button>
    </div>}
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <Input aria-label="搜索商品名称" className="pl-9" value={search} placeholder="搜索商品名称" onChange={event => setSearch(event.target.value)} /></div>
      <select aria-label="商品分类筛选" className="border rounded-md px-2 h-10 bg-background" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">全部分类</option>{PRODUCT_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select>
      <select aria-label="商品状态筛选" className="border rounded-md px-2 h-10 bg-background" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">全部状态</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="商品排序" className="border rounded-md px-2 h-10 bg-background" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="created_at_desc">最新创建</option><option value="created_at_asc">最早创建</option><option value="price_desc">价格从高到低</option>
        <option value="price_asc">价格从低到高</option><option value="sales_desc">销量从高到低</option></select>
      <Button variant="outline" size="icon" aria-label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid className="w-4 h-4" /></Button>
      <Button variant="outline" size="icon" aria-label="列表视图" aria-pressed={view === 'table'} onClick={() => setView('table')}><List className="w-4 h-4" /></Button>
    </div>
    {products.length > 0 && <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex gap-2 items-center"><input type="checkbox" checked={products.every(product => selected.has(product.id))}
        onChange={event => setSelected(event.target.checked ? new Set(products.map(product => product.id)) : new Set())} />选择当前页</label>
      <span className="text-muted-foreground">共{total}个商品，已选{selected.size}个</span>
      {selected.size > 0 && <Button size="sm" variant="destructive" disabled={unavailable} onClick={() => setDeleting(products.filter(product => selected.has(product.id)))}>批量删除</Button>}
    </div>}
    {loading && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />正在读取商品…</p>}
    {!loading && !products.length && !error && <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
      <Package className="w-10 h-10" /><p>{search || category !== 'all' || status !== 'all' ? '未找到匹配商品' : '暂无商品，请添加或导入商品资料'}</p></div>}
    {view === 'grid' ? <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {products.map(product => <Card key={product.id} className={cn('flex flex-col min-w-0', selected.has(product.id) && 'ring-2 ring-primary')}>
        <div className="relative"><ProductImage src={product.cover_image} name={product.name} className="aspect-square rounded-t-xl" />
          <input type="checkbox" aria-label={`选择${product.name}`} checked={selected.has(product.id)} className="absolute left-3 top-3 w-4 h-4"
            onChange={event => select(product.id, event.target.checked)} /><span className="absolute right-2 top-2 bg-background px-2 py-0.5 rounded-full text-xs">{STATUS[product.status]}</span></div>
        <CardContent className="p-3 space-y-2 flex flex-col flex-1"><p className="font-semibold text-sm line-clamp-2 break-words" title={product.name}>{product.name}</p>
          <p className="text-xs text-muted-foreground">{product.category}</p><p className="font-bold text-sm text-primary">{productPrice(product)}</p>
          <p className="text-xs text-muted-foreground">库存：{product.stock ?? '未提供'} · 累计销量：{product.sales_count ?? '未提供'}</p>
          {product.source?.url && <a href={product.source.url} target="_blank" rel="noreferrer" className="text-xs text-primary">查看商品来源</a>}
          <div className="pt-2 mt-auto">{actions(product)}</div></CardContent></Card>)}
    </div> : <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm text-left"><thead className="bg-muted"><tr>{['选择', '商品', '价格', '库存', '销量', '状态', '操作'].map(label => <th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{products.map(product => <tr key={product.id} className="border-t">
          <td className="p-3"><input type="checkbox" aria-label={`选择${product.name}`} checked={selected.has(product.id)} onChange={event => select(product.id, event.target.checked)} /></td>
          <td className="p-3 min-w-[180px] max-w-[280px] break-words">{product.name}</td><td className="p-3 whitespace-nowrap">{productPrice(product)}</td>
          <td className="p-3">{product.stock ?? '未提供'}</td><td className="p-3">{product.sales_count ?? '未提供'}</td><td className="p-3 whitespace-nowrap">{STATUS[product.status]}</td>
          <td className="p-3 min-w-[240px]">{actions(product)}</td></tr>)}</tbody></table></div>}
    {total > 50 && <div className="flex gap-3 justify-center items-center"><Button variant="outline" disabled={!page || loading} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span className="text-sm">第{page + 1}/{Math.ceil(total / 50)}页</span><Button variant="outline" disabled={(page + 1) * 50 >= total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div>}
    <Dialog open={open} onOpenChange={value => { if (!busy && !uploading) setOpen(value); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[92dvh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3"><DialogTitle>{editing ? '编辑商品' : '添加商品'}</DialogTitle><DialogDescription>填写已确认的商品资料，未提供的数值留空。</DialogDescription></DialogHeader>
        <div className="overflow-y-auto px-5 pb-4 space-y-3">
          {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}
          {user && <ProductFields value={draft} onChange={setDraft} uid={user.id} disabled={busy || !!pending} onUploadChange={setUploading} />}
        </div>
        <DialogFooter className="p-5 pt-3 border-t"><Button variant="outline" disabled={busy || uploading} onClick={() => setOpen(false)}>关闭</Button>
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
