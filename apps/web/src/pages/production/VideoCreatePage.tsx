import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import FloatingNotice from '@/components/common/FloatingNotice';
import PlanGate from '@/components/PlanGate';
import ScriptPage from './ScriptPage';
import WorksPage from './WorksPage';
import BatchCreatePage from './BatchCreatePage';

/** 首页分镜入口复用实际业务组件，避免旧向导单独上传、计费和合成。 */
export default function VideoCreatePage() {
  const { user } = useAuth();
  const [view, setView] = useState<'script' | 'materials' | 'render'>('script');
  const [legacy] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`video-create-draft-${user?.id}`) || 'null');
      return saved?.productData && typeof saved.productData.name === 'string' && saved.productData.name.trim() ? saved : null;
    } catch { return null; }
  });
  return <div className="rounded-2xl border border-border bg-background text-foreground p-3 md:p-5 space-y-4 shadow-xl">
    <div className="rounded-xl border bg-card text-card-foreground p-4 md:p-5 space-y-3">
      <h2 className="text-lg font-semibold">分镜与成片工作台</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">编辑分镜、画面与台词，结合素材和配音完成视频制作。商品资料可用于辅助脚本创作。</p>
      <div className="flex gap-2 flex-wrap">
        <Button variant={view === 'script' ? 'default' : 'outline'} onClick={() => setView('script')}>分镜脚本</Button>
        <Button variant={view === 'materials' ? 'default' : 'outline'} onClick={() => setView('materials')}>素材与作品</Button>
        <Button variant={view === 'render' ? 'default' : 'outline'} onClick={() => setView('render')}>多镜头成片</Button>
        <Button variant="outline" asChild><Link to="/video/edit">手动剪辑素材</Link></Button>
        <Button variant="outline" asChild><Link to="/products">商品资料</Link></Button>
      </div>
      {legacy && <FloatingNotice id={`legacy-video-draft-${user?.id}`}
        title={`检测到旧向导草稿：${legacy.productData.name}`} duration={Infinity}>
        <p>原草稿保留，可转入脚本编辑继续创作。</p>
        <Button size="sm" asChild><Link to="/script" state={{
          productName: legacy.productData.name, category: legacy.productData.category,
          sellingPoints: legacy.productData.ai_selling_points?.length ? legacy.productData.ai_selling_points
            : typeof legacy.productData.selling_points === 'string' ? [legacy.productData.selling_points].filter(Boolean) : [],
        }}>继续旧商品草稿</Link></Button>
      </FloatingNotice>}
    </div>
    <div hidden={view !== 'script'}><ScriptPage active={view === 'script'} /></div>
    {view === 'materials' && <WorksPage />}
    {view === 'render' && <PlanGate requiredPlan="pro" featureName="多镜头配音与合成"><BatchCreatePage /></PlanGate>}
  </div>;
}
