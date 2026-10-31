import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { useNotifications } from '@/hooks/useNotifications';
import { notificationPath } from '@/api/notifications';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  LayoutDashboard, Video, FolderOpen, ImageIcon,
  Menu, ChevronRight, Sparkles, ShoppingBag,
  Package, Users2, CreditCard, Wand2,
  Search, X, ArrowRight, Scissors, Moon, Sun,
  Layers, Share2, Code2, Gift, LayoutGrid, Bell, House, CheckCheck, LogOut,
  Zap, History, CheckCircle2, ChevronDown, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/db/supabase';
import { OPEN_CREDITS_DIALOG_EVENT } from '@/lib/creditGuard';

// ── FE-UX 主题持久化 hook ─────────────────────────────────────────────────
export type ThemeType = 'light' | 'dark';

function useThemePersist() {
  const [theme, setTheme] = useState<ThemeType>(() => {
    return 'dark';
  });

  return { theme, setTheme };
}

// AI工具箱二级菜单条目
const AI_TOOLBOX_ITEMS = [
  { label: 'Prompt知识库', path: '/knowledge', badge: 'Prompt', badgeColor: '#14b8a6', desc: '聚合优质 Prompt，整合提效写作' },
  { label: '商品带货脚本', path: '/script', badge: '脚本', badgeColor: '#a855f7', desc: '智能生成短视频爆款带货脚本' },
  { label: '爆款风格复刻', path: '/style-copy', badge: '热门', badgeColor: '#f97316', desc: '一键复刻高转化内容风格' },
  { label: '直播高光切片', path: '/live-highlight', badge: '切片', badgeColor: '#ef4444', desc: 'AI自动识别直播精华' },
  { label: '口播台词优化', path: '/emotion-analysis', badge: '口播', badgeColor: '#6366f1', desc: '深度优化台词表达与情感重音' },
  { label: '竞品爆款分析', path: '/competitor', badge: '情报', badgeColor: '#3b82f6', desc: '抓取竞品爆款视频策略' },
  { label: '作品表现与优化', path: '/analytics', badge: '数据', badgeColor: '#22c55e', desc: '官方视频数据、授权投放与创意改进建议' },
];

const navGroups = [
  {
    label: '主要功能',
    items: [
      { path: '/video/create', label: '工作台', icon: Video },
      { path: '/product-selection', label: '智能选品', icon: ShoppingBag },
      { path: '/products', label: '商品管理', icon: Package },
      { path: '/avatars', label: '数字人库', icon: Users2 },
      { path: '/video/edit', label: '视频剪辑', icon: Scissors },
      { path: '/works', label: '作品素材', icon: FolderOpen },
      // AI工具箱通过 AIToolboxNavItem 单独渲染
      { path: '/export-formats', label: '跨平台导出', icon: Layers },
      { path: '/data-feedback', label: '多平台分析', icon: Share2 },
    ],
  },
  {
    label: '生态扩展',
    items: [
      { path: '/team', label: '团队协作', icon: Users2 },
      { path: '/open-api', label: '开放平台', icon: Code2 },
      { path: '/settings/models', label: '模型接口', icon: Settings2 },
      { path: '/settings/integrations', label: '第三方集成', icon: Share2 },
      { path: '/operations', label: '运营控制台', icon: LayoutDashboard },
      { path: '/support', label: '帮助与工单', icon: Bell },
    ],
  },
];

function pageArea(path: string) {
  if (/^\/(video|avatars|script|style-copy|live-highlight|emotion-analysis|multilang|batch-create|templates|prompt-templates|ai-toolbox|personalize|task-queue|export-formats)(\/|$)/.test(path)) return 'creation';
  if (/^\/(works|materials|products|knowledge|llm-cache)(\/|$)/.test(path)) return 'library';
  if (/^\/(analytics|data-feedback|data-dashboard|ab-test|competitor|product-selection|trending-patterns|open-api|settings)(\/|$)/.test(path)) return 'insights';
  return 'account';
}

// F-09: 全局搜索结果类型
type SearchResult = {
  id: string;
  type: 'product' | 'video' | 'material';
  label: string;
  sub?: string;
  path: string;
};

// F-09: 全局搜索组件
function GlobalSearch({ isDarkHeader }: { isDarkHeader: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Ctrl+K / Cmd+K 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    if (!open) { setQuery(''); setResults([]); }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const [pRes, vRes, mRes] = await Promise.all([
        supabase.from('products').select('id,name,category').ilike('name', `%${q}%`).limit(4),
        supabase.from('video_projects').select('id,title,status').ilike('title', `%${q}%`).limit(4),
        supabase.from('materials').select('id,name,type').ilike('name', `%${q}%`).limit(3),
      ]);
      const mapped: SearchResult[] = [
        ...(pRes.data ?? []).map(p => ({ id: p.id, type: 'product' as const, label: p.name, sub: p.category, path: '/products' })),
        ...(vRes.data ?? []).map(v => ({ id: v.id, type: 'video' as const, label: v.title || '未命名视频', sub: v.status, path: '/works' })),
        ...(mRes.data ?? []).map(m => ({ id: m.id, type: 'material' as const, label: m.name, sub: m.type, path: '/works' })),
      ];
      setResults(mapped);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  const typeConfig = {
    product: { label: '商品', icon: Package, color: 'text-orange-500 bg-orange-500/10' },
    video: { label: '视频', icon: Video, color: 'text-primary bg-primary/10' },
    material: { label: '素材', icon: ImageIcon, color: 'text-info bg-info/10' },
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 h-9 px-3 rounded-lg border transition-colors text-sm md:w-[420px] w-full min-w-0",
          isDarkHeader
            ? "border-white/10 bg-white/5 hover:bg-white/10 text-white/50"
            : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-500"
        )}
      >
        <Search className={cn("w-4 h-4 shrink-0", isDarkHeader ? "text-white/40" : "text-zinc-400")} />
        <span className={cn("hidden md:inline truncate", isDarkHeader ? "text-white/60" : "text-zinc-500")}>搜索商品、视频、素材</span>
      </button>

      {/* 全屏搜索弹窗 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" onClick={() => setOpen(false)}>
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
          {/* 搜索面板 */}
          <div
            className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* 搜索输入框 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索商品、视频、素材"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
              />
              {searching && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />}
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 搜索结果 */}
            <div className="max-h-72 overflow-y-auto">
              {query.trim() === '' ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  输入关键词搜索商品、视频或素材
                </div>
              ) : results.length === 0 && !searching ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  未找到「{query}」相关内容
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {results.map(r => {
                    const { icon: Icon, color, label } = typeConfig[r.type];
                    return (
                      <button
                        key={r.id}
                        onClick={() => { navigate(r.path); setOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
                      >
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', color)}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{r.label}</p>
                          <p className="text-xs text-muted-foreground">{label}{r.sub ? ` · ${r.sub}` : ''}</p>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 底部提示 */}
            <div className="px-4 py-2.5 border-t border-border/50 flex items-center gap-3 text-[11px] text-muted-foreground bg-muted/20">
              <span className="flex items-center gap-1"><kbd className="font-mono bg-background border border-border rounded px-1">↑↓</kbd>导航</span>
              <span className="flex items-center gap-1"><kbd className="font-mono bg-background border border-border rounded px-1">↵</kbd>前往</span>
              <span className="flex items-center gap-1"><kbd className="font-mono bg-background border border-border rounded px-1">Esc</kbd>关闭</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// AI工具箱二级子菜单导航项
function AIToolboxNavItem({ onNavClick }: { onNavClick?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(location.pathname.startsWith('/ai-toolbox'));
  const isActive = location.pathname.startsWith('/ai-toolbox');
  const panelId = useId();

  return (
    <div>
      {/* 主按钮 */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 group',
          isActive
            ? 'bg-sidebar-primary/10 text-sidebar-primary'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        <LayoutGrid className="w-5 h-5 shrink-0 text-[hsl(var(--area-creation))]" />
        <span className="flex-1 text-left">AI工具箱</span>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-sidebar-foreground/40 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {/* 二级子菜单 */}
      {open && (
        <div id={panelId} className="ml-3 mt-0.5 border-l border-sidebar-border/50 pl-5 space-y-0.5 pb-1">
          <Link to="/ai-toolbox" onClick={onNavClick} className="block px-2 py-2 text-xs text-[hsl(var(--area-creation))] rounded-md hover:bg-sidebar-accent">
            查看全部工具
          </Link>
          {AI_TOOLBOX_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.path}
              onClick={onNavClick}
              data-area={pageArea(item.path)}
              aria-current={location.pathname === item.path ? 'page' : undefined}
              className="app-nav-link w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors duration-150 group text-left"
            >
              <span className="truncate">{item.label}</span>
              <span
                className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md leading-none bg-sidebar-accent text-sidebar-foreground border border-sidebar-border"
              >
                {item.badge}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavItem({ path, label, icon: Icon, active, onClick }: {
  path: string; label: string; icon: typeof LayoutDashboard; active: boolean; onClick?: () => void;
}) {
  return (
    <Link to={path} onClick={onClick} data-area={pageArea(path)} aria-current={active ? 'page' : undefined}
      className={cn(
        'app-nav-link flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150 group',
        active
          ? 'bg-sidebar-primary/10 text-sidebar-primary ring-1 ring-inset ring-sidebar-primary/20'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      )}>
        <Icon className={cn('w-5 h-5 shrink-0', active && 'text-sidebar-primary')} />
        <span className="text-sm font-medium truncate">{label}</span>
        {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />}
    </Link>
  );
}

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('已退出登录');
      navigate('/login');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '退出登录失败'); }
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const username = profile?.username ?? '用户';
  const initial = username[0]?.toUpperCase() ?? 'U';

  return (
    <div className="flex flex-col h-full bg-sidebar sidebar-gradient">
      {/* Logo — 点击跳转官网 */}
      <Link to="/landing" onClick={onNavClick} className="block">
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border transition-colors hover:bg-sidebar-accent/50">
          <img src="/shopro.png" className="w-9 h-9 object-contain shrink-0" alt="视频生成平台" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-sidebar-foreground truncate">视频生成平台</p>
            <p className="text-xs text-sidebar-foreground/75">AI 驱动 · 视频创作</p>
          </div>
        </div>
      </Link>

      {/* 导航：预留底部安全区空间，确保「生态扩展」分组末尾条目不被机型底栏遮挡 */}
      <nav aria-label="主要导航" className="flex-1 px-3 py-3 space-y-4 overflow-y-auto min-h-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-medium text-sidebar-foreground/80 tracking-wide px-3 mb-2">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.path} {...item} active={isActive(item.path)} onClick={onNavClick} />
              ))}
              {/* 在「作品管理」后插入 AI工具箱 二级菜单 */}
              {group.label === '主要功能' && (
                <AIToolboxNavItem onNavClick={onNavClick} />
              )}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

// ── 顶栏快捷图标按钮 ─────────────────────────────────────────────────────
function TopBarQuickLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Button
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
      onClick={() => navigate(to)}
      className={cn(
        'h-8 w-8 p-0 flex items-center justify-center rounded-lg transition-colors',
        isActive
          ? 'text-primary bg-primary/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      <Icon className="w-4 h-4" />
    </Button>
  );
}

// ── 通知 Bell（顶栏）─────────────────────────────────────────────────────
function TopBarNotificationBell({ isDarkHeader }: { isDarkHeader: boolean }) {
  const navigate = useNavigate();
  const { feed, isLoading, error, mutate, mutating } = useNotifications();
  const unread = feed?.unread_all || 0;

  const markAllRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (feed && !mutating) void mutate({ action: 'read_all', cutoff: feed.cutoff }).catch(cause => toast.error(cause.message));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`消息通知，${unread}条未读`} className="relative shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent">
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-destructive border-2 border-card" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">消息通知</span>
            {unread > 0 && (
              <Badge className="h-4 px-1.5 text-[10px] bg-destructive text-destructive-foreground">{unread}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                onClick={markAllRead}
                disabled={mutating}
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
              >
                <CheckCheck className="w-3 h-3" />一键已读
              </button>
            )}
            <button
              onClick={() => navigate('/notifications')}
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              全部<ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="divide-y divide-border/30">
          {isLoading && <p className="p-4 text-xs text-muted-foreground" role="status">正在读取通知</p>}
          {error && <p className="p-4 text-xs text-destructive" role="alert">{error.message}</p>}
          {feed && !feed.items.length && <p className="p-4 text-xs text-muted-foreground">暂无通知</p>}
          {feed?.items.slice(0, 5).map(n => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.read_at) void mutate({ action: 'read', ids: [n.id] }).catch(cause => toast.error(cause.message));
                navigate(notificationPath(n), { state: { notification_source_id: n.source_id } });
              }}
              className={cn('w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors', !n.read_at && 'bg-primary/5')}
            >
              <div className="flex items-start gap-2">
                {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />}
                <div className={cn('flex-1 min-w-0', n.read_at && 'pl-3.5')}>
                  <p className={cn('text-sm leading-snug truncate', !n.read_at ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{n.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString('zh-CN')}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-border/30">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-8 text-xs text-muted-foreground hover:text-primary gap-1.5 justify-center"
            onClick={() => navigate('/notifications')}
          >
            <Bell className="w-3.5 h-3.5" />前往消息中心
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── 积分详情与充值弹窗 ───────────────────────────────────────────────────
function CreditsDetailModal({ open, onOpenChange, returnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; returnFocus: HTMLElement | null;
}) {
  const { creditsLeft, loading, error, refresh } = useCredits();
  const navigate = useNavigate();
  const go = (tab: string) => { onOpenChange(false); navigate(`/credits?tab=${tab}`); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto"
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}>
        <DialogHeader>
          <DialogTitle>积分管理与充值</DialogTitle>
          <DialogDescription>查看可用余额、实际收支流水与订单，充值价格以当前套餐为准。</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">可用积分余额</p>
          <p className="mt-2 text-3xl font-semibold">{loading ? '读取中…' : error ? '暂不可用' : creditsLeft.toLocaleString()}</p>
        </div>
        {error && <div role="alert" className="text-sm text-destructive">{error}<Button variant="outline" className="ml-2" onClick={() => void refresh()}>重试</Button></div>}
        <Button onClick={() => go('plans')}>查看套餐与充值</Button>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => go('logs')}>查看积分流水</Button>
          <Button variant="outline" onClick={() => go('orders')}>查看订单记录</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 顶栏用户菜单 ──────────────────────────────────────────────────────────
function getDisplayAvatar(url: string | null | undefined) {
  if (!url || url.includes('dicebear.com')) {
    return undefined;
  }
  return url;
}

function TopBarUserMenu({ isDarkHeader }: { isDarkHeader: boolean }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const username = profile?.username ?? '用户';
  const initial = username[0]?.toUpperCase() ?? 'U';

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-8 px-2 gap-2 shrink-0",
        "hover:bg-accent text-foreground"
      )}
      onClick={() => navigate('/profile')}
      title="个人中心"
      aria-label="个人中心"
    >
      <Avatar className="w-6 h-6 shrink-0">
        <AvatarImage src={getDisplayAvatar(profile?.avatar_url)} />
        <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-semibold">
          {initial}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium hidden md:block max-w-[80px] truncate text-foreground">{username}</span>
    </Button>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const creditsReturnFocus = useRef<HTMLElement | null>(null);
  const { theme, setTheme } = useThemePersist();
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const { creditsLeft, loading: creditsLoading, error: creditsError } = useCredits();
  const navigate = useNavigate();

  // 判断是否为生成视频界面
  const isVideoCreatePage = location.pathname.startsWith('/video/create');
  const isVideoEditPage = location.pathname.startsWith('/video/edit');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-ecommerce');
    root.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  }, []);

  // 积分不足守卫：任何生成入口余额不足时经全局事件自动弹出「积分管理与充值」弹窗（默认充值 Tab）
  useEffect(() => {
    const openCredits = () => {
      creditsReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCreditsModalOpen(true);
    };
    window.addEventListener(OPEN_CREDITS_DIALOG_EVENT, openCredits);
    return () => window.removeEventListener(OPEN_CREDITS_DIALOG_EVENT, openCredits);
  }, []);

  return (
    <div className="app-shell flex min-h-screen w-full bg-background text-foreground" data-area={pageArea(location.pathname)}>
      <a href="#main-content" className="skip-link">跳到页面内容</a>
      {/* 桌面端侧边栏 (固定在左侧，不随右侧页面上下滑动) */}
      <aside className={cn(
        "hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen",
        !isVideoCreatePage && "border-r border-sidebar-border/50"
      )}>
        <SidebarContent />
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-x-hidden">
        {/* 顶部栏：移动端汉堡 + 全局搜索（桌面端也显示） */}
        {!isVideoEditPage && (() => {
          const isDarkHeader = isVideoCreatePage;
          return (
            <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 h-16 border-b border-border shrink-0 sticky top-0 z-30 bg-card/95 text-foreground backdrop-blur-sm">
              {/* 移动端菜单 */}
              <div className="lg:hidden">
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="打开导航菜单" className="shrink-0 text-muted-foreground hover:text-foreground">
                      <Menu className="w-5 h-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
                    <SheetTitle className="sr-only">导航菜单</SheetTitle>
                    <SheetDescription className="sr-only">选择视频创作工具、素材或账户设置</SheetDescription>
                    <SidebarContent onNavClick={() => setMobileOpen(false)} />
                  </SheetContent>
                </Sheet>
              </div>

              {/* 移动端 Logo */}
              <Link to="/landing" className="lg:hidden flex items-center gap-2 min-w-0 shrink-0">
                <img src="/shopro.png" className="w-7 h-7 object-contain shrink-0" alt="视频生成平台" />
                <span className="font-semibold text-sm truncate text-foreground">视频生成平台</span>
              </Link>

              {/* 占位弹性空间 */}
              <div className="flex-1 min-w-0" />

              {/* 右上角工具栏：通知 + 邀请有礼 + 积分余额 + 头像 */}
              <div className="flex items-center gap-2 shrink-0">
                {/* 消息通知 */}
                <TopBarNotificationBell isDarkHeader={isDarkHeader} />

                {/* 邀请有礼 */}
                <div className="hidden md:flex items-center">
                  <Link to="/credits?tab=invite" className="flex items-center gap-1.5 h-9 px-3 rounded-lg font-medium text-xs text-muted-foreground border border-border bg-card hover:bg-accent hover:text-foreground transition-colors">
                      <Gift className="w-3.5 h-3.5 shrink-0 text-primary" />
                      <span>邀请有礼</span>
                  </Link>
                </div>

                {/* 积分余额按钮 (触发积分管理/充值弹窗) */}
                <div className="hidden md:flex items-center">
                  <button
                    onClick={event => { creditsReturnFocus.current = event.currentTarget; setCreditsModalOpen(true); }}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-lg font-medium text-xs text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
                    title="点击管理积分与充值"
                  >
                    <Zap className="w-3.5 h-3.5 shrink-0" />
                    <span>积分余额: <strong className="font-semibold tabular-nums">{creditsLoading ? '读取中' : creditsError ? '暂不可用' : creditsLeft.toLocaleString()}</strong></span>
                  </button>
                </div>

                {/* 头像 */}
                <TopBarUserMenu isDarkHeader={isDarkHeader} />

                {/* 退出登录 */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 px-2 shrink-0 flex items-center gap-1.5 transition-colors rounded-lg",
                    "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  )}
                  title="退出登录"
                  aria-label="退出登录"
                  onClick={async () => {
                    try {
                      await signOut();
                    } catch (e: any) {
                      toast.error(e instanceof Error ? e.message : '退出登录失败');
                      return;
                    }
                    toast.success('已成功退出登录');
                    navigate('/login');
                  }}
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-xs font-semibold hidden md:inline">退出</span>
                </Button>
              </div>
            </header>
          );
        })()}

        {/* 页面内容 */}
        <main id="main-content" tabIndex={-1} className="app-content flex-1 min-w-0 overflow-x-hidden" data-layout={isVideoEditPage ? 'editor' : isVideoCreatePage ? 'workspace' : 'page'}>
          {children}
        </main>
      </div>

      {/* 积分详情与充值弹窗 */}
      <CreditsDetailModal open={creditsModalOpen} onOpenChange={setCreditsModalOpen} returnFocus={creditsReturnFocus.current} />
    </div>
  );
}
