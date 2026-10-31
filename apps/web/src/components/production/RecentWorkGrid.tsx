import { Copy, Play } from 'lucide-react';
import type { RecentWork } from '@/hooks/useRecentWorks';

export function RecentWorkGrid({ items, onPreview, onReuse }: {
  items: RecentWork[]; onPreview: (work: RecentWork) => void; onReuse: (prompt: string) => void;
}) {
  return <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
    {items.map(video => <div key={video.id}
      className="break-inside-avoid rounded-xl overflow-hidden group cursor-pointer relative bg-black/20"
      style={{ border: '1px solid rgba(255,255,255,0.07)' }}
      onMouseEnter={event => { void event.currentTarget.querySelector('video')?.play().catch(() => {}); }}
      onMouseLeave={event => {
        const media = event.currentTarget.querySelector('video');
        if (media) { media.pause(); media.currentTime = 0; }
      }} onClick={() => onPreview(video)}>
      <video src={video.url} poster={video.cover || undefined} muted loop playsInline preload="none"
        className="w-full aspect-video object-contain transition-transform duration-300 group-hover:scale-105"
        onError={event => { event.currentTarget.style.display = 'none'; }} />
      <div className="absolute bottom-2 left-2 opacity-70 group-hover:opacity-0 transition-opacity flex items-center gap-1 text-[9px] text-white/80 bg-black/60 px-1.5 py-0.5 rounded backdrop-blur">
        <Play className="w-2.5 h-2.5 fill-white/80" /><span>预览</span>
      </div>
      <div className="absolute top-2 right-2 opacity-100 group-hover:opacity-0 transition-opacity">
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white/80 backdrop-blur">{video.model}</span>
      </div>
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
        <div className="flex justify-between items-start">
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white/80 backdrop-blur">{video.model}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white/80 backdrop-blur">{video.ratio}</span>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] text-white/90 line-clamp-2 leading-relaxed">{video.prompt}</p>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40">{video.category} · {video.language}</span>
            <button className="w-7 h-7 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors"
              onClick={event => { event.stopPropagation(); onReuse(video.prompt); }} title="应用此提示词">
              <Copy className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>)}
  </div>;
}
