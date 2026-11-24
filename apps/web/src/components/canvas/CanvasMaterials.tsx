import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listMaterialAssets, uploadMaterialAsset, recoverMaterialUploads, pendingMaterialUploads } from '@/api/materialAssets';
import { mediaPreview } from '@/api/media';
import { Upload, Search, ImageIcon, Video, Music2 } from 'lucide-react';
import type { Material } from '@/types/types';
export default function CanvasMaterials({ userId, open, close, choose, type }: {
  userId: string; open: boolean; close: () => void; choose: (material: Material) => void; type?: string;
}) {
  const [materials, setMaterials] = useState<Material[]>([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [rights, setRights] = useState(false);
  const [search, setSearch] = useState(''), [offset, setOffset] = useState(0), [total, setTotal] = useState(0), [attempt, setAttempt] = useState(0);
  const file = useRef<HTMLInputElement>(null), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false; setLoading(true); setError('');
    listMaterialAssets(offset, 24, type, search, userId).then(async data => {
      const values = await Promise.all(data.materials.map(async item => ({ ...item, url: await mediaPreview(item.url, userId) })));
      if (!cancelled) { setMaterials(values); setTotal(data.total); }
    }).catch(cause => { if (!cancelled) setError(cause.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, userId, type, search, offset, attempt]);
  const upload = async (value?: File) => {
    if (!value || busy) return; setBusy(true); setError('');
    try {
      if (type && !value.type.startsWith(`${type}/`)) throw new Error('请选择与节点类型一致的媒体');
      const material = await uploadMaterialAsset(value, userId, rights);
      const url = await mediaPreview(material.url, userId);
      if (active.current) { choose({ ...material, url }); close(); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '上传失败'); }
    finally { if (active.current) setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) close(); }}>
    <DialogContent className="canvas-material-dialog">
      <DialogTitle>素材库</DialogTitle><DialogDescription>选择已有素材，或上传不超过50MB的图片、视频与音频。</DialogDescription>
      <div className="canvas-material-controls"><label className="canvas-search"><Search size={16} /><input aria-label="搜索素材" value={search}
        onChange={e => { setSearch(e.target.value); setOffset(0); }} placeholder="搜索素材名称" /></label>
        <button disabled={!rights || busy} onClick={() => file.current?.click()}><Upload size={16} />{busy ? '上传中…' : '上传素材'}</button></div>
      <label className="canvas-rights"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} />我确认拥有上传素材的使用权</label>
      <input hidden ref={file} type="file" accept={type ? `${type}/*` : 'image/*,video/*,audio/*'} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      {pendingMaterialUploads(userId) > 0 && <button disabled={busy} onClick={async () => {
        setBusy(true); try { const result = await recoverMaterialUploads(userId); if (active.current) { setError(result.errors.join('；')); setAttempt(a => a + 1); } }
        catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '恢复失败'); } finally { if (active.current) setBusy(false); }
      }}>恢复未确认上传</button>}
      {error && <p role="alert" className="canvas-notice">{error}<button onClick={() => setAttempt(a => a + 1)}>重试读取</button></p>}
      <div className="canvas-material-grid">{loading ? <p role="status">正在读取素材…</p> : !materials.length ? <p>暂无符合条件的素材，可先上传。</p>
        : materials.map(item => {
          const Icon = item.type === 'image' ? ImageIcon : item.type === 'video' ? Video : Music2;
          return <button key={item.id} onClick={() => { choose(item); close(); }} aria-label={`使用${item.name}`}>
            {item.type === 'image' ? <img src={item.url} alt={item.name} /> : <Icon size={28} />}
            <span>{item.name}</span><small>{item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : '音频'}</small>
          </button>;
        })}</div>
      <div className="canvas-pagination"><button disabled={offset === 0 || loading} onClick={() => setOffset(n => n - 24)}>上一页</button>
        <span>{total} 个素材</span><button disabled={offset + 24 >= total || loading} onClick={() => setOffset(n => n + 24)}>下一页</button></div>
    </DialogContent>
  </Dialog>;
}
