import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { inspirationAsset, marketingDestination } from '@/lib/inspirationAssets';

const personas = [
  { title: '个人创作者', text: '从一个主题开始，整理脚本、人物出镜和配音，逐步形成自己的内容风格。', image: 'ref-08', cover: 'ref-19', path: '/video/create?inspiration=ref-08' },
  { title: '商品与品牌团队', text: '整理产品事实与使用场景，用分镜和商品特写讲清特点，制作不同创意版本。', image: 'ref-09', cover: 'ref-24', path: '/video/create?inspiration=ref-09' },
  { title: '内容机构', text: '围绕同一份创作资料协作，分工处理脚本、剪辑和发布，按任务记录核对进展。', image: 'ref-02', cover: 'ref-25', path: '/video/create?inspiration=ref-02' },
];
/** 保留旧三栏用户模块的职责，以可核对的使用场景替代固定客户评价。 */
export default function TestimonialSection() {
  const { user } = useAuth();
  return <section id="场景" className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24">
    <div className="space-y-3 mb-10"><p className="text-sm text-orange-300">为不同创作方式而设计</p>
      <h2 className="text-3xl md:text-4xl font-semibold">一个工作台，多种创作场景</h2>
      <p className="text-white/65">以下为使用场景与视觉示意。</p></div>
    <div className="grid md:grid-cols-3 gap-8">{personas.map(persona => {
      const image = inspirationAsset(persona.image)!, cover = inspirationAsset(persona.cover)!;
      return <article key={persona.title} className="space-y-4 min-w-0">
        <div className="relative pb-5 pr-5">
          <img src={image.src} alt={image.title} width={image.width} height={image.height} loading="lazy" className="w-full aspect-[3/2] object-cover rounded-xl" />
          <img src={cover.src} alt={cover.title} width={cover.width} height={cover.height} loading="lazy"
            className="absolute bottom-0 right-0 w-2/5 aspect-video object-cover rounded-lg border-4 border-background" />
        </div>
        <h3 className="text-xl font-semibold">{persona.title}</h3><p className="text-sm text-white/65 leading-relaxed">{persona.text}</p>
        <Link to={marketingDestination(persona.path, !!user)} className="inline-flex items-center gap-2 text-sm text-orange-300 hover:underline">
          从这个场景开始 <ArrowRight className="w-4 h-4" /></Link>
      </article>;
    })}</div>
  </section>;
}
