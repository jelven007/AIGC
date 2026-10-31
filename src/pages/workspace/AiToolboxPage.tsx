import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy, BarChart3, BookOpen, Globe, Scissors,
  Wand2, Heart, ImageIcon,
  ArrowRight, Sparkles, Zap, Search,
  FileText, Languages, Users, ShoppingBag,
  Cpu, Megaphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── 工具数据 ──────────────────────────────────────────────────────────────
const AI_TOOLS = [
  {
    id: 'knowledge',
    path: '/knowledge',
    label: 'Prompt知识库',
    desc: '收藏脚本和提示词，搜索并复用到下一次创作',
    icon: BookOpen,
    from: '#10b981', to: '#84cc16',
    shadow: 'rgba(16,185,129,0.45)',
    badge: 'Prompt',
    badgeFrom: '#10b981', badgeTo: '#84cc16',
    category: '知识管理',
  },
  {
    id: 'ai-script',
    path: '/script',
    label: '商品带货脚本',
    desc: '填写商品信息，生成并编辑画面、台词和分镜',
    icon: FileText,
    from: '#ec4899', to: '#8b5cf6',
    shadow: 'rgba(236,72,153,0.45)',
    badge: '脚本',
    badgeFrom: '#ec4899', badgeTo: '#8b5cf6',
    category: '内容创作',
  },
  {
    id: 'style-copy',
    path: '/style-copy',
    label: '爆款风格复刻',
    desc: '上传参考视频，分析画面和声音风格，获取脚本建议',
    icon: Copy,
    from: '#f43f5e', to: '#ec4899',
    shadow: 'rgba(244,63,94,0.45)',
    badge: '分析',
    badgeFrom: '#f43f5e', badgeTo: '#ec4899',
    category: '内容创作',
  },
  {
    id: 'live-highlight',
    path: '/live-highlight',
    label: '直播高光切片',
    desc: '上传直播录像，挑选精彩片段并继续剪辑',
    icon: Scissors,
    from: '#ef4444', to: '#f97316',
    shadow: 'rgba(239,68,68,0.45)',
    badge: '切片',
    badgeFrom: '#ef4444', badgeTo: '#f97316',
    category: '内容创作',
  },
  {
    id: 'emotion-analysis',
    path: '/emotion-analysis',
    label: '口播台词优化',
    desc: '调整口播表达与情绪，让台词更自然、更清楚',
    icon: Heart,
    from: '#ec4899', to: '#f43f5e',
    shadow: 'rgba(236,72,153,0.45)',
    badge: '口播',
    badgeFrom: '#ec4899', badgeTo: '#f43f5e',
    category: '数据洞察',
  },
  {
    id: 'competitor',
    path: '/competitor',
    label: '竞品爆款分析',
    desc: '查看竞品视频数据和来源，分析值得参考的内容策略',
    icon: Globe,
    from: '#f97316', to: '#f59e0b',
    shadow: 'rgba(249,115,22,0.45)',
    badge: '情报',
    badgeFrom: '#f97316', badgeTo: '#f59e0b',
    category: '市场情报',
  },
  {
    id: 'analytics',
    path: '/analytics',
    label: '作品数据分析',
    desc: '查看作品播放、互动和实验结果，改进下一条视频',
    icon: BarChart3,
    from: '#0ea5e9', to: '#6366f1',
    shadow: 'rgba(14,165,233,0.45)',
    badge: '数据',
    badgeFrom: '#0ea5e9', badgeTo: '#6366f1',
    category: '数据洞察',
  },
  {
    id: 'video-create',
    path: '/video/create',
    label: 'AI 视频生成',
    desc: '描述画面，选择模型和视频规格，开始生成',
    icon: Wand2,
    from: '#6366f1', to: '#8b5cf6',
    shadow: 'rgba(99,102,241,0.45)',
    badge: '核心',
    badgeFrom: '#6366f1', badgeTo: '#8b5cf6',
    category: '内容创作',
  },
  {
    id: 'avatars',
    path: '/avatars',
    label: '数字人口播',
    desc: '用照片制作口播视频，或为现有视频同步配音与口型',
    icon: Users,
    from: '#8b5cf6', to: '#ec4899',
    shadow: 'rgba(139,92,246,0.45)',
    badge: 'AI',
    badgeFrom: '#8b5cf6', badgeTo: '#ec4899',
    category: '创作提效',
  },
  {
    id: 'translate',
    path: '/multilang',
    label: '多语言翻译',
    desc: '翻译文案，制作目标语言的配音与字幕',
    icon: Languages,
    from: '#10b981', to: '#06b6d4',
    shadow: 'rgba(16,185,129,0.45)',
    badge: '多语种',
    badgeFrom: '#10b981', badgeTo: '#06b6d4',
    category: '内容创作',
  },
  {
    id: 'products-ai',
    path: '/products',
    label: 'AI 卖点提炼',
    desc: '导入商品链接，提炼卖点并保存商品资料',
    icon: ShoppingBag,
    from: '#f97316', to: '#fbbf24',
    shadow: 'rgba(249,115,22,0.45)',
    badge: '一键',
    badgeFrom: '#f97316', badgeTo: '#fbbf24',
    category: '创作提效',
  },
  {
    id: 'batch-generate',
    path: '/batch-create',
    label: '批量生成工作台',
    desc: '为多个商品设置镜头、配音和字幕，统一生成视频',
    icon: Cpu,
    from: '#6366f1', to: '#0ea5e9',
    shadow: 'rgba(99,102,241,0.45)',
    badge: '批量',
    badgeFrom: '#6366f1', badgeTo: '#0ea5e9',
    category: '创作提效',
  },
  {
    id: 'publish',
    path: '/publish',
    label: '跨平台发布',
    desc: '连接抖音或 TikTok 账号，预览作品并确认发布',
    icon: Megaphone,
    from: '#10b981', to: '#0ea5e9',
    shadow: 'rgba(16,185,129,0.45)',
    badge: '发布',
    badgeFrom: '#10b981', badgeTo: '#0ea5e9',
    category: '市场情报',
  },
  {
    id: 'image-edit', path: '/video/create?tab=image', label: '商品图片编辑',
    desc: '生成商品图，也可用支持编辑的模型扩图或局部重绘',
    icon: ImageIcon, from: '#ec4899', to: '#8b5cf6', shadow: 'rgba(236,72,153,0.3)',
    badge: '图片', badgeFrom: '#ec4899', badgeTo: '#8b5cf6', category: '内容创作',
  },
  {
    id: 'export', path: '/export-formats', label: '多画幅导出',
    desc: '按平台需要调整成片画幅与规格，导出并下载',
    icon: Scissors, from: '#10b981', to: '#0ea5e9', shadow: 'rgba(16,185,129,0.3)',
    badge: '导出', badgeFrom: '#10b981', badgeTo: '#0ea5e9', category: '创作提效',
  },
];

const CATEGORIES = ['全部', '内容创作', '数据洞察', '知识管理', '市场情报', '创作提效'];

function categoryArea(category: string) {
  if (category === '知识管理') return 'library';
  if (category === '数据洞察' || category === '市场情报') return 'insights';
  if (category === '创作提效') return 'account';
  return 'creation';
}

// ── 工具卡片 ──────────────────────────────────────────────────────────────
function ToolCard({ tool }: { tool: typeof AI_TOOLS[0] }) {
  const Icon = tool.icon;

  return (
    <Link
      to={tool.path}
      data-area={categoryArea(tool.category)}
      className={cn(
        'toolbox-card group relative w-full text-left rounded-xl border border-border',
        'transition-colors duration-150 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
      )}
    >
      <div className="relative p-4 sm:p-5">
        {/* 图标 + badge */}
        <div className="flex items-start justify-between mb-4">
          {/* 统一的工具入口图标 */}
          <div
            className="toolbox-icon w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
          >
            <Icon className="w-5 h-5" />
          </div>

          {/* badge */}
          <span
            className="toolbox-badge px-2 py-1 text-xs font-medium rounded-md shrink-0"
          >
            {tool.badge}
          </span>
        </div>

        {/* 文字 */}
        <h3 className="text-sm font-semibold text-foreground mb-1.5 text-balance">{tool.label}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">{tool.desc}</p>

        {/* 底部分类 + 箭头 */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md">
            {tool.category}
          </span>
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors duration-200">
            <span>打开工具</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── 统计卡片 ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="relative rounded-xl border border-border/60 bg-card p-4 overflow-hidden">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold text-[hsl(var(--area-creation))] tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
export default function AiToolboxPage() {
  const [activeCategory, setActiveCategory] = useState('全部');
  const [search, setSearch] = useState('');

  const query = search.trim().toLocaleLowerCase();
  const filtered = AI_TOOLS.filter(t => {
    const matchCat = activeCategory === '全部' || t.category === activeCategory;
    const matchSearch = `${t.label} ${t.desc} ${t.category}`.toLocaleLowerCase().includes(query);
    return matchCat && matchSearch;
  });

  return (
    <div className="min-h-full bg-background">
      {/* ── 顶部 Hero Banner ─────────────────────────────────────────── */}
      <div className="toolbox-banner relative overflow-hidden border-b border-border/60">
        <div className="relative px-4 py-6 sm:px-6 md:py-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-foreground text-balance">AI工具箱</h1>
                <span className="hidden md:inline px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded-full border border-primary/20">
                  {AI_TOOLS.length} 个工具
                </span>
              </div>
              <p className="text-sm text-muted-foreground text-pretty">从灵感、脚本到成片，找到适合当前任务的工具</p>
            </div>
          </div>

          {/* 统计数据 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <StatCard label="工具入口" value={String(AI_TOOLS.length)} sub="当前可访问的工作台" />
            <StatCard label="工具分类" value={String(CATEGORIES.length - 1)} sub="按创作任务组织" />
            <StatCard label="当前筛选" value={String(filtered.length)} sub="符合分类和搜索的工具" />
            <StatCard label="支持发布平台" value="2" sub="抖音、TikTok；需账号授权" />
          </div>
        </div>
      </div>

      {/* ── 筛选 & 搜索 ────────────────────────────────────────────────── */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border bg-card sticky top-16 z-10">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                aria-pressed={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors duration-150 shrink-0',
                  activeCategory === cat
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="relative md:ml-auto md:w-56 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              aria-label="搜索工具"
              placeholder="搜索工具…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full min-h-10 pl-8 pr-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ── 工具网格 ───────────────────────────────────────────────────── */}
      <div className="px-4 py-4 sm:px-6 sm:py-6">
        {filtered.length < AI_TOOLS.length && (
          <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
            <Zap className="w-4 h-4 text-primary" />
            找到 <span className="font-semibold text-foreground">{filtered.length}</span> 个工具
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Search className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">未找到相关工具</p>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => { setSearch(''); setActiveCategory('全部'); }}
            >
              清除筛选条件
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {/* 底部说明 */}
        <div className="mt-8 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">第一次使用？从一个创作任务开始</h4>
              <p className="text-xs text-muted-foreground leading-relaxed text-pretty">
                想做视频可先写脚本，有现成素材可直接剪辑。生成前查看积分用量，发布前确认账号；若提示服务未配置，请联系平台管理员。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
