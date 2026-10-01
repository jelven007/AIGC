/**
 * P2-N06: LLM 响应缓存监控页
 * 缓存命中率统计 + 缓存条目管理
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Database, Zap, TrendingUp, Hash, Clock, Trash2, RefreshCw,
  Search, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface LLMCacheEntry {
  id: string;
  action: string;
  prompt_hash: string;
  response_text: string;
  hit_count: number;
  created_at: string;
  expires_at: string | null;
  model: string | null;
  tokens_saved: number;
}

const ACTION_LABELS: Record<string, string> = {
  generate_script:    '脚本生成',
  optimize_prompt:    'Prompt优化',
  extract_selling:    '卖点提炼',
  pain_point_hook:    '痛点钩子',
  cta_generator:      'CTA生成',
  content_moderation: '内容审核',
  emotion_analysis:   '情绪分析',
  translate_script:   '脚本翻译',
};

export default function LLMCachePage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LLMCacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, totalHits: 0, tokensSaved: 0, avgHitRate: 0 });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('llm_cache')
      .select('id, action, prompt_hash, response_text, hit_count, created_at, expires_at, model, tokens_saved')
      .order('hit_count', { ascending: false })
      .limit(50);
    const list = Array.isArray(data) ? (data as LLMCacheEntry[]) : [];
    setEntries(list);
    // 统计
    const totalHits = list.reduce((s, e) => s + (e.hit_count ?? 0), 0);
    const tokensSaved = list.reduce((s, e) => s + (e.tokens_saved ?? 0), 0);
    setStats({
      total: list.length,
      totalHits,
      tokensSaved,
      avgHitRate: list.length > 0 ? Math.round(totalHits / list.length * 10) / 10 : 0,
    });
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const deleteEntry = async (id: string) => {
    await supabase.from('llm_cache').delete().eq('id', id);
    setEntries(e => e.filter(x => x.id !== id));
    toast.success('缓存条目已删除');
  };

  const clearExpired = async () => {
    await supabase.from('llm_cache').delete().lt('expires_at', new Date().toISOString());
    toast.success('已清理过期缓存');
    load();
  };

  const filtered = search
    ? entries.filter(e => (ACTION_LABELS[e.action] ?? e.action).includes(search) || e.action.includes(search))
    : entries;

  const maxHits = Math.max(...entries.map(e => e.hit_count), 1);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
            <Database className="w-5 h-5 text-primary shrink-0" />LLM 响应缓存
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            监控 AI 接口缓存命中情况，降低延迟与 Token 消耗
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Badge variant="outline" className="text-xs gap-1 border-primary/40 text-primary">
            <Zap className="w-3 h-3" />P2-N06
          </Badge>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />刷新
          </Button>
          <Button size="sm" variant="outline" onClick={clearExpired} className="text-warning border-warning/40">
            <Trash2 className="w-3.5 h-3.5 mr-1" />清理过期
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Database,    label: '缓存条目',     value: stats.total,                     color: 'text-primary' },
          { icon: Zap,         label: '总命中次数',   value: stats.totalHits.toLocaleString(), color: 'text-success' },
          { icon: TrendingUp,  label: '平均命中次数', value: stats.avgHitRate,                 color: 'text-info' },
          { icon: Hash,        label: '节省 Tokens',  value: `${(stats.tokensSaved / 1000).toFixed(1)}K`, color: 'text-warning' },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Icon className={cn('w-8 h-8 shrink-0', color)} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索缓存动作类型…"
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
        />
      </div>

      {/* 缓存列表 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-balance">缓存条目 <span className="text-muted-foreground font-normal text-sm ml-1">({filtered.length})</span></CardTitle>
          <CardDescription>按命中次数排序，显示最热门的缓存</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 bg-muted" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>暂无缓存数据</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(entry => {
                const isExpired = entry.expires_at && new Date(entry.expires_at) < new Date();
                return (
                  <div key={entry.id} className={cn('p-3 border rounded-lg transition-all', isExpired ? 'opacity-50 bg-muted/30' : 'bg-card')}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <Badge variant="outline" className="text-xs">{ACTION_LABELS[entry.action] ?? entry.action}</Badge>
                          {entry.model && <span className="text-xs text-muted-foreground">{entry.model}</span>}
                          {isExpired && <Badge className="text-xs bg-destructive/10 text-destructive border-destructive/30">已过期</Badge>}
                          {!isExpired && entry.hit_count > 5 && (
                            <Badge className="text-xs bg-success/10 text-success border-success/30">
                              <Zap className="w-2.5 h-2.5 mr-0.5" />热门缓存
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate font-mono">
                          #{entry.prompt_hash?.slice(0, 16)}…
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {entry.response_text?.slice(0, 80)}…
                        </p>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Zap className="w-3 h-3 text-success" />
                            命中 {entry.hit_count} 次
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Hash className="w-3 h-3 text-warning" />
                            省 {entry.tokens_saved ?? 0} tokens
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {new Date(entry.created_at).toLocaleDateString('zh-CN')}
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Progress value={(entry.hit_count / maxHits) * 100} className="h-1 flex-1" />
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => deleteEntry(entry.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
