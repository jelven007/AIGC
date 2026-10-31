import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { deleteMaterial } from '@/api/accessControl';
import { mediaPreview } from '@/api/media';
import { listMaterialAssets, pendingMaterialUploads, recoverMaterialUploads, uploadMaterialAsset } from '@/api/materialAssets';
import { canonicalMedia } from '@/lib/privateMedia';
import { displayMedia as usableMedia } from '@/lib/mediaDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AlertCircle, BarChart3, CheckCircle2, Clock, Download, FileVideo, FlaskConical, ImageIcon, ImagePlus, Music, Pencil, Play, Plus, RefreshCw, Search, Share2, Trash2, Upload, Video } from 'lucide-react';
import { toast } from 'sonner';
import type { Material, VideoProject } from '@/types/types';
import { cn } from '@/lib/utils';
import CoverCandidates from '@/components/CoverCandidates';

const PAGE_SIZE = 24;
const STATUS = {
  draft: { label: '草稿', Icon: FileVideo },
  processing: { label: '生成中', Icon: Clock },
  completed: { label: '已完成', Icon: CheckCircle2 },
  failed: { label: '失败', Icon: AlertCircle },
};
type Item = { kind: 'work'; value: VideoProject } | { kind: 'material'; value: Material };
const titleOf = (item: Item) => item.kind === 'work' ? item.value.title || '未命名作品' : item.value.name;
const urlOf = (item: Item) => item.kind === 'work' ? item.value.video_url : item.value.url;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '请求失败，请重试';
function Media({ item, controls = false }: { item: Item; controls?: boolean }) {
  const [failed, setFailed] = useState(false), [coverFailed, setCoverFailed] = useState(false);
  const url = usableMedia(urlOf(item)), image = item.kind === 'material' && item.value.type === 'image';
  const audio = item.kind === 'material' && item.value.type === 'audio';
  const cover = item.kind === 'work' ? usableMedia(item.value.thumbnail_url) : undefined;
  useEffect(() => { setFailed(false); setCoverFailed(false); }, [url, cover]);
  if (!controls && cover && !coverFailed) return <img src={cover} alt={titleOf(item)} loading="lazy"
    className="h-full w-full object-contain" onError={() => setCoverFailed(true)} />;
  if (!url || failed) return <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-muted-foreground p-4">
    <Video className="h-8 w-8" /><span className="text-xs text-center">{failed ? '媒体读取失败，请刷新后重试' : '暂无可播放媒体'}</span></div>;
  if (image) return <img src={url} alt={titleOf(item)} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} />;
  if (audio) return <div className="h-full flex flex-col justify-center items-center gap-3 p-3"><Music className="h-8 w-8 text-primary" />
    {controls ? <audio aria-label={titleOf(item)} src={url} controls className="max-w-full" onError={() => setFailed(true)} /> :
      <span className="text-sm text-muted-foreground">音频素材</span>}</div>;
  return <video aria-label={titleOf(item)} src={url} controls={controls} preload="metadata" muted={!controls} playsInline
    className="h-full w-full object-contain" onError={() => setFailed(true)} />;
}

export default function WorksPage() {
  const { user } = useAuth();
  return user ? <WorksLibrary key={user.id} userId={user.id} /> : <p className="p-6 text-muted-foreground">请先登录查看作品素材。</p>;
}

function WorksLibrary({ userId }: { userId: string }) {
  const [tab, setTab] = useState<'works' | 'materials'>('works');
  const [projects, setProjects] = useState<VideoProject[]>([]), [materials, setMaterials] = useState<Material[]>([]);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0);
  const [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set()), [selectMode, setSelectMode] = useState(false);
  const [deletion, setDeletion] = useState<Item[]>([]), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Item | null>(null), [editing, setEditing] = useState<VideoProject | null>(null), [title, setTitle] = useState('');
  const [cover, setCover] = useState<VideoProject | null>(null), [rights, setRights] = useState(false);
  const [pending, setPending] = useState(() => pendingMaterialUploads(userId));
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const mounted = useRef(true), sequence = useRef(0), busyRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => { setQuery(search); setPage(0); setSelection(new Set()); }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const load = useCallback(async (silent = false) => {
    const run = ++sequence.current;
    if (!silent) setLoading(true);
    try {
      if (tab === 'works') {
        let request = supabase.from('video_projects').select('*', { count: 'exact' }).eq('user_id', userId);
        if (filter !== 'all') request = request.eq('status', filter);
        if (query.trim()) request = request.ilike('title', `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`);
        const result = await request.order('created_at', { ascending: false }).order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (result.error) throw new Error('作品列表读取失败，请重试');
        if (!mounted.current || run !== sequence.current) return;
        setProjects((result.data || []) as VideoProject[]); setTotal(result.count || 0);
        if (!result.data?.length && page > 0 && (result.count || 0) <= page * PAGE_SIZE) setPage(Math.max(0, Math.ceil((result.count || 0) / PAGE_SIZE) - 1));
      } else {
        const result = await listMaterialAssets(page * PAGE_SIZE, PAGE_SIZE, filter === 'all' ? undefined : filter, query);
        if (!mounted.current || run !== sequence.current) return;
        setMaterials(result.materials); setTotal(result.total);
        if (!result.materials.length && page > 0 && result.total <= page * PAGE_SIZE) setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
      }
      setError('');
    } catch (cause) { if (mounted.current && run === sequence.current) setError(errorText(cause)); }
    finally { if (mounted.current && run === sequence.current) setLoading(false); }
  }, [userId, tab, filter, query, page]);
  useEffect(() => { setProjects([]); setMaterials([]); setTotal(0); setSelection(new Set()); void load(); }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => { clearTimeout(timer); timer = setTimeout(() => void load(true), 400); };
    const channel = supabase.channel(`works-library-${userId}-${tab}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: tab === 'works' ? 'video_projects' : 'materials', filter: `user_id=eq.${userId}` }, reload).subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('shopro:works-updated', reload); window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); window.removeEventListener('shopro:works-updated', reload);
      window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [userId, tab, load]);
  const items: Item[] = tab === 'works' ? projects.map(value => ({ kind: 'work', value })) : materials.map(value => ({ kind: 'material', value }));
  const lock = () => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); return true; };
  const unlock = () => { busyRef.current = false; if (mounted.current) setBusy(false); };
  const verifyOwner = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!mounted.current || session?.user.id !== userId) throw new Error('账号已切换，请重新打开作品素材');
  };
  const openPreview = async (item: Item) => {
    if (!lock()) return;
    try {
      await verifyOwner();
      const source = urlOf(item);
      if (!source || !usableMedia(source)) throw new Error('该记录暂无可播放媒体，请检查任务结果');
      const url = await mediaPreview(source);
      await verifyOwner();
      if (!usableMedia(url)) throw new Error('媒体授权读取失败，请刷新后重试');
      setPreview(item.kind === 'work' ? { kind: 'work', value: { ...item.value, video_url: url } } : { kind: 'material', value: { ...item.value, url } });
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { unlock(); }
  };
  const download = async (item: Item) => {
    if (!lock()) return;
    try {
      await verifyOwner();
      const source = urlOf(item);
      if (!source || !usableMedia(source)) throw new Error('没有可下载的媒体');
      const url = await mediaPreview(source);
      if (!usableMedia(url)) throw new Error('媒体授权读取失败');
      const response = await fetch(url);
      if (!response.ok) throw new Error('下载失败，请刷新后重试');
      const blob = await response.blob();
      if (!blob.size || !/^(image|video|audio)\//.test(blob.type)) throw new Error('媒体文件不可用，请检查任务结果');
      await verifyOwner();
      const objectUrl = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = objectUrl; anchor.download = titleOf(item); anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.success('媒体已下载');
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { unlock(); }
  };
  const remove = async () => {
    if (!deletion.length || !lock()) return;
    let removed = 0;
    const failures: string[] = [];
    try {
      for (const item of deletion) {
        await verifyOwner();
        try {
          if (item.kind === 'material') await deleteMaterial(item.value.id);
          else {
            const result = await supabase.from('video_projects').delete().eq('id', item.value.id).eq('user_id', userId).select('id');
            if (result.error || !result.data?.length) throw new Error('作品未删除，可能仍有运行任务或已无操作权限');
          }
          removed++;
        } catch (cause) { failures.push(`${titleOf(item)}：${errorText(cause)}`); }
      }
      if (!mounted.current) return;
      if (removed) toast.success(`已删除 ${removed} 项`);
      setSelection(new Set()); setDeletion([]); await load(true);
      if (failures.length) setError(`${failures.length} 项未删除。${failures[0]}`);
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { unlock(); }
  };
  const upload = async (files: File[]) => {
    if (!files.length || !rights || !lock()) return;
    let saved = 0;
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        await verifyOwner();
        setUploadProgress({ current: index + 1, total: files.length, name: file.name });
        try { await uploadMaterialAsset(file, userId, rights); saved++; }
        catch (cause) { failures.push(`${file.name}：${errorText(cause)}`); }
      }
      if (!mounted.current) return;
      if (saved) toast.success(`已登记 ${saved} 个素材`);
      await load(true);
      if (failures.length) setError(`${failures.length} 个素材未确认。${failures[0]}`);
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { if (mounted.current) { setUploadProgress(null); setPending(pendingMaterialUploads(userId)); } unlock(); }
  };
  const recover = async () => {
    if (!lock()) return;
    try {
      await verifyOwner();
      const result = await recoverMaterialUploads(userId);
      if (!mounted.current) return;
      if (result.restored) toast.success(`已恢复${result.restored}个原素材登记`);
      if (result.deleted) toast.info(`${result.deleted} 个原素材已删除`);
      await load(true);
      if (result.pending) setError(`${result.pending} 个原上传仍待确认：${result.errors[0]}`);
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { if (mounted.current) setPending(pendingMaterialUploads(userId)); unlock(); }
  };
  const saveTitle = async () => {
    if (!editing || !title.trim() || !lock()) return;
    try {
      await verifyOwner();
      const result = await supabase.from('video_projects').update({ title: title.trim() }).eq('id', editing.id).eq('user_id', userId).select('id');
      if (result.error || !result.data?.length) throw new Error('标题未更新，请重试');
      if (!mounted.current) return;
      setEditing(null); toast.success('标题已更新'); await load(true);
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { unlock(); }
  };
  const uploadCover = async (file: File, project: VideoProject) => {
    if (!rights || !lock()) return;
    try {
      await verifyOwner();
      if (!file.type.startsWith('image/')) throw new Error('封面需使用图片文件');
      const asset = await uploadMaterialAsset(file, userId, rights);
      await verifyOwner();
      const result = await supabase.from('video_projects').update({ thumbnail_url: canonicalMedia(asset.url) }).eq('id', project.id).eq('user_id', userId).select('id');
      if (result.error || !result.data?.length) throw new Error('图片已登记，封面关联失败；可在素材库找到原图片');
      toast.success('封面已更新'); await load(true);
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { if (mounted.current) setPending(pendingMaterialUploads(userId)); unlock(); }
  };
  const toggle = (id: string) => setSelection(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const changeTab = (next: 'works' | 'materials') => { setTab(next); setFilter('all'); setSearch(''); setQuery(''); setPage(0); setError(''); setSelection(new Set()); };
  return <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-5">
    <div className="flex justify-between items-start flex-wrap gap-3">
      <div><h1 className="text-xl font-semibold">作品素材</h1><p className="text-sm text-muted-foreground mt-1">当前筛选共 {total} 项 · 每页 {PAGE_SIZE} 项</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || loading} onClick={() => void load()}><RefreshCw className="h-4 w-4 mr-1.5" />刷新列表</Button>
        <Button asChild><Link to="/video/create"><Plus className="h-4 w-4 mr-1.5" />新建视频</Link></Button></div>
    </div>
    <div className="flex flex-wrap gap-2">{(['works', 'materials'] as const).map(value => <Button key={value} variant={tab === value ? 'default' : 'outline'}
      disabled={busy} onClick={() => changeTab(value)}>{value === 'works' ? '视频作品' : '素材库'}</Button>)}
      <Button asChild variant="outline"><Link to="/ab-test"><FlaskConical className="h-4 w-4 mr-1.5" />对照实验</Link></Button></div>
    {error && <div role="alert" className="border border-destructive/30 rounded-xl p-4 text-sm text-destructive break-words">{error}</div>}
    {pending > 0 && <div role="status" className="border rounded-xl p-4 space-y-3"><p className="text-sm">{pending} 个原素材上传待确认。恢复会核对原文件与原请求。</p>
      <Button variant="outline" disabled={busy} onClick={() => void recover()}>恢复原素材上传</Button></div>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rights} disabled={busy} onChange={event => setRights(event.target.checked)} />
      我已获得这些素材的使用权</label>
    {tab === 'materials' && <div onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault(); if (!rights) { setError('请先确认素材使用权'); return; } void upload(Array.from(event.dataTransfer.files));
    }} className="border-2 border-dashed rounded-xl p-5 space-y-3">
      <label className="block text-sm space-y-2"><span className="flex items-center gap-2 font-medium"><Upload className="h-4 w-4" />上传或拖入素材</span>
        <input aria-label="上传授权素材" type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm,audio/*" disabled={!rights || busy}
          className="block w-full min-w-0 text-sm" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} /></label>
      <p className="text-xs text-muted-foreground">图片、MP4 / MOV / WebM，以及 MP3 / WAV / OGG / M4A / Opus，单文件最大 50MB。</p>
      {uploadProgress && <div role="status" className="space-y-2"><p className="text-sm break-all">正在确认 {uploadProgress.current}/{uploadProgress.total}：{uploadProgress.name}</p>
        <Progress value={(uploadProgress.current - 1) / uploadProgress.total * 100} /></div>}
    </div>}
    <div className="flex flex-wrap gap-3 items-center">
      <div className="relative flex-1 min-w-[180px] max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input aria-label={tab === 'works' ? '搜索作品名称' : '搜索素材名称'} placeholder="搜索名称…" maxLength={200} value={search}
          onChange={event => setSearch(event.target.value)} className="pl-9" /></div>
      <select aria-label={tab === 'works' ? '作品状态' : '素材类型'} className="h-10 border rounded-md px-3 bg-background" value={filter}
        disabled={busy} onChange={event => { setFilter(event.target.value); setPage(0); setSelection(new Set()); }}>
        <option value="all">全部</option>{tab === 'works' ? Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>) :
          [['image', '图片'], ['video', '视频'], ['audio', '音频']].map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <Button variant="outline" disabled={busy || loading} onClick={() => { setSelectMode(value => !value); setSelection(new Set()); }}>{selectMode ? '退出多选' : '多选操作'}</Button>
    </div>
    {selectMode && <div className="flex flex-wrap items-center gap-3 border rounded-xl p-3"><span className="text-sm">已选择 {selection.size} 项</span>
      <Button variant="ghost" disabled={busy} onClick={() => setSelection(selection.size === items.length ? new Set() : new Set(items.map(item => item.value.id)))}>全选本页 / 取消</Button>
      <Button variant="destructive" disabled={busy || !selection.size} onClick={() => setDeletion(items.filter(item => selection.has(item.value.id)))}>删除所选</Button></div>}
    {loading ? <div role="status" aria-label="正在读取列表" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div> :
      !items.length ? <div className="border border-dashed rounded-xl py-16 px-5 text-center space-y-3">
        <Video className="mx-auto h-8 w-8 text-muted-foreground" /><p>{error ? '暂时无法读取列表' : query || filter !== 'all' ? '没有找到匹配的记录' : tab === 'works' ? '还没有视频作品' : '素材库为空'}</p>
        <p className="text-sm text-muted-foreground">{error ? '点击刷新列表重新读取。' : tab === 'works' ? '创建视频后可在这里查看任务结果。' : '确认使用权后上传商品图片、视频或音频。'}</p>
      </div> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{items.map(item => {
        const work = item.kind === 'work' ? item.value : null, playable = !!usableMedia(urlOf(item));
        const status = work ? STATUS[work.status] : null;
        return <article key={item.value.id} className={cn('min-w-0 border rounded-xl overflow-hidden bg-card', selection.has(item.value.id) && 'ring-2 ring-primary')}>
          <div className="relative aspect-video bg-muted"><Media item={item} />
            <Button variant="secondary" size="sm" className="absolute bottom-2 right-2" disabled={!playable || busy} onClick={() => void openPreview(item)}>
              <Play className="h-4 w-4 mr-1" />预览</Button>
            {selectMode && <label className="absolute left-2 top-2 bg-card rounded p-2 flex gap-2 items-center text-xs"><input type="checkbox"
              aria-label={`选择${titleOf(item)}`} checked={selection.has(item.value.id)} onChange={() => toggle(item.value.id)} disabled={busy} />选择</label>}
          </div>
          <div className="p-4 space-y-3"><h2 className="font-medium truncate" title={titleOf(item)}>{titleOf(item)}</h2>
            <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
              {status ? <Badge variant="secondary"><status.Icon className="h-3 w-3 mr-1" />{status.label}</Badge> :
                <Badge variant="secondary">{item.kind === 'material' ? item.value.type === 'image' ? '图片' : item.value.type === 'audio' ? '音频' : '视频' : '作品'}</Badge>}
              <span>{new Date(item.value.created_at).toLocaleDateString('zh-CN')}</span>
            </div>
            {work?.status === 'processing' && <div className="space-y-1"><Progress value={work.progress || 0} /><p className="text-xs text-muted-foreground">任务进度 {work.progress || 0}%</p></div>}
            {work?.status === 'completed' && !playable && <p className="text-xs text-destructive">该完成记录缺少可访问成片，请检查任务结果。</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy || !playable} onClick={() => void download(item)}><Download className="h-3.5 w-3.5 mr-1" />下载</Button>
              {work && <><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(work); setTitle(work.title); }}><Pencil className="h-3.5 w-3.5 mr-1" />标题</Button>
                <Button size="sm" variant="outline" disabled={busy || !playable} onClick={() => setCover(work)}><ImagePlus className="h-3.5 w-3.5 mr-1" />封面</Button>
                <Button asChild variant="outline" size="sm"><Link to={`/analytics?projectId=${work.id}`}><BarChart3 className="h-3.5 w-3.5 mr-1" />表现</Link></Button>
                <Button asChild variant="outline" size="sm"><Link to={`/video/edit?importId=${work.id}`}>剪辑</Link></Button>
                {playable && work.status === 'completed' && <><Button asChild variant="outline" size="sm"><Link to={`/publish?projectId=${work.id}`}><Share2 className="h-3.5 w-3.5 mr-1" />发布</Link></Button>
                  <Button asChild variant="outline" size="sm"><Link to={`/export-formats?projectId=${work.id}`}>多规格导出</Link></Button></>}
                {work.status === 'failed' && <Button asChild size="sm"><Link to="/video/create" state={{ prompt: work.prompt_text || work.title }}>重新生成</Link></Button>}
              </>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeletion([item])}><Trash2 className="h-3.5 w-3.5 mr-1" />删除</Button>
            </div>
          </div>
        </article>;
      })}</div>}
    <div className="flex flex-wrap justify-center items-center gap-3 text-sm">
      <Button variant="outline" disabled={loading || busy || search !== query || page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>第 {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页</span>
      <Button variant="outline" disabled={loading || busy || search !== query || (page + 1) * PAGE_SIZE >= total || page * PAGE_SIZE >= 9984} onClick={() => setPage(value => value + 1)}>下一页</Button>
    </div>
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl max-h-[90dvh] overflow-y-auto"><DialogHeader>
        <DialogTitle className="break-words pr-6">{preview && titleOf(preview)}</DialogTitle><DialogDescription>预览当前记录的授权媒体。</DialogDescription></DialogHeader>
        {preview && <div className="aspect-video max-h-[60dvh] bg-muted rounded-lg overflow-hidden"><Media key={preview.value.id} item={preview} controls /></div>}
      </DialogContent>
    </Dialog>
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !busy) setEditing(null); }}>
      <DialogContent><DialogHeader><DialogTitle>修改作品标题</DialogTitle><DialogDescription>保存后列表显示此标题。</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void saveTitle(); }}><Input aria-label="作品标题" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} required />
          <Button type="submit" disabled={busy || !title.trim()}>保存标题</Button></form>
      </DialogContent>
    </Dialog>
    <Dialog open={!!cover} onOpenChange={open => { if (!open && !busy) setCover(null); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>作品封面</DialogTitle>
        <DialogDescription>上传已授权图片，或生成新的封面候选。</DialogDescription></DialogHeader>
        <label className="block space-y-2 text-sm">上传已授权图片<input aria-label="上传作品封面" type="file" accept="image/*" disabled={!rights || busy}
          className="block w-full min-w-0" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && cover) void uploadCover(file, cover); }} /></label>
        {!rights && <p className="text-xs text-muted-foreground">请在页面中确认素材使用权后上传。</p>}
        {cover && <CoverCandidates key={cover.id} projectId={cover.id} projectTitle={cover.title} onSelected={() => void load(true)} />}
      </DialogContent>
    </Dialog>
    <AlertDialog open={deletion.length > 0} onOpenChange={open => { if (!open && !busy) setDeletion([]); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除 {deletion.length} 项</AlertDialogTitle>
        <AlertDialogDescription>删除记录不可撤销。仍被任务或作品引用的素材会保留；文件清理由后台处理。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground"
          onClick={event => { event.preventDefault(); void remove(); }}>{busy ? '删除中…' : '确认删除'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
