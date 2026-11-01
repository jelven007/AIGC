import { inspirationAsset } from '@/lib/inspirationAssets';

const steps = [
  ['准备资料', '描述创意，整理参考，上传已取得使用权的图片、视频或音频。'],
  ['确认生成', '编辑脚本，选择模型与规格，核对积分后提交任务。生成时间随模型与任务变化。'],
  ['预览与发布', '检查成片，完成剪辑和导出；连接平台后确认发布账号和正文。'],
  ['回看与优化', '同步官方数据，结合授权投放或交易观测，测试不同创意版本。'],
];
export default function HowItWorksSection() {
  return <section id="流程" className="border-y border-border bg-card">
    <div className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 grid lg:grid-cols-2 gap-12">
      <div className="space-y-5">
        <p className="text-sm text-orange-300">创作流程</p>
        <h2 className="text-3xl md:text-4xl font-semibold leading-tight">先确认内容，<br />再让创意进入制作</h2>
        <p className="text-white/65 leading-relaxed">从输入到剪辑，每一步都有对应记录。需要核对时，可从作品库和任务中心继续处理。</p>
        <div className="grid sm:grid-cols-2 gap-4 pt-3">
          {['ref-10', 'ref-18'].map(id => {
            const item = inspirationAsset(id)!;
            return <figure key={id}><img src={item.src} alt={item.title} width={item.width} height={item.height} loading="lazy"
              className="w-full aspect-video object-contain rounded-lg border border-white/10 bg-black/20" />
              <figcaption className="text-xs text-white/55 mt-2">{item.title} · 流程示意</figcaption></figure>;
          })}
        </div>
        <p className="text-xs text-white/55">界面图片展示创作分区，当前工具与结果请在工作台查看。</p>
      </div>
      <ol className="space-y-7">{steps.map(([title, description], index) => <li key={title} className="flex gap-5 border-t border-white/10 pt-5">
        <span className="text-orange-300 font-mono text-lg shrink-0">0{index + 1}</span>
        <div><h3 className="text-lg font-medium">{title}</h3><p className="text-sm text-white/65 mt-2 leading-relaxed">{description}</p></div>
      </li>)}</ol>
    </div>
  </section>;
}
