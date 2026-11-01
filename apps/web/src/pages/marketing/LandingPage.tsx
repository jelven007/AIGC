import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Film } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import LandingHero from '@/components/LandingHero';
import HowItWorksSection from '@/components/HowItWorksSection';
import StatsSection from '@/components/StatsSection';
import TestimonialSection from '@/components/TestimonialSection';
import PricingSection from '@/components/PricingSection';
import ContactSection from '@/components/ContactSection';
import InspirationGallery from '@/components/InspirationGallery';
import { inspirationAsset, marketingDestination } from '@/lib/inspirationAssets';

const tools = [
  { title: '爆款风格复刻', description: '分析授权参考视频，提取镜头、节奏、配色和字幕建议，再围绕自己的主题创作。', path: '/style-copy', image: 'ref-04' },
  { title: 'AI 分镜脚本', description: '生成和编辑分镜，调整画面、台词与时长，把创意整理成可制作的脚本。', path: '/script', image: 'ref-05' },
  { title: '音频与数字人', description: '使用授权声音和人物素材，创建配音、转写、照片口播或口型同步任务。', path: '/avatars', image: 'ref-06' },
  { title: '分镜模板与素材', description: '按创作场景选择可用模板，补充自己的主题与素材，继续生成和剪辑。', path: '/templates', image: 'ref-11' },
  { title: '知识与团队协作', description: '保存创作资料，通过检索复用内容，在授权范围内共享团队素材。', path: '/knowledge', image: 'ref-03' },
  { title: '作品表现分析', description: '查看官方视频指标，结合授权观测开展对照实验，按实际数据调整创意。', path: '/analytics', image: 'ref-07' },
];
export default function LandingPage() {
  const { user } = useAuth(), navigate = useNavigate();
  const enter = () => navigate(user ? '/home' : '/login');
  return <div className="dark min-h-screen text-foreground bg-background">
    <a href="#landing-content" className="sr-only focus:not-sr-only focus:block p-3 text-orange-300">跳到主要内容</a>
    <header className="border-b border-white/10">
      <nav aria-label="网站导航" className="max-w-7xl mx-auto px-5 md:px-8 py-4 flex flex-wrap gap-4 items-center justify-between">
        <Link to="/" className="font-semibold inline-flex gap-2 items-center"><Film className="h-5 w-5 text-orange-400" />内容创作平台</Link>
        <div className="flex flex-wrap gap-4 items-center text-sm">
          <a href="#功能" className="text-white/70 hover:text-white">功能</a><a href="#流程" className="text-white/70 hover:text-white">创作流程</a>
          <a href="#灵感" className="text-white/70 hover:text-white">灵感</a><a href="#套餐" className="text-white/70 hover:text-white">套餐</a>
          <button onClick={enter} className="border border-orange-400/50 rounded-lg px-4 py-2 text-orange-300 hover:bg-orange-400/10">{user ? '进入工作台' : '登录 / 注册'}</button>
        </div>
      </nav>
    </header>
    <main id="landing-content">
      <LandingHero onGoToApp={enter} onScrollToPromo={() => document.getElementById('流程')?.scrollIntoView({ behavior: 'auto' })} />
      <StatsSection />
      <section id="功能" className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 space-y-10">
        <div className="space-y-3"><p className="text-sm text-primary">从创意到成片</p><h2 className="text-3xl md:text-4xl font-semibold">围绕视频创作，连接每一步</h2>
          <p className="text-white/60 max-w-2xl leading-relaxed">按创作需要选择工具。模型能力、平台权限和任务状态会在工作台中显示。</p></div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">{tools.map(tool => {
          const image = inspirationAsset(tool.image)!;
          return <article key={tool.title} className="border-t border-white/15 pt-6 space-y-4">
          <figure><img src={image.src} alt={image.title} width={image.width} height={image.height} loading="lazy"
            className="w-full aspect-[16/9] object-contain rounded-lg bg-white/5" /><figcaption className="sr-only">功能视觉示意</figcaption></figure>
          <h3 className="font-medium text-xl">{tool.title}</h3><p className="text-sm text-white/65 leading-relaxed">{tool.description}</p>
          <Link to={user ? tool.path : '/login?mode=login'} className="inline-flex items-center gap-2 text-sm text-orange-300 hover:underline">打开工具 <ArrowRight className="h-4 w-4" /></Link>
        </article>;
        })}</div>
        <p className="text-xs text-white/55">图片用于功能构图示意；工具能力、模板和数据以账号中实际开放的内容为准。</p>
      </section>
      <HowItWorksSection />
      <TestimonialSection />
      <InspirationGallery />
      <PricingSection />
      <ContactSection />
    </main>
    <footer className="border-t border-white/10"><div className="max-w-7xl mx-auto px-5 md:px-8 py-8 flex flex-wrap justify-between gap-4 text-sm text-white/50">
      <span>内容创作平台</span><Link to={marketingDestination('/support', !!user)} className="hover:text-white">帮助与支持</Link>
    </div></footer>
  </div>;
}
