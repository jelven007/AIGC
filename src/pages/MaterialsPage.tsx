import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/db/supabase';
import { mediaPreview } from '@/api/media';
import { listMaterialAssets, uploadMaterialAsset, recoverMaterialUploads } from '@/api/materialAssets';
import { deleteMaterial } from '@/api/accessControl';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  ImageIcon, Video, Upload, Trash2, Search, Download, FileVideo, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Material } from '@/types/types';
import { cn } from '@/lib/utils';

// ── 工具函数 ──────────────────────────────────────────────────────────────
function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch { return iso; }
}

// ── 素材卡片 ─────────────────────────────────────────────────────────────
function MaterialCard({
  material, onPreview, onDownload, onDelete,
}: {
  material: Material;
  onPreview:  (m: Material) => void;
  onDownload: (m: Material) => void;
  onDelete:   (id: string) => void;
}) {
  const isImage = material.type === 'image';

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col bg-[hsl(var(--card))] border border-border/60 shadow-sm hover:shadow-md transition-shadow duration-200">
      {/* ── 预览区 ── */}
      <div
        className="relative cursor-pointer group bg-muted overflow-hidden"
        style={{ aspectRatio: '4/3' }}
        onClick={() => onPreview(material)}
      >
        {isImage ? (
          <img
            src={material.url}
            alt={material.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted">
            <div className="w-14 h-14 rounded-2xl bg-muted-foreground/10 flex items-center justify-center">
              <FileVideo className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <span className="text-xs text-muted-foreground">点击预览{material.type === 'audio' ? '音频' : '视频'}</span>
          </div>
        )}

        {/* 悬浮遮罩 */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/20 border border-white/40 flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-white" />
          </div>
        </div>
      </div>

      {/* ── 信息区 ── */}
      <div className="px-3.5 pt-3 pb-2">
        <p className="text-sm font-semibold truncate text-balance" title={material.name}>
          {material.name}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={cn(
            'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded',
            isImage
              ? 'bg-info/15 text-info'
              : 'bg-primary/15 text-primary',
          )}>
            {isImage ? '图片' : material.type === 'audio' ? '音频' : '视频'}
          </span>
          <span className="text-xs text-muted-foreground">{formatSize(material.size)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{formatDate(material.created_at)}</p>
      </div>

      {/* ── 操作按钮区 ── */}
      <div className="grid grid-cols-2 border-t border-border/60 mt-1">
        <button
          onClick={() => onDownload(material)}
          className="flex items-center justify-center py-3 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors gap-1.5"
          title="下载"
        >
          <Download className="w-4 h-4" />
          <span className="text-xs font-medium">下载</span>
        </button>
        <button
          onClick={() => onDelete(material.id)}
          className="flex items-center justify-center py-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors gap-1.5 border-l border-border/60"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-xs font-medium">删除</span>
        </button>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
type TabType = 'all' | 'image' | 'video' | 'audio';

const TYPE_TABS: { value: TabType; label: string }[] = [
  { value: 'all',   label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
];

export default function MaterialsPage() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [dragging,  setDragging]  = useState(false);
  const [search,    setSearch]    = useState('');
  const [tab,       setTab]       = useState<TabType>('all');
  const [deleteId,  setDeleteId]  = useState<string | null>(null);
  const [deleting,  setDeleting]  = useState(false);
  const [preview,   setPreview]   = useState<Material | null>(null);
  const [consent, setConsent] = useState(false), [offset, setOffset] = useState(0), [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');
  const uploadLock = useRef(false), loadRevision = useRef(0);

  const loadMaterials = async () => {
    const revision = ++loadRevision.current;
    setLoading(true); setLoadError('');
    try {
      if (!user) { setMaterials([]); setTotal(0); return; }
      const result = await listMaterialAssets(offset, 30);
      if (revision === loadRevision.current) { setMaterials(result.materials); setTotal(result.total); }
    } catch (cause) { if (revision === loadRevision.current) setLoadError(cause instanceof Error ? cause.message : '素材读取失败'); }
    finally { if (revision === loadRevision.current) setLoading(false); }
  };
  useEffect(() => { void loadMaterials(); return () => { loadRevision.current++; }; }, [user?.id, offset]);
  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || uploadLock.current) return;
    if (!user || !consent) { toast.error('请先登录并确认素材使用权'); return; }
    uploadLock.current = true; setUploading(true); let succeeded = 0;
    try {
      for (const [index, file] of Array.from(files).entries()) {
        setUploadProgress({ current: index + 1, total: files.length, name: file.name });
        try { await uploadMaterialAsset(file, user.id, consent); succeeded++; }
        catch (cause) { toast.error(cause instanceof Error ? cause.message : '素材上传待确认'); }
      }
      if (succeeded) { toast.success('已保存 ' + succeeded + ' 个素材'); await loadMaterials(); }
    } finally { uploadLock.current = false; setUploading(false); setUploadProgress(null); }
  };
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false); void handleFiles(event.dataTransfer.files);
  };

  // ── 删除 ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteMaterial(deleteId);
      setMaterials(prev => prev.filter(m => m.id !== deleteId));
      toast.success('已删除');
      setDeleteId(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  // ── 下载 ────────────────────────────────────────────────────────────────
  const handleDownload = async (m: Material) => {
    const a = document.createElement('a');
    try { a.href = await mediaPreview(m.url); } catch (cause) { toast.error(cause instanceof Error ? cause.message : '下载失败'); return; }
    a.download = m.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  // ── 过滤 ────────────────────────────────────────────────────────────────
  const filtered = materials.filter(m => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase());
    const matchTab    = tab === 'all' || m.type === tab;
    return matchSearch && matchTab;
  });

  const stats = {
    total:  materials.length,
    images: materials.filter(m => m.type === 'image').length,
    videos: materials.filter(m => m.type === 'video').length,
    audio: materials.filter(m => m.type === 'audio').length,
  };

  const tabCount = (t: TabType) =>
    t === 'all' ? stats.total : t === 'image' ? stats.images : t === 'audio' ? stats.audio : stats.videos;

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* ── 页头 ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-balance">素材库</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            共 {stats.total} 个素材 · 图片 {stats.images} · 视频 {stats.videos}
          </p>
        </div>
        <label className="shrink-0 cursor-pointer">
          <input
            type="file" multiple accept="image/*,video/*,audio/*" disabled={!consent || uploading}
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <Button asChild className="h-9 pointer-events-none">
            <span>
              <Upload className="w-4 h-4 mr-1.5" />上传素材
            </span>
          </Button>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={consent} disabled={uploading}
          onChange={event => setConsent(event.target.checked)} />我已获得这些素材的使用权</label>
        <Button variant="outline" size="sm" disabled={loading || uploading} onClick={async () => {
          if (!user) return;
          const result = await recoverMaterialUploads(user.id);
          if (result.pending) toast.error(result.errors[0]);
          if (result.deleted) toast.info(`${result.deleted}个原素材已删除，已核对回执`);
          if (result.restored) toast.success('已恢复' + result.restored + '个素材登记');
          await loadMaterials();
        }}>恢复原素材上传</Button>
      </div>
      {loadError && <div role="alert" className="text-sm text-destructive">{loadError}<Button variant="ghost" onClick={loadMaterials}>重试读取</Button></div>}
      <div className="flex items-center justify-between text-sm">
        <Button variant="ghost" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 30))}>上一页</Button>
        <span>当前页 {materials.length} 个 / 共 {total} 个素材</span>
        <Button variant="ghost" disabled={loading || offset + 30 >= total} onClick={() => setOffset(value => value + 30)}>下一页</Button>
      </div>
      {/* ── 拖拽上传区 ── */}
      <label
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl py-6 cursor-pointer transition-all duration-200',
          dragging
            ? 'border-primary bg-primary/5 scale-[1.005]'
            : 'border-border hover:border-primary/50 hover:bg-muted/30',
        )}
      >
        <input type="file" multiple accept="image/*,video/*,audio/*" disabled={!consent || uploading} className="hidden" onChange={e => handleFiles(e.target.files)} />
        <div className={cn(
          'w-11 h-11 rounded-xl flex items-center justify-center transition-colors',
          uploading ? 'bg-primary/20' : 'bg-muted',
        )}>
          <Upload className={cn('w-5 h-5', uploading ? 'text-primary animate-bounce' : 'text-muted-foreground')} />
        </div>
        <p className="text-sm text-muted-foreground font-medium">
          {uploading && uploadProgress
            ? `正在上传 ${uploadProgress.current}/${uploadProgress.total}：${uploadProgress.name.slice(0, 20)}`
            : uploading ? '上传中，请稍候...' : '拖拽素材至此，或点击选择文件'}
        </p>
        <p className="text-xs text-muted-foreground/70">支持图片 / 视频 / 音频，单文件最大 50MB</p>
        {uploading && uploadProgress && (
          <div className="w-full max-w-xs">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1">
              {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
            </p>
          </div>
        )}
      </label>

      {/* ── 标签 + 搜索（标签在左，搜索在右）── */}
      <div className="flex flex-row items-center gap-3 flex-wrap">
        {/* 标签切换 */}
        <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border/60 shrink-0">
          {TYPE_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                tab === t.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              <span className={cn(
                'ml-1.5 text-xs',
                tab === t.value ? 'text-primary-foreground/70' : 'text-muted-foreground',
              )}>
                {tabCount(t.value)}
              </span>
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索素材名称..."
            className="pl-9 px-3 h-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── 素材网格 ── */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="rounded-2xl overflow-hidden border border-border/60 bg-card flex flex-col h-full">
              <Skeleton className="aspect-[4/3] w-full bg-muted" />
              <div className="p-3 space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4 bg-muted" />
                <Skeleton className="h-3 w-1/2 bg-muted" />
                <div className="flex gap-1.5 pt-1">
                  <Skeleton className="h-7 flex-1 rounded-md bg-muted" />
                  <Skeleton className="h-7 w-7 rounded-md bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(m => (
            <MaterialCard
              key={m.id}
              material={m}
              onPreview={setPreview}
              onDownload={handleDownload}
              onDelete={setDeleteId}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="font-semibold text-muted-foreground">
            {search || tab !== 'all' ? '没有找到匹配的素材' : '素材库为空'}
          </p>
          <p className="text-sm text-muted-foreground">
            {search || tab !== 'all' ? '尝试修改搜索条件' : '上传商品图片或视频素材'}
          </p>
          {!search && tab === 'all' && (
            <label className="cursor-pointer mt-1">
              <input type="file" multiple accept="image/*,video/*,audio/*" disabled={!consent || uploading} className="hidden" onChange={e => handleFiles(e.target.files)} />
              <Button asChild size="sm" className="pointer-events-none">
                <span><Plus className="w-4 h-4 mr-1" />上传素材</span>
              </Button>
            </label>
          )}
        </div>
      )}

      {/* ── 预览弹窗 ── */}
      <Dialog open={!!preview} onOpenChange={v => !v && setPreview(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate text-balance pr-6">{preview?.name}</DialogTitle>
          </DialogHeader>
          <div className="rounded-xl overflow-hidden bg-black/80">
            {preview?.type === 'image' ? (
              <img
                src={preview.url}
                alt={preview.name}
                className="w-full max-h-[65vh] object-contain"
              />
            ) : preview?.type === 'audio' ? <audio aria-label="素材音频预览" src={preview.url} controls autoPlay className="w-full" /> : preview ? (
              <video src={preview.url} controls autoPlay className="w-full max-h-[65vh]" />
            ) : null}
          </div>
          {preview && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span className={cn(
                'text-xs font-medium px-2 py-0.5 rounded',
                preview.type === 'image' ? 'bg-info/15 text-info' : 'bg-primary/15 text-primary',
              )}>
                {preview.type === 'image' ? '图片' : preview.type === 'audio' ? '音频' : '视频'}
              </span>
              {preview.size && <span>大小：{formatSize(preview.size)}</span>}
              <span className="ml-auto">{formatDate(preview.created_at)}</span>
              <Button size="sm" variant="outline" className="h-8" onClick={() => handleDownload(preview)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />下载
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── 删除确认 ── */}
      <AlertDialog open={!!deleteId} onOpenChange={v => !v && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>删除后文件将从存储中移除，无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
