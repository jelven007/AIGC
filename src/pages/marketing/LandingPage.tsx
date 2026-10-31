import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, AudioLines, BarChart3, BookOpen, Film, ImageIcon, Package, Scissors, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import LandingHero from '@/components/LandingHero';

const tools = [
  { title: 'AI 视频生成', description: '通过文字、图片或参考素材生成视频，选择模型与画幅，查看任务进度和成片。', path: '/video/create', Icon: Film },
  { title: '分镜与创作资料', description: '生成和编辑分镜脚本，调整画面、台词与时长；商品资料可辅助产品展示视频创作。', path: '/script', Icon: Package },
  { title: '音频与数字人', description: '使用授权声音和人物素材，创建配音、转写、照片口播或口型同步任务。', path: '/avatars', Icon: AudioLines },
  { title: '剪辑与素材库', description: '上传私有媒体，编辑音轨、字幕和转场，预览后导出多种画幅。', path: '/works', Icon: Scissors },
  { title: '知识与团队协作', description: '保存创作资料，通过检索复用内容，在授权范围内共享团队素材。', path: '/knowledge', Icon: BookOpen },
  { title: '发布与效果验证', description: '连接发布账号，查看官方视频指标，使用授权观测开展对照实验。', path: '/analytics', Icon: BarChart3 },
];
export default function LandingPage() {
  const { user } = useAuth(), navigate = useNavigate();
  const enter = () => navigate(user ? '/home' : '/login');
  return <div className="dark min-h-screen text-foreground bg-background">
    <a href="#landing-content" className="sr-only focus:not-sr-only focus:block p-3 text-orange-300">跳到主要内容</a>
    <header className="border-b border-white/10">
      <nav aria-label="网站导航" className="max-w-7xl mx-auto px-5 md:px-8 py-4 flex flex-wrap gap-4 items-center justify-between">
        <Link to="/" className="font-semibold inline-flex gap-2 items-center"><Film className="h-5 w-5 text-orange-400" />视频生成平台</Link>
        <div className="flex flex-wrap gap-4 items-center text-sm">
          <a href="#功能" className="text-white/70 hover:text-white">功能</a><a href="#流程" className="text-white/70 hover:text-white">创作流程</a>
          <a href="#套餐" className="text-white/70 hover:text-white">套餐</a>
          <button onClick={enter} className="border border-orange-400/50 rounded-lg px-4 py-2 text-orange-300 hover:bg-orange-400/10">{user ? '进入工作台' : '登录 / 注册'}</button>
        </div>
      </nav>
    </header>
    <main id="landing-content">
      <LandingHero onGoToApp={enter} onScrollToPromo={() => document.getElementById('流程')?.scrollIntoView({ behavior: 'auto' })} />
      <section id="功能" className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 space-y-10">
        <div className="space-y-3"><p className="text-sm text-primary">从创意到成片</p><h2 className="text-3xl md:text-4xl font-semibold">围绕视频创作，连接每一步</h2>
          <p className="text-white/60 max-w-2xl leading-relaxed">按创作需要选择工具。模型能力、平台权限和任务状态会在工作台中显示。</p></div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">{tools.map(tool => <article key={tool.title} className="border-t border-white/15 pt-6 space-y-4">
          <tool.Icon className="h-6 w-6 text-orange-300" /><h3 className="font-medium text-xl">{tool.title}</h3><p className="text-sm text-white/65 leading-relaxed">{tool.description}</p>
          <Link to={user ? tool.path : '/login'} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">打开工具 <ArrowRight className="h-4 w-4" /></Link>
        </article>)}</div>
      </section>
      <section id="流程" className="border-y border-border bg-card">
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 grid lg:grid-cols-2 gap-10">
          <div className="space-y-4"><p className="text-sm text-orange-300">创作流程</p><h2 className="text-3xl md:text-4xl font-semibold leading-tight">先确认内容，<br />再让创意进入制作</h2>
            <p className="text-white/60 leading-relaxed">每次生成、导出和发布都有对应记录。需要核对时，可从作品库和任务中心继续处理。</p></div>
          <ol className="space-y-6">{[
            ['准备资料', '描述视频创意，整理参考资料，上传已取得使用权的图片、视频或音频。'],
            ['确认生成', '编辑脚本，选择模型与规格，核对积分后提交任务。生成时间随模型与任务变化。'],
            ['预览与发布', '检查实际成片，完成剪辑和导出；连接平台后确认发布账号和正文。'],
            ['回看与优化', '同步官方数据，结合授权投放或交易观测，测试不同创意版本。'],
          ].map(([title, text], index) => <li key={title} className="flex gap-5"><span className="text-orange-300 font-mono shrink-0 pt-1">0{index + 1}</span>
            <div><h3 className="text-lg font-medium">{title}</h3><p className="text-sm text-white/65 mt-2 leading-relaxed">{text}</p></div></li>)}</ol>
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-5 md:px-8 py-16 grid md:grid-cols-3 gap-8">
        {[{ Icon: ShieldCheck, title: '按权限访问', text: '作品与素材归属账号，团队共享由成员角色和授权范围控制。' },
          { Icon: ImageIcon, title: '查看真实结果', text: '作品来自实际任务与上传记录，指标缺失时保留未知状态。' },
          { Icon: Users, title: '按记录协作', text: '在作品、任务和发布记录中核对进展，复用已有资料继续创作。' }].map(item => <article key={item.title} className="space-y-3">
            <item.Icon className="h-5 w-5 text-primary" /><h2 className="text-lg font-medium">{item.title}</h2><p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
          </article>)}
      </section>
      <section id="套餐" className="border-t border-white/10 max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 space-y-5">
        <p className="text-sm text-orange-300">套餐与积分</p><h2 className="text-3xl font-semibold">根据创作需要选择套餐</h2>
        <p className="text-white/65 max-w-2xl leading-relaxed">登录后查看当前可购买套餐、积分和权益。下单前会显示实际金额，提交生成任务前会显示积分费用。</p>
        <Link to={user ? '/credits?tab=plans' : `/login?mode=login&redirect=${encodeURIComponent('/credits?tab=plans')}`} className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg px-6 py-3">
          查看套餐与权益 <ArrowRight className="h-4 w-4" /></Link>
      </section>
    </main>
    <footer className="border-t border-white/10"><div className="max-w-7xl mx-auto px-5 md:px-8 py-8 flex flex-wrap justify-between gap-4 text-sm text-white/50">
      <span>视频生成平台</span><Link to={user ? '/support' : '/login'} className="hover:text-white">帮助与支持</Link>
    </div></footer>
  </div>;
}
