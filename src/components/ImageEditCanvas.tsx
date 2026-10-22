import { useEffect, useRef, useState } from 'react';
import { uploadMaterialAsset } from '@/api/materialAssets';
import type { ImageMode } from '../../supabase/functions/_shared/image-contract';

export interface PreparedImageEdit { reference_image: string; mask_image: string }
export default function ImageEditCanvas({ mode, size, userId, rights, disabled, onPrepared }: {
  mode: ImageMode; size: string; userId: string; rights: boolean; disabled: boolean;
  onPrepared: (value: PreparedImageEdit | null) => void;
}) {
  const [source, setSource] = useState<ImageBitmap | null>(null), [error, setError] = useState('');
  const [region, setRegion] = useState({ x: 25, y: 25, width: 50, height: 50 });
  const [scale, setScale] = useState(70), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), active = useRef(true), revision = useRef(0), lock = useRef(false);
  const savedSource = useRef<{ revision: number; url: string } | null>(null);
  const fileLoad = useRef(0);
  const [width, height] = size.split('x').map(Number);
  const invalidate = () => { revision.current++; setReady(false); onPrepared(null); };
  useEffect(() => { active.current = true; return () => { active.current = false; revision.current++; }; }, []);
  useEffect(() => () => source?.close(), [source]);
  useEffect(() => { invalidate(); }, [mode, size, source, region, scale]);
  const geometry = () => {
    if (!source) return null;
    const fit = Math.min(width / source.width, height / source.height) * (mode === 'outpaint' ? scale / 100 : 1);
    return { x: Math.round((width - source.width * fit) / 2), y: Math.round((height - source.height * fit) / 2),
      width: Math.round(source.width * fit), height: Math.round(source.height * fit) };
  };
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'), rect = geometry();
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#252432'; ctx.fillRect(0, 0, width, height);
    if (!source || !rect) return;
    ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
    if (mode === 'inpaint') {
      ctx.fillStyle = 'rgba(255,107,0,.35)'; ctx.strokeStyle = '#ff6b00'; ctx.lineWidth = 5;
      ctx.fillRect(width * region.x / 100, height * region.y / 100, width * region.width / 100, height * region.height / 100);
      ctx.strokeRect(width * region.x / 100, height * region.y / 100, width * region.width / 100, height * region.height / 100);
    }
  }, [source, mode, size, region, scale]);
  const selectSource = async (file?: File) => {
    invalidate(); setError('');
    if (!file) return;
    const current = ++fileLoad.current; setSource(null);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 12 * 1024 * 1024) throw new Error('请选择12MB以内的PNG、JPEG或WebP原图');
      const image = await createImageBitmap(file);
      if (!active.current || current !== fileLoad.current) { image.close(); return; }
      if (image.width * image.height > 16000000) { image.close(); throw new Error('原图不能超过1600万像素，请先缩小图片'); }
      setSource(image);
    } catch (cause) { if (active.current && current === fileLoad.current) setError(cause instanceof Error ? cause.message : '无法读取原图'); }
  };
  const prepare = async () => {
    if (!source || !rights || lock.current || disabled) return;
    lock.current = true; setBusy(true); setError('');
    const current = revision.current;
    try {
      if (mode === 'inpaint' && (region.x + region.width > 100 || region.y + region.height > 100)) throw new Error('重绘区域不能超出画布');
      const original = document.createElement('canvas'), mask = document.createElement('canvas');
      original.width = mask.width = width; original.height = mask.height = height;
      const ctx = original.getContext('2d')!, maskCtx = mask.getContext('2d')!, rect = geometry()!;
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
      maskCtx.fillStyle = '#fff';
      if (mode === 'outpaint') maskCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      else {
        maskCtx.fillRect(0, 0, width, height);
        maskCtx.clearRect(width * region.x / 100, height * region.y / 100, width * region.width / 100, height * region.height / 100);
      }
      const file = async (element: HTMLCanvasElement, name: string) => new File([await new Promise<Blob>((resolve, reject) => {
        element.toBlob(value => value ? resolve(value) : reject(new Error('编辑素材导出失败')), 'image/png');
      })], name, { type: 'image/png' });
      const sourceFile = await file(original, `编辑原图-${mode}-${size}.png`), maskFile = await file(mask, `透明掩码-${mode}-${size}.png`);
      if (savedSource.current?.revision !== current) {
        const uploadedSource = await uploadMaterialAsset(sourceFile, userId, rights);
        savedSource.current = { revision: current, url: uploadedSource.url };
      }
      if (!active.current || current !== revision.current) return;
      const savedMask = await uploadMaterialAsset(maskFile, userId, rights);
      if (!active.current || current !== revision.current) return;
      onPrepared({ reference_image: savedSource.current.url, mask_image: savedMask.url }); setReady(true);
    } catch (cause) { if (active.current && current === revision.current) setError(cause instanceof Error ? cause.message : '编辑素材准备失败'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  return <div className="mx-3 mb-3 rounded-xl border border-white/10 p-3 text-sm text-white/80">
    <label className="block">选择编辑原图<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy}
      onChange={event => { void selectSource(event.target.files?.[0]); event.target.value = ''; }} className="mt-2 block w-full text-xs" /></label>
    <p className="mt-2 text-xs text-white/60">{mode === 'outpaint' ? '缩小原图留出边缘，模型补全背景。' : '橙色区域为重绘范围；可用下方百分比精确调整。'} 模型会参考保留区域，生成后请检查商品和文字。</p>
    <canvas ref={canvas} width={width} height={height} aria-label="图片编辑区域预览"
      className="mt-3 max-h-72 w-full rounded-lg object-contain" style={{ aspectRatio: `${width}/${height}` }} />
    {mode === 'outpaint' ? <label className="mt-3 block">原图占画布（%）<input aria-label="原图占画布（%）" type="range" min={30} max={90} value={scale}
      disabled={disabled || busy} onChange={event => setScale(Number(event.target.value))} className="mt-2 block w-full" />{scale}%</label>
      : <div className="mt-3 grid grid-cols-2 gap-3">
        {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key} className="text-xs">
          {({ x: '重绘区域左侧', y: '重绘区域顶部', width: '重绘区域宽度', height: '重绘区域高度' })[key]}（%）
          <input type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'x' || key === 'y' ? 99 : 99} value={region[key]}
            disabled={disabled || busy} onChange={event => setRegion({ ...region, [key]: Math.max(key === 'x' || key === 'y' ? 0 : 1, Math.min(99, Number(event.target.value))) })}
            className="mt-1 block w-full rounded border border-white/20 bg-black/20 p-2 text-white" />
        </label>)}
      </div>}
    <button type="button" disabled={disabled || busy || !source || !rights || ready} onClick={() => void prepare()}
      className="mt-3 rounded-lg bg-white/10 px-3 py-2 disabled:opacity-40">{busy ? '正在保存私有编辑素材…' : '准备编辑素材'}</button>
    {ready && <p role="status" className="mt-2 text-emerald-300">编辑素材已准备，修改画布后需重新准备。</p>}
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
  </div>;
}
