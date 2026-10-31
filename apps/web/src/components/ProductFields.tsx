import { useEffect, useState } from 'react';
import { ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { PRODUCT_CATEGORIES, type ProductDraft, uploadProductImage } from '@/api/products';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';

export function ProductImage({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return <div className={cn('bg-muted overflow-hidden flex items-center justify-center', className)}>
    {src && !failed ? <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover"
      onError={() => setFailed(true)} /> : <div className="text-muted-foreground flex flex-col items-center gap-1 p-2">
      <ImageIcon className="h-7 w-7" aria-hidden="true" /><span className="text-xs">{failed ? '图片暂不可用' : '尚未上传图片'}</span>
    </div>}
  </div>;
}
export type ProductEditor = Omit<ProductDraft, 'original_price' | 'sale_price' | 'stock' | 'sales_count'> & {
  original_price: string | number | null; sale_price: string | number | null; stock: string | number | null; sales_count: string | number | null };
export function emptyProduct(): ProductEditor {
  return { name: '', category: '其他', sub_category: null, description: null, original_price: null, sale_price: null,
    currency: 'CNY', stock: null, sales_count: null, selling_points: [], specs: [], images: [], cover_image: null, status: 'draft' };
}
export function ProductFields({ value, onChange, uid, disabled = false, onUploadChange }: {
  value: ProductEditor; onChange: (draft: ProductEditor) => void; uid: string; disabled?: boolean; onUploadChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const update = (key: keyof ProductEditor, next: unknown) => onChange({ ...value, [key]: next });
  return <fieldset disabled={disabled || uploading} className="space-y-6 min-w-0">
    <section className="space-y-4 border-b pb-5">
      <h3 className="text-base font-semibold">基础资料</h3>
    <div className="space-y-1.5"><Label htmlFor="product-name">商品名称</Label>
      <Input id="product-name" maxLength={200} value={value.name} onChange={event => update('name', event.target.value)} /></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5"><Label htmlFor="product-category">分类</Label>
        <select id="product-category" className="w-full h-10 px-3 border rounded-md bg-background" value={value.category}
          onChange={event => update('category', event.target.value)}>{PRODUCT_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="product-subcategory">子分类</Label>
        <Input id="product-subcategory" maxLength={100} value={value.sub_category || ''} onChange={event => update('sub_category', event.target.value)} /></div>
    </div>
    <div className="space-y-1.5"><Label htmlFor="product-description">商品描述</Label>
      <Textarea id="product-description" rows={3} maxLength={8000} value={value.description || ''}
        onChange={event => update('description', event.target.value)} /></div>
    </section>
    <section className="space-y-4 border-b pb-5">
      <h3 className="text-base font-semibold">价格与状态</h3>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {[['original_price', '原价'], ['sale_price', '售价'], ['stock', '库存'], ['sales_count', '累计销量']].map(([key, label]) =>
        <div key={key} className="space-y-1.5"><Label htmlFor={`product-${key}`}>{label}</Label>
          <Input id={`product-${key}`} type="number" min="0" step={key.includes('price') ? '0.01' : '1'} placeholder="未提供"
            value={value[key as keyof ProductEditor] as string | number ?? ''} onChange={event => update(key as keyof ProductEditor, event.target.value)} /></div>)}
      <div className="space-y-1.5"><Label htmlFor="product-currency">币种</Label>
        <Input id="product-currency" maxLength={3} placeholder="如 CNY / USD" value={value.currency || ''}
          onChange={event => update('currency', event.target.value.toUpperCase())} /></div>
      <div className="space-y-1.5"><Label htmlFor="product-status">状态</Label>
        <select id="product-status" className="w-full h-10 px-3 border rounded-md bg-background" value={value.status}
          onChange={event => update('status', event.target.value)}><option value="draft">草稿</option><option value="active">已上架</option><option value="inactive">已下架</option></select></div>
    </div>
    <p className="text-xs text-muted-foreground">未提供的数值可以留空。价格按原币种保存，累计销量为商品资料值。</p>
    </section>
    <div className="space-y-1.5"><Label htmlFor="product-points">卖点（每行一条，最多6条）</Label>
      <Textarea id="product-points" rows={3} value={value.selling_points.join('\n')} onChange={event => update('selling_points', event.target.value.split('\n'))} /></div>
    <div className="space-y-2">
      <h3 className="text-base font-semibold">规格参数</h3>
      {value.specs.map((spec, index) => <div key={index} className="flex gap-2">
        <Input aria-label={`规格${index + 1}名称`} value={spec.name} onChange={event => update('specs',
          value.specs.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} />
        <Input aria-label={`规格${index + 1}值`} value={spec.value} onChange={event => update('specs',
          value.specs.map((item, position) => position === index ? { ...item, value: event.target.value } : item))} />
        <Button type="button" variant="ghost" size="icon" aria-label={`移除规格${index + 1}`}
          onClick={() => update('specs', value.specs.filter((_, position) => position !== index))}><X className="w-4 h-4" /></Button>
      </div>)}
      <Button type="button" size="sm" variant="outline" disabled={value.specs.length >= 20}
        onClick={() => update('specs', [...value.specs, { name: '', value: '' }])}>添加规格</Button>
    </div>
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">商品实拍图 · {value.images.length}/8</h3>
        <label className={cn('inline-flex gap-2 items-center text-sm cursor-pointer', value.images.length >= 8 && 'opacity-50 pointer-events-none')}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}上传图片
          <input type="file" aria-label="上传商品实拍图" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled || uploading || value.images.length >= 8}
            onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
              setUploading(true); onUploadChange?.(true);
              try {
                const image = await uploadProductImage(file, uid);
                onChange({ ...value, images: [...value.images, image], cover_image: value.cover_image || image });
              } catch (cause) { toast.error(cause instanceof Error ? cause.message : '上传失败'); }
              finally { setUploading(false); onUploadChange?.(false); }
            }} />
        </label></div>
      <p className="text-xs text-muted-foreground">JPG、PNG、WebP，每张不超过5MB。图片私有保存，点击可设为封面。</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {value.images.map((image, index) => <div key={image} className="relative">
          <button type="button" aria-label={`设图片${index + 1}为封面`} className={cn('w-full rounded-lg overflow-hidden border-2',
            value.cover_image === image ? 'border-primary' : 'border-border')} onClick={() => update('cover_image', image)}>
            <ProductImage src={image} name={value.name} className="aspect-square" /></button>
          {value.cover_image === image && <span className="absolute bottom-1 left-1 text-xs px-1 rounded bg-background">封面</span>}
          <button type="button" aria-label={`移除图片${index + 1}`} className="absolute top-1 right-1 p-1 bg-background rounded"
            onClick={() => onChange({ ...value, images: value.images.filter(item => item !== image),
              cover_image: value.cover_image === image ? value.images.find(item => item !== image) || null : value.cover_image })}><X className="w-4 h-4" /></button>
        </div>)}
      </div>
    </div>
  </fieldset>;
}
