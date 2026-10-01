import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Flame, TrendingUp, Search, Filter, Eye, BarChart3,
  Star, Tag, Play, ChevronRight, Sparkles, Copy,
  Bookmark, BookmarkCheck, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── 类型 ────────────────────────────────────────────────────────────────────
interface TrendingPattern {
  id: string;
  category: string;
  platform: string;
  pattern_name: string;
  hook_type: string | null;
  video_style: string | null;
  avg_duration: number;
  avg_play_rate: number;
  avg_ctr: number;
  sample_count: number;
  feature_tags: string[];
  description: string | null;
  example_urls: string[];
  trend_score: number;
  recorded_at: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音', tiktok: 'TikTok', xiaohongshu: '小红书', kuaishou: '快手', bilibili: 'B站',
};

const HOOK_LABELS: Record<string, string> = {
  pain_point: '痛点开场', education: '教育科普', challenge: '挑战互动',
  reaction: '反应类', comparison: '对比测评', testimony: '证言信任',
  tutorial: '教程展示', unboxing: '开箱体验', lifestyle: '生活方式', haul: '开箱大赏',
};

// ─── 爆款卡片 ─────────────────────────────────────────────────────────────────
function PatternCard({
  pattern, bookmarked, onBookmark, onClick,
}: {
  pattern: TrendingPattern;
  bookmarked: boolean;
  onBookmark: () => void;
  onClick: () => void;
}) {
  const score = Math.round(pattern.trend_score);
  const hot = score >= 90;

  return (
    <Card className="h-full flex flex-col cursor-pointer hover:border-primary/40 transition-colors group" onClick={onClick}>
      <CardContent className="flex-1 p-4 space-y-3">
        {/* 头部 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {hot && <Flame className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <p className="text-sm font-semibold truncate text-balance">{pattern.pattern_name}</p>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                {PLATFORM_LABELS[pattern.platform] ?? pattern.platform}
              </span>
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {pattern.category}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onBookmark(); }}
            className={cn('p-1 rounded-md transition-colors shrink-0', bookmarked ? 'text-warning' : 'text-muted-foreground hover:text-warning')}
          >
            {bookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          </button>
        </div>

        {/* 热度 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">热度评分</span>
            <span className={cn('font-bold', hot ? 'text-destructive' : 'text-primary')}>{score}</span>
          </div>
          <Progress value={score} className="h-1.5" />
        </div>

        {/* 指标 */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            { label: '均播放率', val: `${(pattern.avg_play_rate * 100).toFixed(0)}%` },
            { label: '点击率', val: `${(pattern.avg_ctr * 100).toFixed(1)}%` },
            { label: '样本数', val: pattern.sample_count },
          ].map(m => (
            <div key={m.label} className="rounded-md bg-muted/40 py-1.5">
              <p className="text-xs font-bold">{m.val}</p>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>

        {/* 特征标签 */}
        <div className="flex flex-wrap gap-1">
          {pattern.feature_tags?.slice(0,4).map(t => (
            <span key={t} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{t}</span>
          ))}
        </div>

        {/* 钩子类型 */}
        {pattern.hook_type && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="w-3 h-3 text-primary" />
            {HOOK_LABELS[pattern.hook_type] ?? pattern.hook_type}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 爆款特征库独立组件 ────────────────────────────────────────────────────────
export function TrendingPatternsSection({ showTitle = true }: { showTitle?: boolean }) {
  const [patterns, setPatterns] = useState<TrendingPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [sortBy, setSortBy] = useState('trend_score');
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<TrendingPattern | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('all');

  const loadPatterns = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('trending_patterns').select('*').eq('is_active', true);
    if (platform !== 'all') q = q.eq('platform', platform);
    if (category !== 'all') q = q.eq('category', category);
    q = q.order(sortBy as 'trend_score', { ascending: false }).limit(60);
    const { data } = await q;
    setPatterns((data ?? []) as TrendingPattern[]);
    setLoading(false);
  }, [platform, category, sortBy]);

  useEffect(() => { loadPatterns(); }, [loadPatterns]);

  const categories = [...new Set(patterns.map(p => p.category))];
  const filtered = patterns.filter(p =>
    tab === 'bookmarked'
      ? bookmarks.has(p.id)
      : (!search || p.pattern_name.includes(search) || p.description?.includes(search) ||
         p.feature_tags?.some(t => t.includes(search)))
  );

  const handleBookmark = (id: string) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCopyDesc = async () => {
    if (!detail) return;
    const text = `【${detail.pattern_name}】\n${detail.description ?? ''}\n\n特征标签：${detail.feature_tags?.join('、')}\nHook类型：${HOOK_LABELS[detail.hook_type ?? ''] ?? ''}`;
    await navigator.clipboard.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
    toast.success('已复制爆款公式');
  };

  return (
    <div className="space-y-6">
      {/* 标题 */}
      {showTitle && (
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Flame className="w-5 h-5 text-destructive" />行业爆款特征库
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">P3-S03 · 基于万级样本提炼的爆款视频规律，指导内容创作</p>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索爆款公式…" className="pl-8 h-9" />
        </div>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="h-9 w-28"><SelectValue placeholder="平台" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部平台</SelectItem>
            {Object.entries(PLATFORM_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-24"><SelectValue placeholder="品类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部品类</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="trend_score">热度优先</SelectItem>
            <SelectItem value="avg_ctr">CTR优先</SelectItem>
            <SelectItem value="avg_play_rate">完播率优先</SelectItem>
            <SelectItem value="sample_count">样本量优先</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">全部 ({patterns.length})</TabsTrigger>
          <TabsTrigger value="bookmarked">
            <BookmarkCheck className="w-3.5 h-3.5 mr-1" />收藏 ({bookmarks.size})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-56 rounded-xl bg-muted animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Flame className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">没有符合条件的爆款公式</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(p => (
                <PatternCard
                  key={p.id}
                  pattern={p}
                  bookmarked={bookmarks.has(p.id)}
                  onBookmark={() => handleBookmark(p.id)}
                  onClick={() => setDetail(p)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bookmarked" className="mt-4">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Bookmark className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">还没有收藏的爆款公式</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(p => (
                <PatternCard
                  key={p.id} pattern={p}
                  bookmarked={bookmarks.has(p.id)}
                  onBookmark={() => handleBookmark(p.id)}
                  onClick={() => setDetail(p)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 详情弹窗 */}
      <Dialog open={!!detail} onOpenChange={v => !v && setDetail(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-balance">
              <Flame className="w-4 h-4 text-destructive" />{detail?.pattern_name}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 pt-1 max-h-[65vh] overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{PLATFORM_LABELS[detail.platform] ?? detail.platform}</Badge>
                <Badge variant="secondary">{detail.category}</Badge>
                {detail.hook_type && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    Hook: {HOOK_LABELS[detail.hook_type] ?? detail.hook_type}
                  </span>
                )}
              </div>

              <p className="text-sm text-muted-foreground text-pretty leading-relaxed">{detail.description}</p>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '热度评分', val: `${Math.round(detail.trend_score)}分` },
                  { label: '均完播率', val: `${(detail.avg_play_rate * 100).toFixed(0)}%` },
                  { label: '均点击率', val: `${(detail.avg_ctr * 100).toFixed(1)}%` },
                  { label: '参考样本', val: `${detail.sample_count} 条` },
                  { label: '均时长', val: `${detail.avg_duration}s` },
                  { label: '视频风格', val: detail.video_style ?? '—' },
                ].map(m => (
                  <div key={m.label} className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="text-sm font-semibold mt-0.5">{m.val}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-sm font-medium mb-2">特征标签</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.feature_tags?.map(t => (
                    <span key={t} className="text-xs bg-muted px-2 py-1 rounded-full">{t}</span>
                  ))}
                </div>
              </div>

              <Button className="w-full gap-1.5" onClick={handleCopyDesc}>
                {copied ? <><BookmarkCheck className="w-4 h-4" />已复制爆款公式</> : <><Copy className="w-4 h-4" />复制爆款公式</>}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TrendingPatternsPage() {
  return (
    <div className="p-4 md:p-6">
      <TrendingPatternsSection showTitle={true} />
    </div>
  );
}
