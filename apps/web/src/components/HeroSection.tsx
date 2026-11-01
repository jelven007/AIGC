import { ArrowRight, Film } from 'lucide-react';
import { inspirationAsset } from '@/lib/inspirationAssets';

interface HeroSectionProps { onGoToApp: () => void; onScrollToPromo?: () => void }
export default function HeroSection({ onGoToApp, onScrollToPromo }: HeroSectionProps) {
  return <section className="relative border-b border-white/10 overflow-hidden">
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none"
      style={{ background: 'radial-gradient(ellipse at 20% 30%, rgba(255,107,0,.13), transparent 65%)' }} />
    <div className="relative max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 grid lg:grid-cols-2 gap-12 items-center">
      <div className="space-y-7">
        <p className="text-sm text-orange-300 tracking-widest">内容创作平台</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.18]">让每一个创意<br /><span className="text-orange-400">成为视频作品</span></h1>
        <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-lg">用文字、图片或参考素材生成视频，编辑分镜、配音与字幕，预览成片后发布。在同一个工作台管理每次创作。</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={onGoToApp} className="inline-flex items-center gap-2 rounded-lg bg-primary hover:bg-primary/90 px-6 py-3 text-primary-foreground font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            进入创作工作台 <ArrowRight className="h-4 w-4" /></button>
          <button onClick={onScrollToPromo} className="rounded-lg border border-border px-6 py-3 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">查看创作流程</button>
        </div>
        <p className="text-sm text-white/55">生成前确认实际价格；发布前确认内容、账号和平台授权。</p>
      </div>
      <figure className="relative">
        <div className="grid grid-cols-3 gap-3 items-center">
          {['ref-28', 'ref-01', 'ref-35'].map((id, i) => {
            const item = inspirationAsset(id)!;
            return <div key={id} className={`overflow-hidden rounded-2xl bg-white/5 border border-white/10 ${i === 1 ? 'aspect-[3/5]' : 'aspect-[3/4]'}`}>
              <img src={item.src} alt={item.title} width={item.width} height={item.height} fetchPriority={i === 1 ? 'high' : 'auto'}
                className="h-full w-full object-cover" />
            </div>;
          })}
        </div>
        <figcaption className="mt-5 flex items-start gap-3 text-sm text-white/65"><Film className="h-5 w-5 text-orange-400 shrink-0" />
          <span>从人物出镜到产品展示，让构图为内容服务。<span className="block mt-1 text-xs text-white/55">静态视觉参考 · 可在下方灵感库查看提示词</span></span>
        </figcaption>
      </figure>
    </div>
  </section>;
}
