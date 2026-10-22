import { ArrowRight, BarChart3, Film, Package, Scissors, Sparkles } from 'lucide-react';

interface LandingHeroProps { onGoToApp: () => void; onScrollToPromo?: () => void }
const stages = [
  { title: '商品与素材', description: '整理商品事实与已授权媒体', Icon: Package },
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
        <p className="text-sm text-orange-300 tracking-widest">电商 AIGC · 内容工作台</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.18]">让商品内容<br /><span className="text-orange-400">走进创作流程</span></h1>
        <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-lg">从商品资料、脚本和视频生成，到音频剪辑、平台发布与数据回流，在同一个工作台管理每次创作。</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={onGoToApp} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-400 px-6 py-3 text-black font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300">
            进入创作工作台 <ArrowRight className="h-4 w-4" /></button>
          <button onClick={onScrollToPromo} className="rounded-xl border border-white/25 px-6 py-3 hover:bg-white/5 text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
            查看创作流程</button>
        </div>
        <p className="text-sm text-white/50">生成前确认实际价格；发布前确认内容、账号和平台授权。</p>
      </div>
      <div className="border border-white/15 rounded-2xl bg-[#11151c] overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><Film className="h-4 w-4 text-orange-400" /><p className="text-sm font-medium">一次创作的完整流程</p></div>
        <ol className="p-5 md:p-7 space-y-6">{stages.map((stage, index) => <li key={stage.title} className="flex gap-4 items-start">
          <span className="flex items-center justify-center border border-white/15 rounded-xl h-11 w-11 shrink-0 text-emerald-300"><stage.Icon className="h-5 w-5" /></span>
          <div className="min-w-0"><p className="text-xs text-white/45 mb-1">0{index + 1}</p><h2 className="font-medium">{stage.title}</h2><p className="text-sm text-white/60 mt-1">{stage.description}</p></div>
        </li>)}</ol>
        <div className="border-t border-white/10 px-5 py-4 text-sm text-white/60">任务、作品与结果保存在账号中，方便继续处理。</div>
      </div>
    </div>
  </section>;
}
