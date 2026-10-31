import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Music2, ImageIcon, Loader2, Pause, Play, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { accessRequest } from '@/api/accessControl';
import { listMaterialAssets, recoverMaterialUploads, type EditorMaterial } from '@/api/materialAssets';
import { mediaPreview } from '@/api/media';

export function EditorAssetsPanel({ userId, audioOnly = false, onAdd }: {
  userId?: string; audioOnly?: boolean; onAdd: (material: EditorMaterial) => void | Promise<void>;
}) {
  const [items, setItems] = useState<EditorMaterial[]>([]), [source, setSource] = useState('own');
  const [search, setSearch] = useState(''), [offset, setOffset] = useState(0), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [playing, setPlaying] = useState('');
  const [adding, setAdding] = useState(''), [revision, setRevision] = useState(0);
  const player = useRef<HTMLAudioElement | null>(null), generation = useRef(0), addLock = useRef(false);
  const stop = useCallback(() => {
    generation.current++;
    if (player.current) { player.current.pause(); player.current.removeAttribute('src'); player.current.load(); player.current = null; }
    setPlaying('');
  }, []);
  useEffect(() => {
    stop();
    return stop;
  }, [source, offset, audioOnly, stop]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setItems([]);
    const load = async () => {
      if (!userId) return;
      const data = source === 'shared'
        ? await accessRequest('material-assets', { action: 'shared' })
        : await listMaterialAssets(offset, 30, audioOnly ? 'audio' : undefined);
      if (!cancelled) {
        const materials = (data.materials || []).filter((item: EditorMaterial) => !audioOnly || item.type === 'audio');
        setItems(materials); setTotal(source === 'shared' ? materials.length : data.total);
      }
    };
    void load().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '素材读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, source, offset, audioOnly, revision]);
  const preview = async (item: EditorMaterial) => {
    if (playing === item.id) { stop(); return; }
    stop(); const current = generation.current;
    try {
      const url = await mediaPreview(item.url);
      if (current !== generation.current) return;
      const audio = new Audio(url); player.current = audio;
      audio.onended = () => { if (player.current === audio) stop(); };
      audio.onerror = () => { if (player.current === audio) { stop(); setError('音频无法播放，请刷新素材或检查原文件'); } };
      await audio.play();
      if (current === generation.current) setPlaying(item.id); else audio.pause();
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '试听失败'); }
  };
  const add = async (item: EditorMaterial) => {
    if (addLock.current) return;
    addLock.current = true; setAdding(item.id); setError('');
    try { stop(); await onAdd(item); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '素材添加失败'); }
    finally { addLock.current = false; setAdding(''); }
  };
  const recover = async () => {
    if (!userId || loading) return;
    setLoading(true); setError('');
    try {
      const result = await recoverMaterialUploads(userId);
      if (result.pending) { setError(result.errors[0]); toast.error(result.errors[0]); }
      if (result.deleted) toast.info(`${result.deleted}个原素材已删除，已核对回执`);
      if (result.restored) toast.success(`已恢复${result.restored}个原素材登记`);
      setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '上传恢复失败'); }
    finally { setLoading(false); }
  };
  const filtered = items.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="flex h-full min-h-0 flex-col text-zinc-200">
    <div className="space-y-2 border-b border-zinc-800 p-3">
      <p className="text-xs text-zinc-400">{audioOnly ? '试听自己的配音、录音和授权音频。' : '选择自己的上传、生成结果或团队共享素材。'}</p>
      <div className="flex flex-wrap gap-2">
        {(['own', 'shared'] as const).map(value => <Button key={value} size="sm" variant={source === value ? 'default' : 'outline'}
          aria-pressed={source === value} onClick={() => { setSource(value); setOffset(0); }}>
          {value === 'own' ? '我的素材' : '团队共享'}
        </Button>)}
        <Button size="sm" variant="ghost" aria-label="刷新资源" onClick={() => { stop(); setRevision(value => value + 1); }} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <input aria-label="搜索资源" placeholder="搜索当前页素材" value={search} onChange={event => setSearch(event.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-800 p-2 text-sm" />
      <Button size="sm" variant="ghost" onClick={recover} disabled={loading}>恢复原素材上传</Button>
    </div>
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-2 p-3">
        {loading && <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />读取素材…</p>}
        {error && <p role="alert" className="break-words text-sm text-amber-300">{error}</p>}
        {!loading && !error && !filtered.length && <p className="text-sm text-zinc-400">
          {search ? '当前页没有匹配素材' : source === 'shared' ? '暂无团队共享素材' : '暂无素材，请从媒体库上传或录制自己的音频'}
        </p>}
        {filtered.map(item => <div key={item.id} className="flex min-w-0 items-center gap-2 rounded border border-zinc-700 p-2">
          {item.type === 'audio' ? <Music2 className="h-5 w-5 shrink-0 text-indigo-300" />
            : item.type === 'image' ? <ImageIcon className="h-5 w-5 shrink-0" /> : <Film className="h-5 w-5 shrink-0" />}
          <div className="min-w-0 flex-1"><p className="truncate text-sm" title={item.name}>{item.name}</p>
            <p className="text-xs text-zinc-400">{source === 'shared' ? '团队授权' : '自有素材'}
              {item.duration_sec ? ` · ${Number(item.duration_sec).toFixed(2)}秒` : ''}</p></div>
          {item.type === 'audio' && <Button size="icon" variant="ghost" aria-label={`${playing === item.id ? '停止试听' : '试听'}${item.name}`}
            onClick={() => void preview(item)}>{playing === item.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>}
          <Button size="icon" variant="ghost" aria-label={`添加${item.name}到时间轴`} disabled={!!adding}
            onClick={() => void add(item)}>{adding === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
        </div>)}
      </div>
    </ScrollArea>
    {source === 'own' && <div className="flex items-center justify-between border-t border-zinc-800 p-2 text-xs">
      <Button size="sm" variant="ghost" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 30))}>上一页</Button>
      <span>{total ? offset + 1 : 0}–{Math.min(offset + 30, total)} / {total}</span>
      <Button size="sm" variant="ghost" disabled={loading || offset + 30 >= total} onClick={() => setOffset(value => value + 30)}>下一页</Button>
    </div>}
  </div>;
}
