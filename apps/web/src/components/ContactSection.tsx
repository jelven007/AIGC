import { Link } from 'react-router-dom';
import { ArrowRight, LifeBuoy } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { marketingDestination } from '@/lib/inspirationAssets';

const questions = [
  ['如何开始创作？', '选择参考思路或直接进入工作台，补充主题与已授权素材，确认模型、规格和积分后提交。'],
  ['参考图能直接成为作品吗？', '参考图库提供静态构图和文字思路。创作时使用自己的素材，作品库展示实际上传和生成记录。'],
  ['任务或订单遇到问题怎么办？', '在任务中心或订单记录核对状态，登录后提交支持工单，附上任务或订单编号与问题说明。'],
];
export default function ContactSection() {
  const { user } = useAuth();
  return <section id="支持" className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 grid lg:grid-cols-2 gap-12">
    <div className="space-y-5">
      <LifeBuoy className="h-8 w-8 text-orange-300" /><p className="text-sm text-orange-300">帮助与支持</p>
      <h2 className="text-3xl md:text-4xl font-semibold">让创作继续向前</h2>
      <p className="text-white/65 max-w-lg leading-relaxed">遇到任务、素材或订单问题，可以通过支持中心提交工单，并在账号中跟进处理记录。</p>
      <Link to={marketingDestination('/support', !!user)} className="inline-flex items-center gap-2 border border-orange-400/50 text-orange-300 rounded-lg px-5 py-3 hover:bg-orange-400/10">
        提交支持工单 <ArrowRight className="h-4 w-4" /></Link>
    </div>
    <div className="divide-y divide-white/15 border-y border-white/15">
      {questions.map(([title, text]) => <details key={title} className="group py-5">
        <summary className="cursor-pointer font-medium leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{title}</summary>
        <p className="text-sm text-white/65 leading-relaxed mt-4">{text}</p>
      </details>)}
    </div>
  </section>;
}
