import { Images, Layers, ShieldCheck } from 'lucide-react';
import { inspirationAssets, inspirationCategories } from '@/lib/inspirationAssets';

const facts = [
  { Icon: Images, value: String(inspirationAssets.length), label: '个视觉参考', text: '浏览场景与构图，预览后选取提示词。' },
  { Icon: Layers, value: String(inspirationCategories.length), label: '类创作方向', text: '从功能灵感到人物出镜，按需要筛选。' },
  { Icon: ShieldCheck, value: '你的账号', label: '管理实际创作', text: '作品与素材按权限访问，团队协作保留记录。' },
];
export default function StatsSection() {
  return <section aria-label="参考库与创作管理" className="max-w-7xl mx-auto px-5 md:px-8 py-12">
    <div className="grid md:grid-cols-3 gap-8">{facts.map(item => <article key={item.label} className="flex gap-4 items-start">
      <item.Icon className="h-6 w-6 shrink-0 text-orange-300 mt-2" />
      <div><p className="text-3xl font-semibold">{item.value}</p><h2 className="text-sm font-medium mt-2">{item.label}</h2>
        <p className="text-sm text-white/65 mt-3 leading-relaxed">{item.text}</p></div>
    </article>)}</div>
  </section>;
}
