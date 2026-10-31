import { useState } from 'react';
import { Film, ImageIcon, Music, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { EditorMaterial } from '@/api/materialAssets';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialUploadControl } from './MaterialUploadControl';

function MaterialItemCard({ m, onAdd, onDelete }: {
  m: EditorMaterial; onAdd: (m: EditorMaterial) => void | Promise<void>; onDelete: (id: string) => void;
}) {
  const [aspect, setAspect] = useState('aspect-video');
  const resize = (ratio: number) => setAspect(ratio < 0.65 ? 'aspect-[9/16]' : ratio < 0.8
    ? 'aspect-[3/4]' : ratio < 1.2 ? 'aspect-square' : 'aspect-video');
  return <div className={`bg-zinc-800 rounded border border-zinc-700 relative group overflow-hidden hover:border-zinc-500 transition-all hover:-translate-y-0.5 cursor-pointer ${aspect}`}>
    {m.url ? m.type === 'audio' ? <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-800/90 text-zinc-400 gap-1.5 p-2">
      <Music className="w-5 h-5 text-indigo-400" /><span className="text-[9px] truncate w-full text-center">{m.name}</span>
    </div> : m.type === 'video' ? <video src={`${m.url}#t=0.01`} preload="metadata" muted playsInline
      className="w-full h-full object-cover" onLoadedMetadata={event => resize(event.currentTarget.videoWidth / event.currentTarget.videoHeight)} />
      : <img src={m.url} alt={m.name} className="w-full h-full object-cover"
        onLoad={event => resize(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
      : <div className="absolute inset-0 flex items-center justify-center">
        {m.type === 'audio' ? <Music className="w-5 h-5 text-zinc-600" /> : <ImageIcon className="w-5 h-5 text-zinc-600" />}
      </div>}
    {m.type !== 'audio' && <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[10px] truncate text-zinc-300">{m.name}</div>}
    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
      <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full bg-indigo-600/80 text-white hover:bg-indigo-600"
        onClick={event => { event.stopPropagation(); void onAdd(m); }}><Plus className="w-4 h-4" /></Button>
      <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full bg-red-600/80 text-white hover:bg-red-500"
        onClick={event => { event.stopPropagation(); onDelete(m.id); }}><Trash2 className="w-4 h-4" /></Button>
    </div>
  </div>;
}

type ImportedVideo = { id: string; title: string; video_url: string; thumbnail_url: string | null };
export function MediaLibraryPanel({ materials, onAdd, importedVideos, onImportVideo, onUpload, onDelete }: {
  materials: EditorMaterial[]; onAdd: (m: EditorMaterial) => void | Promise<void>;
  importedVideos: ImportedVideo[]; onImportVideo: (video: ImportedVideo) => void;
  onUpload: (file: File, rightsConfirmed: boolean) => Promise<void>; onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('全部');
  const [pickerOpen, setPickerOpen] = useState(false);
  const filtered = materials.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) && (typeFilter === '全部' || m.type === typeFilter));
  return <div className="flex flex-col h-full">
    <div className="px-3 py-2 sticky top-0 bg-zinc-900 z-10 border-b border-zinc-800/50">
      <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <input type="text" placeholder="搜索素材名称…" className="w-full bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 pl-7 pr-3 py-1.5 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          onChange={event => setSearch(event.target.value)} /></div>
    </div>
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/50 flex-wrap">
      {['全部', 'video', 'image', 'audio'].map(type => <button key={type}
        className={`px-2 py-0.5 text-[10px] rounded transition-colors ${typeFilter === type ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
        onClick={() => setTypeFilter(type)}>{type === '全部' ? '全部' : type === 'video' ? '视频' : type === 'image' ? '图片' : '音频'}</button>)}
    </div>
    <div className="px-3 py-2 border-b border-zinc-800/50">
      <button className="w-full flex items-center justify-center gap-2 py-2 rounded border border-dashed border-zinc-600 hover:border-indigo-500 bg-zinc-800/40 hover:bg-indigo-600/10 text-zinc-400 hover:text-indigo-300 transition-all text-[11px] font-medium"
        onClick={() => setPickerOpen(true)}><Upload className="w-3.5 h-3.5" />上传视频 / 选择已生成视频</button>
    </div>
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800 text-zinc-200 p-4">
        <DialogHeader><DialogTitle className="text-sm font-medium text-zinc-200 flex items-center gap-1.5 border-b border-zinc-800 pb-2">
          <Film className="w-3.5 h-3.5 text-indigo-400" />选择已生成视频 / 上传本地视频</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><MaterialUploadControl onUpload={onUpload} /></div>
          <div className="space-y-2"><p className="text-[11px] text-zinc-400">选择您已生成的带货视频：</p>
            <ScrollArea className="max-h-60 border border-zinc-800 rounded-lg bg-zinc-950 p-2">
              {importedVideos.length === 0 ? <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Film className="w-8 h-8 text-zinc-850 animate-pulse" /><p className="text-[10px] text-zinc-600 text-center">暂无已生成视频，请先前往「生成视频」页面创作</p>
              </div> : <div className="space-y-1.5">{importedVideos.map(video => <button key={video.id}
                className="w-full flex items-center gap-2 p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-indigo-500 hover:bg-indigo-600/10 transition-all group text-left"
                onClick={() => { onImportVideo(video); setPickerOpen(false); }}>
                <div className="w-14 h-8 rounded overflow-hidden bg-zinc-800 shrink-0">
                  {video.thumbnail_url ? <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" />
                    : <video src={`${video.video_url}#t=0.01`} preload="metadata" muted playsInline className="w-full h-full object-cover" />}
                </div><div className="flex-1 min-w-0"><p className="text-[10px] text-zinc-300 truncate font-medium">{video.title}</p>
                  <p className="text-[9px] text-zinc-500">点击导入到素材库</p></div>
                <Plus className="w-3.5 h-3.5 text-zinc-600 group-hover:text-indigo-400 shrink-0 transition-colors" />
              </button>)}</div>}
            </ScrollArea>
          </div>
        </div>
        <DialogFooter className="border-t border-zinc-800 pt-2.5">
          <Button size="sm" variant="ghost" className="h-8 border border-zinc-800 text-zinc-400 hover:text-zinc-200" onClick={() => setPickerOpen(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ScrollArea className="flex-1"><div className="px-3 py-2 grid grid-cols-2 gap-2">
      {filtered.map(m => <MaterialItemCard key={m.id} m={m} onAdd={onAdd} onDelete={onDelete} />)}
      {filtered.length === 0 && <div className="col-span-2 py-8 text-center text-[11px] text-zinc-600">
        {materials.length === 0 ? '点击上方按钮添加视频素材' : '无匹配结果'}</div>}
    </div></ScrollArea>
  </div>;
}
