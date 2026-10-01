import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Video, Plus, Upload, TrendingUp, Clock, CheckCircle2,
  ImageIcon, Sparkles, ArrowRight, BarChart3,
  Wand2, Copy, BookOpen, Package, Calculator,
} from 'lucide-react';
import type { DashboardStats, VideoProject } from '@/types/types';
import { cn } from '@/lib/utils';

const statusConfig = {
  draft: { label: '草稿', color: 'bg-muted/80 text-muted-foreground' },
  processing: { label: '生成中', color: 'bg-warning/15 text-warning' },
  completed: { label: '已完成', color: 'bg-success/15 text-success' },
  failed: { label: '失败', color: 'bg-destructive/15 text-destructive' },
};

// ── 统计卡片 ──────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, title, value, desc, gradient, loading }: {
  icon: typeof Video;
  title: string;
  value: number | string;
  desc: string;
  gradient: string;
  loading: boolean;
}) {
  return (
    <div className={cn(
      'relative rounded-2xl p-5 flex flex-col gap-3 overflow-hidden h-full',
      gradient,
    )}>
      {/* 背景装饰圆 */}
      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />
      <div className="absolute -bottom-6 -left-4 w-16 h-16 rounded-full bg-white/5 pointer-events-none" />

      <div className="relative flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>
        <span className="text-xs font-medium text-white/70 bg-white/10 px-2 py-0.5 rounded-full">{desc}</span>
      </div>

      <div className="relative">
        {loading
          ? <Skeleton className="h-9 w-14 bg-white/20 rounded-lg" />
          : <p className="text-3xl font-bold text-white leading-none">{value}</p>
        }
        <p className="text-sm text-white/80 mt-1.5 font-medium">{title}</p>
      </div>
    </div>
  );
}

// ── 快捷操作卡片 ──────────────────────────────────────────────────────────
function QuickAction({ icon: Icon, title, desc, to, accent, tag }: {
  icon: typeof Video;
  title: string;
  desc: string;
  to: string;
  accent: string;  // Tailwind color classes for the icon bg + icon color
  tag?: string;
}) {
  return (
    <Link to={to} className="group block h-full">
      <div className="h-full rounded-2xl border border-border/70 bg-card p-4 flex items-center gap-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-border">
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110', accent)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-foreground text-balance">{title}</p>
            {tag && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">
                {tag}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 text-pretty">{desc}</p>
        </div>
        <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </Link>
  );
}

// ── 近期项目行 ────────────────────────────────────────────────────────────
function VideoRow({ project }: { project: VideoProject }) {
  const cfg = statusConfig[project.status];
  const date = new Date(project.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors group cursor-default">
      <div className="w-14 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden border border-border/50">
        {project.thumbnail_url
          ? <img src={project.thumbnail_url} alt={project.title} className="w-full h-full object-cover" />
          : <Video className="w-4 h-4 text-muted-foreground/50" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors">
          {project.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{date}</p>
      </div>
      <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border-0 shrink-0', cfg.color)}>
        {cfg.label}
      </span>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    total_videos: 0, processing_videos: 0, completed_videos: 0, total_materials: 0,
  });
  const [recentProjects, setRecentProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projRes, matRes] = await Promise.all([
        supabase.from('video_projects').select('id,status,created_at').order('created_at', { ascending: false }),
        supabase.from('materials').select('id', { count: 'exact', head: true }),
      ]);
      const projects = projRes.data ?? [];
      setStats({
        total_videos: projects.length,
        processing_videos: projects.filter(p => p.status === 'processing').length,
        completed_videos: projects.filter(p => p.status === 'completed').length,
        total_materials: matRes.count ?? 0,
      });
      const recentRes = await supabase
        .from('video_projects').select('*')
        .order('created_at', { ascending: false }).limit(5);
      setRecentProjects((recentRes.data ?? []) as VideoProject[]);
    } finally {
      setLoading(false);
    }
  };

  const username = profile?.username ?? '用户';

  const statCards = [
    {
      icon: Video, title: '总视频数', value: stats.total_videos,
      desc: '累计生成',
      gradient: 'bg-gradient-to-br from-primary via-primary/90 to-primary/70',
    },
    {
      icon: Clock, title: '生成中', value: stats.processing_videos,
      desc: '正在处理',
      gradient: 'bg-gradient-to-br from-warning via-warning/90 to-amber-400',
    },
    {
      icon: CheckCircle2, title: '已完成', value: stats.completed_videos,
      desc: '可预览下载',
      gradient: 'bg-gradient-to-br from-success via-emerald-500 to-teal-500',
    },
    {
      icon: ImageIcon, title: '素材数量', value: stats.total_materials,
      desc: '已上传',
      gradient: 'bg-gradient-to-br from-info via-blue-500 to-indigo-500',
    },
  ];

  const quickActions = [
    {
      icon: Video, title: '生成视频', to: '/video/create',
      desc: 'AI全流程辅助，从商品到视频一键搞定',
      accent: 'bg-primary/15 text-primary', tag: '核心',
    },
    {
      icon: Wand2, title: 'AI脚本生成', to: '/script',
      desc: '输入商品信息，自动输出分镜脚本与Prompt',
      accent: 'bg-violet-500/15 text-violet-500', tag: 'AI',
    },
    {
      icon: Upload, title: '上传素材', to: '/works',
      desc: '管理商品图片和视频片段',
      accent: 'bg-success/15 text-success',
    },
    {
      icon: Package, title: '商品管理', to: '/products',
      desc: '管理带货商品信息，快速选品',
      accent: 'bg-orange-500/15 text-orange-500',
    },
    {
      icon: Copy, title: '爆款风格复刻', to: '/style-copy',
      desc: 'AI分析爆款视频，提取并复制风格',
      accent: 'bg-pink-500/15 text-pink-500', tag: 'AI',
    },
    {
      icon: TrendingUp, title: '流量分析', to: '/analytics',
      desc: '预测完播率和点击率，优化视频效果',
      accent: 'bg-info/15 text-info',
    },
    {
      icon: BookOpen, title: '知识库', to: '/knowledge',
      desc: '收集优化行为，驱动AI持续进化',
      accent: 'bg-teal-500/15 text-teal-500', tag: 'AI',
    },
    {
      icon: BarChart3, title: '查看作品', to: '/works',
      desc: '管理已生成的历史视频',
      accent: 'bg-muted-foreground/15 text-muted-foreground',
    },
  ];

  // 商业化 ROI 估算器状态
  const [roiParams, setRoiParams] = useState({
    cost: 50,      // 单个视频制作成本（包含人力、算力等）
    views: 10000,  // 预估播放量
    cr: 1.5,       // 转化率 %
    aov: 99,       // 客单价
  });

  const roiCalculated = {
    revenue: (roiParams.views * (roiParams.cr / 100)) * roiParams.aov,
    profit: ((roiParams.views * (roiParams.cr / 100)) * roiParams.aov) - roiParams.cost,
    roi: roiParams.cost > 0 ? (((roiParams.views * (roiParams.cr / 100)) * roiParams.aov) / roiParams.cost).toFixed(2) : 0,
  };

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* ── 欢迎横幅 ── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700">
        {/* 装饰网格 */}
        <div className="absolute inset-0 pointer-events-none opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        {/* 光晕 */}
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-pink-400/15 blur-3xl pointer-events-none" />
        {/* 装饰粒子 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-6 right-1/3 w-2 h-2 rounded-full bg-white/25 animate-pulse" />
          <div className="absolute bottom-8 right-20 w-1.5 h-1.5 rounded-full bg-white/35 animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-10 left-1/2 w-1 h-1 rounded-full bg-white/20 animate-pulse" style={{ animationDelay: '0.5s' }} />
        </div>

        <div className="relative z-10 px-5 py-6 md:px-8 md:py-7 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-white/80 bg-white/15 backdrop-blur-sm px-2.5 py-1 rounded-full tracking-wide border border-white/10">
                电商AIGC带货视频
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white text-balance leading-snug">
              你好，{username} 👋
            </h1>
            <p className="text-sm text-white/80 mt-1.5 text-pretty">
              今天要生成什么带货视频？让 AI 帮你轻松搞定高转化内容
            </p>
          </div>
          <div className="hidden md:flex flex-col gap-2 shrink-0">
            <Button
              onClick={() => navigate('/video/create')}
              variant="ghost"
              className="bg-white/95 text-indigo-700 hover:bg-white hover:scale-105 active:scale-95 transition-all font-semibold shadow-lg shadow-indigo-900/20 border-0 h-10"
            >
              <Plus className="w-4 h-4 mr-1.5" />新建视频
            </Button>
            <Button
              onClick={() => navigate('/video/create')}
              variant="ghost"
              className="border border-white/40 text-white hover:bg-white/15 hover:-translate-y-0.5 active:scale-95 transition-all font-medium h-9 text-sm backdrop-blur-sm"
            >
              <Wand2 className="w-4 h-4 mr-1.5" />AI脚本生成
            </Button>
          </div>
        </div>
      </div>

      {/* ── 统计卡片 ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard key={card.title} {...card} loading={loading} />
        ))}
      </div>

      {/* ── 快捷操作 2×4 网格 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-foreground text-balance">快速入口</h2>
          <span className="text-xs text-muted-foreground">全部功能模块</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map(a => (
            <QuickAction key={a.title} {...a} />
          ))}
        </div>
      </div>

      {/* ── 最近项目 + ROI估算器 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* 最近项目（占2列） */}
        <div className="md:col-span-2 rounded-2xl border border-border/70 bg-card overflow-hidden flex flex-col h-full">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-primary/15 flex items-center justify-center">
                <Video className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="font-semibold text-sm text-balance">最近项目</h2>
            </div>
            <Link to="/works">
              <Button variant="ghost" size="sm"
                className="text-xs text-muted-foreground hover:text-primary h-7 px-2 gap-1">
                查看全部 <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>

          <div className="flex-1 p-3">
            {loading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-muted rounded-xl" />
                ))}
              </div>
            ) : recentProjects.length > 0 ? (
              <div className="space-y-0.5">
                {recentProjects.map(p => <VideoRow key={p.id} project={p} />)}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
                  <Video className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <p className="font-medium text-muted-foreground text-sm">还没有视频项目</p>
                <Button size="sm" className="mt-1 h-8 text-xs" onClick={() => navigate('/video/create')}>
                  <Plus className="w-3.5 h-3.5 mr-1" />立即创建
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 商业化 ROI 估算器 */}
        <Card className="rounded-2xl border border-border/70 bg-card overflow-hidden shadow-sm h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" />
              商业化ROI估算器
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">单个视频成本(元)</Label>
                <Input type="number" value={roiParams.cost} onChange={e => setRoiParams({ ...roiParams, cost: Number(e.target.value) })} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">预估播放量</Label>
                <Input type="number" value={roiParams.views} onChange={e => setRoiParams({ ...roiParams, views: Number(e.target.value) })} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">转化率(%)</Label>
                <Input type="number" value={roiParams.cr} onChange={e => setRoiParams({ ...roiParams, cr: Number(e.target.value) })} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">客单价(元)</Label>
                <Input type="number" value={roiParams.aov} onChange={e => setRoiParams({ ...roiParams, aov: Number(e.target.value) })} className="h-8 text-sm" />
              </div>
            </div>

            <div className="bg-muted/40 rounded-xl p-4 mt-2 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">预估转化收入:</span>
                <span className="font-semibold">¥{roiCalculated.revenue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">预估净利润:</span>
                <span className={cn("font-bold", roiCalculated.profit >= 0 ? "text-success" : "text-destructive")}>
                  ¥{roiCalculated.profit.toFixed(2)}
                </span>
              </div>
              <div className="pt-2 border-t border-border/50 flex justify-between items-center">
                <span className="font-medium">投产比 (ROI):</span>
                <span className={cn("text-xl font-bold", Number(roiCalculated.roi) > 1 ? "text-primary" : "text-warning")}>
                  {roiCalculated.roi}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 底部间距 ── */}
      <div className="h-2" />

    </div>
  );
}
