import { ArrowRight, BarChart3, Film, Package, Scissors, Sparkles } from 'lucide-react';

interface LandingHeroProps { onGoToApp: () => void; onScrollToPromo?: () => void }
const stages = [
  { title: '创意与素材', description: '整理创作资料与已授权媒体', Icon: Package },
  { title: '脚本与生成', description: '确认模型、参数和积分', Icon: Sparkles },
  { title: '剪辑与发布', description: '预览成片后选择发布账号', Icon: Scissors },
  { title: '数据与实验', description: '用实际发布观测验证创意', Icon: BarChart3 },
];
export default function LandingHero({ onGoToApp, onScrollToPromo }: LandingHeroProps) {
  return <section className="relative border-b border-white/10 overflow-hidden">
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none"
      style={{ background: 'radial-gradient(ellipse at 20% 30%, rgba(255,107,0,.13), transparent 65%)' }} />
    <div className="relative max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-28 grid lg:grid-cols-2 gap-14 items-center">
      <div className="space-y-7">
        <p className="text-sm text-orange-300 tracking-widest">视频生成平台</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.18]">让每一个创意<br /><span className="text-orange-400">成为视频作品</span></h1>
        <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-lg">用文字、图片或参考素材生成视频，编辑分镜、配音与字幕，预览成片后发布。在同一个工作台管理每次创作。</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={onGoToApp} className="inline-flex items-center gap-2 rounded-lg bg-primary hover:bg-primary/90 px-6 py-3 text-primary-foreground font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            进入创作工作台 <ArrowRight className="h-4 w-4" /></button>
          <button onClick={onScrollToPromo} className="rounded-lg border border-border px-6 py-3 hover:bg-accent text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
            查看创作流程</button>
        </div>
        <p className="text-sm text-white/50">生成前确认实际价格；发布前确认内容、账号和平台授权。</p>
      </div>
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><Film className="h-4 w-4 text-orange-400" /><p className="text-sm font-medium">一次创作的完整流程</p></div>
        <ol className="p-5 md:p-7 space-y-6">{stages.map((stage, index) => <li key={stage.title} className="flex gap-4 items-start">
          <span className="flex items-center justify-center border border-border rounded-lg h-11 w-11 shrink-0 text-primary"><stage.Icon className="h-5 w-5" /></span>
          <div className="min-w-0"><p className="text-xs text-white/45 mb-1">0{index + 1}</p><h2 className="font-medium">{stage.title}</h2><p className="text-sm text-white/60 mt-1">{stage.description}</p></div>
        </li>)}</ol>
        <div className="border-t border-white/10 px-5 py-4 text-sm text-white/60">任务、作品与结果保存在账号中，方便继续处理。</div>
      </div>
    </div>
  </section>;
}
