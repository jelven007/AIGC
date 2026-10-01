import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Bell, CheckCheck, Trash2, Video, Sparkles,
  Gift, CreditCard, AlertCircle, TrendingUp,
  Settings, ChevronRight, Info, Zap,
} from 'lucide-react';

// ── 类型 ──────────────────────────────────────────────────────────────────
type NotifCategory = 'all' | 'system' | 'video' | 'activity' | 'alert';
type NotifLevel = 'info' | 'success' | 'warning' | 'error';

interface Notification {
  id: string;
  category: Exclude<NotifCategory, 'all'>;
  level: NotifLevel;
  title: string;
  body: string;
  time: string;
  read: boolean;
  actionLabel?: string;
  actionPath?: string;
}

// ── 示例数据 ──────────────────────────────────────────────────────────────
const INITIAL_NOTIFS: Notification[] = [
  {
    id: 'n1', category: 'video', level: 'success', read: false,
    title: '视频生成完成',
    body: '「烟酰胺精华28天变白挑战」已生成完毕，可前往作品素材查看和下载。',
    time: '2分钟前',
    actionLabel: '查看作品', actionPath: '/works',
  },
  {
    id: 'n2', category: 'activity', level: 'info', read: false,
    title: '限时积分奖励活动',
    body: '5月大促期间生成视频可获得双倍积分，活动截止 5月31日，把握机会！',
    time: '1小时前',
    actionLabel: '参与活动', actionPath: '/activities',
  },
  {
    id: 'n3', category: 'video', level: 'info', read: false,
    title: '视频正在处理中',
    body: '「防晒气垫BB霜全攻略」视频任务已加入队列，预计5分钟内完成。',
    time: '2小时前',
    actionLabel: '查看进度', actionPath: '/works',
  },
  {
    id: 'n4', category: 'system', level: 'info', read: true,
    title: '系统版本更新 v42',
    body: '本次更新：AI工具箱美化升级、数字人库融合视频模板、消息通知中心上线。',
    time: '5小时前',
    actionLabel: '查看详情',
  },
  {
    id: 'n5', category: 'activity', level: 'success', read: true,
    title: '邀请奖励到账',
    body: '您邀请的好友「张**」已完成注册并激活，您已获得 200 积分奖励。',
    time: '昨天 14:30',
    actionLabel: '查看积分', actionPath: '/credits',
  },
  {
    id: 'n6', category: 'alert', level: 'warning', read: true,
    title: '积分余额不足提醒',
    body: '您的账户积分余额仅剩 150 分，建议充值或参与活动获取更多积分。',
    time: '昨天 10:12',
    actionLabel: '立即充值', actionPath: '/credits',
  },
  {
    id: 'n7', category: 'video', level: 'error', read: true,
    title: '视频生成失败',
    body: '「蓝牙音箱户外露营实测」视频在渲染阶段出现异常，请重新提交或联系客服。',
    time: '2天前',
    actionLabel: '重新生成', actionPath: '/video/create',
  },
  {
    id: 'n8', category: 'system', level: 'info', read: true,
    title: '新功能：示例项目快速加载',
    body: '视频剪辑页现已支持示例项目一键加载，快去体验更流畅的剪辑工作流。',
    time: '3天前',
    actionLabel: '立即体验', actionPath: '/video/edit',
  },
  {
    id: 'n9', category: 'activity', level: 'info', read: true,
    title: '每日签到提醒',
    body: '您已连续签到 7 天，今日签到可获得额外 50 积分奖励！',
    time: '3天前',
    actionLabel: '去签到', actionPath: '/activities',
  },
  {
    id: 'n10', category: 'alert', level: 'error', read: true,
    title: '套餐即将到期',
    body: '您的专业版套餐将于 5月20日 到期，续费后可继续享受不限次视频生成。',
    time: '4天前',
    actionLabel: '续费套餐', actionPath: '/credits',
  },
];

// ── 分类配置 ──────────────────────────────────────────────────────────────
const CATEGORIES: { id: NotifCategory; label: string; icon: React.ElementType }[] = [
  { id: 'all',      label: '全部',   icon: Bell },
  { id: 'video',    label: '视频',   icon: Video },
  { id: 'activity', label: '活动',   icon: Gift },
  { id: 'system',   label: '系统',   icon: Settings },
  { id: 'alert',    label: '提醒',   icon: AlertCircle },
];

const LEVEL_CONFIG: Record<NotifLevel, {
  bg: string; border: string; icon: React.ElementType; iconColor: string; dotColor: string;
}> = {
  success: {
    bg: 'bg-success/5', border: 'border-success/20',
    icon: TrendingUp, iconColor: 'text-success', dotColor: 'bg-success',
  },
  info: {
    bg: 'bg-primary/5', border: 'border-primary/15',
    icon: Info, iconColor: 'text-primary', dotColor: 'bg-primary',
  },
  warning: {
    bg: 'bg-warning/5', border: 'border-warning/20',
    icon: AlertCircle, iconColor: 'text-warning', dotColor: 'bg-warning',
  },
  error: {
    bg: 'bg-destructive/5', border: 'border-destructive/20',
    icon: AlertCircle, iconColor: 'text-destructive', dotColor: 'bg-destructive',
  },
};

const CATEGORY_ICON: Record<Exclude<NotifCategory, 'all'>, React.ElementType> = {
  video:    Video,
  activity: Gift,
  system:   Sparkles,
  alert:    AlertCircle,
};

const CATEGORY_COLOR: Record<Exclude<NotifCategory, 'all'>, string> = {
  video:    'bg-indigo-500/10 text-indigo-500',
  activity: 'bg-amber-500/10 text-amber-500',
  system:   'bg-primary/10 text-primary',
  alert:    'bg-destructive/10 text-destructive',
};

// ── 单条通知卡片 ─────────────────────────────────────────────────────────
function NotifCard({
  notif,
  onRead,
  onDelete,
}: {
  notif: Notification;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const lv = LEVEL_CONFIG[notif.level];
  const CatIcon = CATEGORY_ICON[notif.category];

  return (
    <div
      className={cn(
        'group relative flex gap-4 p-4 rounded-2xl border transition-all duration-200',
        'hover:shadow-sm',
        notif.read ? 'bg-card border-border/50' : `${lv.bg} ${lv.border}`,
      )}
    >
      {/* 未读圆点 */}
      {!notif.read && (
        <span className={cn('absolute top-4 right-4 w-2 h-2 rounded-full', lv.dotColor)} />
      )}

      {/* 图标 */}
      <div className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
        CATEGORY_COLOR[notif.category],
      )}>
        <CatIcon className="w-5 h-5" />
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start gap-2 pr-6">
          <p className={cn('text-sm font-semibold leading-snug text-balance', notif.read && 'text-muted-foreground')}>
            {notif.title}
          </p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed text-pretty line-clamp-2">
          {notif.body}
        </p>
        <div className="flex items-center gap-3 pt-1">
          <span className="text-[11px] text-muted-foreground/70">{notif.time}</span>
          {notif.actionLabel && (
            <button
              className="text-[11px] font-medium text-primary hover:underline flex items-center gap-0.5"
              onClick={() => onRead(notif.id)}
            >
              {notif.actionLabel}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!notif.read && (
          <button
            className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="标记已读"
            onClick={() => onRead(notif.id)}
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          className="w-7 h-7 rounded-lg hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
          title="删除"
          onClick={() => onDelete(notif.id)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notification[]>(INITIAL_NOTIFS);
  const [activeCategory, setActiveCategory] = useState<NotifCategory>('all');

  const unreadCount = notifs.filter(n => !n.read).length;

  const filtered = activeCategory === 'all'
    ? notifs
    : notifs.filter(n => n.category === activeCategory);

  const handleRead = (id: string) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleDelete = (id: string) => {
    setNotifs(prev => prev.filter(n => n.id !== id));
  };

  const handleReadAll = () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleClearRead = () => {
    setNotifs(prev => prev.filter(n => !n.read));
  };

  return (
    <div className="min-h-full bg-background">
      {/* ── 顶部 Hero ───────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-border/60 bg-card">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="relative px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shrink-0"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground text-balance">消息通知</h1>
                {unreadCount > 0 && (
                  <Badge className="bg-primary text-primary-foreground text-xs h-5 px-1.5">
                    {unreadCount}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground text-pretty">
                共 {notifs.length} 条通知{unreadCount > 0 ? `，${unreadCount} 条未读` : '，全部已读'}
              </p>
            </div>
          </div>

          {/* 批量操作 */}
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={handleReadAll}
              >
                <CheckCheck className="w-3.5 h-3.5" />全部标记已读
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground gap-1.5 hover:text-destructive"
              onClick={handleClearRead}
            >
              <Trash2 className="w-3.5 h-3.5" />清除已读
            </Button>
          </div>
        </div>

        {/* 统计卡 */}
        <div className="relative px-6 pb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '全部通知', value: notifs.length,                      color: 'from-primary/20 to-primary/5',    iconColor: 'text-primary',    icon: Bell },
            { label: '未读通知', value: unreadCount,                         color: 'from-indigo-500/20 to-indigo-500/5', iconColor: 'text-indigo-500', icon: Zap },
            { label: '视频通知', value: notifs.filter(n=>n.category==='video').length,    color: 'from-sky-500/20 to-sky-500/5',    iconColor: 'text-sky-500',    icon: Video },
            { label: '活动通知', value: notifs.filter(n=>n.category==='activity').length, color: 'from-amber-500/20 to-amber-500/5', iconColor: 'text-amber-500',  icon: Gift },
          ].map(({ label, value, color, iconColor, icon: Icon }) => (
            <div key={label} className={cn(
              'rounded-xl bg-gradient-to-br p-3 border border-border/40 flex items-center gap-3',
              color,
            )}>
              <div className={cn('w-8 h-8 rounded-lg bg-card/60 flex items-center justify-center shrink-0', iconColor)}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold text-foreground leading-none">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 分类 Tab ────────────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border/40 bg-card/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {CATEGORIES.map(({ id, label, icon: Icon }) => {
            const count = id === 'all'
              ? notifs.filter(n => !n.read).length
              : notifs.filter(n => n.category === id && !n.read).length;
            return (
              <button
                key={id}
                onClick={() => setActiveCategory(id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 shrink-0',
                  activeCategory === id
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {count > 0 && (
                  <span className={cn(
                    'text-[10px] px-1 rounded-full min-w-[16px] text-center',
                    activeCategory === id
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-primary/15 text-primary',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 通知列表 ─────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 max-w-3xl">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Bell className="w-8 h-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground">暂无通知</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 未读分组 */}
            {filtered.some(n => !n.read) && (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                  未读消息
                </p>
                {filtered.filter(n => !n.read).map(n => (
                  <NotifCard key={n.id} notif={n} onRead={handleRead} onDelete={handleDelete} />
                ))}
              </>
            )}
            {/* 已读分组 */}
            {filtered.some(n => n.read) && (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-6 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" />
                  已读消息
                </p>
                {filtered.filter(n => n.read).map(n => (
                  <NotifCard key={n.id} notif={n} onRead={handleRead} onDelete={handleDelete} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 底部通知设置入口 ───────────────────────────────────────────── */}
      <div className="px-6 pb-8 max-w-3xl">
        <div className="rounded-2xl border border-border/50 bg-card p-4 flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Settings className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">通知偏好设置</p>
            <p className="text-xs text-muted-foreground text-pretty">管理邮件通知、浏览器推送和消息提醒频率</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1 shrink-0"
            onClick={() => toast.info('通知偏好设置功能即将上线')}>
            去设置 <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
