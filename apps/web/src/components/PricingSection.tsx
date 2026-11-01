import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { marketingDestination } from '@/lib/inspirationAssets';

export default function PricingSection() {
  const { user } = useAuth();
  return <section id="套餐" className="border-y border-white/10 bg-card">
    <div className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 grid md:grid-cols-2 gap-10">
      <div className="space-y-5"><p className="text-sm text-orange-300">套餐与积分</p>
        <h2 className="text-3xl md:text-4xl font-semibold">按你的创作需要，<br />选择套餐与权益</h2>
        <p className="text-white/65 leading-relaxed">登录后查看当前可购买套餐、积分和权益。下单前显示实际金额，提交生成任务前显示积分费用。</p>
        <Link to={marketingDestination('/credits?tab=plans', !!user)} className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg px-6 py-3">
          查看套餐与权益 <ArrowRight className="h-4 w-4" /></Link>
      </div>
      <div className="border border-white/15 rounded-xl p-6 md:p-8">
        <h3 className="text-xl font-medium mb-6">确认费用，再开始制作</h3>
        <ul className="space-y-5">{[
          ['套餐目录', '以账号中当前开放的套餐、价格及权益为准。'],
          ['任务费用', '模型、时长与规格决定积分，确认后提交。'],
          ['订单与记录', '在积分和订单页面核对购买记录与到账状态。'],
        ].map(([title, text]) => <li key={title} className="flex gap-3"><Check className="w-5 h-5 text-orange-300 shrink-0" />
          <div><p className="font-medium">{title}</p><p className="text-sm text-white/65 leading-relaxed mt-1">{text}</p></div></li>)}</ul>
      </div>
    </div>
  </section>;
}
