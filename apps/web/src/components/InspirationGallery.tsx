import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Copy } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { inspirationAssets, inspirationCategories, marketingDestination, type InspirationAsset } from '@/lib/inspirationAssets';

export default function InspirationGallery() {
  const { user } = useAuth();
  const [category, setCategory] = useState('全部');
  const [selected, setSelected] = useState<InspirationAsset | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);
  const visible = inspirationAssets.filter(item => category === '全部' || item.category === category);
  const copy = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.prompt); setCopyStatus('提示词已复制'); }
    catch { setCopyStatus('复制失败，可选中上方文字手动复制'); }
  };
  return <section id="灵感" aria-label="视觉参考图库" className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24">
    <div className="space-y-3 max-w-2xl">
      <p className="text-sm text-orange-300">灵感参考</p>
      <h2 className="text-3xl md:text-4xl font-semibold">从一个画面，找到创作方向</h2>
      <p className="text-white/65 leading-relaxed">浏览构图、人物和场景，选择思路继续创作。这里的静态图片用于视觉参考，创作结果以实际生成任务为准。</p>
    </div>
    <div role="group" aria-label="参考分类" className="flex flex-wrap gap-2 mt-8">
      {['全部', ...inspirationCategories].map(name => <button key={name} onClick={() => setCategory(name)} aria-pressed={category === name}
        className={`px-4 py-2 rounded-lg border text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${category === name ? 'border-orange-400 text-orange-300 bg-orange-400/10' : 'border-white/15 text-white/70 hover:text-white hover:border-white/40'}`}>{name}</button>)}
    </div>
    <p aria-live="polite" className="text-sm text-white/55 mt-4 mb-6">{visible.length} 个视觉参考 · 点击查看构图与提示词</p>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-7">
      {visible.map(item => <article key={item.id} className="group min-w-0">
        <div className="aspect-[4/3] bg-white/5 rounded-lg overflow-hidden">
          <img src={item.src} alt={item.title} width={item.width} height={item.height} loading="lazy" decoding="async"
            className={`h-full w-full transition-transform motion-safe:group-hover:scale-105 ${item.category === '人物出镜' || item.category === '商品构图' || item.id === 'ref-01' ? 'object-contain' : 'object-cover'}`} />
        </div>
        <button aria-label={`预览：${item.title}`} onClick={event => { opener.current = event.currentTarget; setSelected(item); setCopyStatus(''); }}
          className="block w-full text-left text-sm mt-2 text-white/90 hover:text-orange-300 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400">
          {item.title}
        </button>
        <span className="block text-xs text-white/55 mt-1">{item.category}</span>
      </article>)}
    </div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="dark max-w-3xl bg-card text-foreground" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
        {selected && <>
          <DialogHeader><DialogTitle>{selected.title}</DialogTitle>
            <DialogDescription>{selected.category} · 静态视觉参考，非实际任务结果</DialogDescription></DialogHeader>
          <img src={selected.src} alt={selected.title} width={selected.width} height={selected.height}
            className="w-full max-h-[45dvh] object-contain rounded-lg bg-black/20" />
          <div className="space-y-2">
            <label htmlFor="inspiration-prompt" className="text-sm font-medium">参考提示词</label>
            <textarea id="inspiration-prompt" readOnly value={selected.prompt} rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed resize-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400" />
            <p className="text-xs text-muted-foreground">带入工作台后可修改文字，再选择自己的素材、模型与规格。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={copy} className="inline-flex items-center gap-2 border border-border rounded-lg px-4 py-2 hover:bg-accent"><Copy className="w-4 h-4" />复制提示词</button>
            <Link to={marketingDestination(`/video/create?inspiration=${selected.id}`, !!user)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold rounded-lg px-4 py-2 hover:bg-primary/90">
              用这个思路创作 <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <p role="status" className="text-sm text-muted-foreground">{copyStatus}</p>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
