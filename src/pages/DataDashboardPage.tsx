import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart3, TrendingUp, Download, RefreshCw, Video,
  Play, Eye, Heart, Share2, Clock, Sparkles, FileSpreadsheet,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── 类型 ────────────────────────────────────────────────────────────────────
interface VideoProject {
  id: string;
  title: string;
  status: string;
  video_style: string | null;
  duration: number;
  created_at: string;
  predicted_completion_rate: number | null;
  predicted_click_rate: number | null;
}

function fmt(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--destructive))'];

// ─── 主页面 ──────────────────────────────────────────────────────────────────
export default function DataDashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30d');
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState('overview');

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from('video_projects')
      .select('id,title,status,video_style,duration,created_at,predicted_completion_rate,predicted_click_rate')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    setProjects((data ?? []) as VideoProject[]);
    setLoading(false);
  }, [user, range]);

  useEffect(() => { loadData(); }, [loadData]);

  // 计算统计数据
  const total = projects.length;
  const completed = projects.filter(p => p.status === 'completed').length;
  const avgCompletion = projects.filter(p => p.predicted_completion_rate != null).length
    ? Math.round(projects.filter(p => p.predicted_completion_rate != null)
        .reduce((a, p) => a + (p.predicted_completion_rate ?? 0), 0) /
        projects.filter(p => p.predicted_completion_rate != null).length)
    : 0;
  const avgClick = projects.filter(p => p.predicted_click_rate != null).length
    ? +(projects.filter(p => p.predicted_click_rate != null)
        .reduce((a, p) => a + (p.predicted_click_rate ?? 0), 0) /
        projects.filter(p => p.predicted_click_rate != null).length).toFixed(1)
    : 0;

  // 按天统计视频创建趋势
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const trendData = Array.from({ length: Math.min(days, 14) }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (Math.min(days, 14) - 1 - i));
    const label = `${d.getMonth()+1}/${d.getDate()}`;
    const dayProjects = projects.filter(p => new Date(p.created_at).toDateString() === d.toDateString());
    return {
      label,
      创建: dayProjects.length,
      完成: dayProjects.filter(p => p.status === 'completed').length,
    };
  });

  // 风格分布
  const styleMap: Record<string, number> = {};
  projects.forEach(p => { if (p.video_style) styleMap[p.video_style] = (styleMap[p.video_style] ?? 0) + 1; });
  const stylePie = Object.entries(styleMap).map(([name, value]) => ({ name, value }));

  // 时长分布
  const durationBuckets = [
    { label: '≤15s', min: 0,  max: 15  },
    { label: '16-30s',min: 16, max: 30  },
    { label: '31-60s',min: 31, max: 60  },
    { label: '>60s',  min: 61, max: 9999 },
  ].map(b => ({
    label: b.label,
    数量: projects.filter(p => p.duration >= b.min && p.duration <= b.max).length,
  }));

  // 预测分布
  const completionDist = [60,70,75,80,85,90,95].map(threshold => ({
    label: `${threshold}%+`,
    数量: projects.filter(p => (p.predicted_completion_rate ?? 0) >= threshold).length,
  }));

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const { utils, writeFile } = await import('xlsx');
      const rows = projects.map(p => ({
        视频标题: p.title,
        状态: p.status,
        风格: p.video_style ?? '',
        时长: p.duration,
        完播率预测: p.predicted_completion_rate ?? '',
        点击率预测: p.predicted_click_rate ?? '',
        创建时间: new Date(p.created_at).toLocaleString('zh-CN'),
      }));
      const ws = utils.json_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, '视频数据');
      writeFile(wb, `视频数据报表_${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success('Excel 报表已导出');
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* 标题 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />数据看板与报表
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">P3-M05 · 多维度数据分析，支持 Excel 导出</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">近 7 天</SelectItem>
              <SelectItem value="30d">近 30 天</SelectItem>
              <SelectItem value="90d">近 90 天</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => loadData()} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />刷新
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handleExportExcel} disabled={exporting}>
            {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            导出 Excel
          </Button>
        </div>
      </div>

      {/* KPI 卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '视频总数', val: total, icon: Video, color: 'text-primary', bg: 'bg-primary/10', sub: `${range}内` },
          { label: '完成率', val: total ? `${Math.round(completed/total*100)}%` : '—', icon: Play, color: 'text-success', bg: 'bg-success/10', sub: `${completed}/${total} 已完成` },
          { label: '均完播率预测', val: avgCompletion ? `${avgCompletion}%` : '—', icon: Eye, color: 'text-info', bg: 'bg-info/10', sub: '基于AI模型' },
          { label: '均点击率预测', val: avgClick ? `${avgClick}%` : '—', icon: TrendingUp, color: 'text-warning', bg: 'bg-warning/10', sub: '基于AI模型' },
        ].map(m => (
          <Card key={m.label} className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xl md:text-2xl font-bold truncate">{loading ? '…' : m.val}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.label}</p>
                </div>
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', m.bg)}>
                  <m.icon className={cn('w-4 h-4', m.color)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 truncate">{m.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">趋势总览</TabsTrigger>
          <TabsTrigger value="style">风格分析</TabsTrigger>
          <TabsTrigger value="prediction">预测分析</TabsTrigger>
          <TabsTrigger value="ranking">视频排行榜</TabsTrigger>
          <TabsTrigger value="list">明细列表</TabsTrigger>
        </TabsList>

        {/* 趋势总览 */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />视频创建趋势（近{Math.min(days,14)}天）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full min-w-0 overflow-hidden h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend layout="horizontal" wrapperStyle={{ paddingTop: 8 }} />
                    <Area type="monotone" dataKey="创建" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/0.15)" strokeWidth={2} />
                    <Area type="monotone" dataKey="完成" stroke="hsl(var(--success))" fill="hsl(var(--success)/0.1)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">视频时长分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full min-w-0 overflow-hidden h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={durationBuckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="数量" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 风格分析 */}
        <TabsContent value="style" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">风格占比</CardTitle></CardHeader>
              <CardContent>
                <div className="w-full min-w-0 overflow-hidden h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stylePie.length ? stylePie : [{ name: '暂无数据', value: 1 }]}
                        cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>
                        {(stylePie.length ? stylePie : [{ name: '暂无数据', value: 1 }]).map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">各风格视频数</CardTitle></CardHeader>
              <CardContent>
                <div className="w-full min-w-0 overflow-hidden h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stylePie} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 预测分析 */}
        <TabsContent value="prediction" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />完播率预测分布
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full min-w-0 overflow-hidden h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={completionDist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="数量" fill="hsl(var(--info))" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">横轴为完播率预测值阈值，柱高为达到该阈值的视频数</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 视频排行榜 */}
        <TabsContent value="ranking" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 完播率Top10 */}
            <Card className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Eye className="w-4 h-4 text-info" />完播率预测 Top10
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {projects
                  .filter(p => p.predicted_completion_rate != null)
                  .sort((a, b) => (b.predicted_completion_rate ?? 0) - (a.predicted_completion_rate ?? 0))
                  .slice(0, 10)
                  .map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 py-1.5">
                      <span className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                        i < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      )}>{i + 1}</span>
                      <span className="flex-1 min-w-0 text-sm truncate">{p.title}</span>
                      <span className="text-sm font-semibold text-info shrink-0">{p.predicted_completion_rate}%</span>
                    </div>
                  ))}
                {projects.filter(p => p.predicted_completion_rate != null).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>
                )}
              </CardContent>
            </Card>
            {/* 点击率Top10 */}
            <Card className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-warning" />点击率预测 Top10
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {projects
                  .filter(p => p.predicted_click_rate != null)
                  .sort((a, b) => (b.predicted_click_rate ?? 0) - (a.predicted_click_rate ?? 0))
                  .slice(0, 10)
                  .map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 py-1.5">
                      <span className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                        i < 3 ? 'bg-warning text-warning-foreground' : 'bg-muted text-muted-foreground'
                      )}>{i + 1}</span>
                      <span className="flex-1 min-w-0 text-sm truncate">{p.title}</span>
                      <span className="text-sm font-semibold text-warning shrink-0">{p.predicted_click_rate}%</span>
                    </div>
                  ))}
                {projects.filter(p => p.predicted_click_rate != null).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 明细列表 */}
        <TabsContent value="list" className="mt-4">
          <Card>
            <CardContent className="pt-4 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      {['视频标题','风格','时长','完播预测','点击预测','状态','创建时间'].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-muted-foreground pb-2 pr-4 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? [1,2,3].map(i => (
                          <tr key={i}><td colSpan={7} className="py-2"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                        ))
                      : projects.slice(0, 20).map(p => (
                          <tr key={p.id} className="border-b border-border/40 hover:bg-muted/20">
                            <td className="py-2 pr-4 max-w-[160px]"><p className="truncate">{p.title}</p></td>
                            <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{p.video_style ?? '—'}</td>
                            <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{p.duration}s</td>
                            <td className="py-2 pr-4 whitespace-nowrap">{p.predicted_completion_rate != null ? `${p.predicted_completion_rate}%` : '—'}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">{p.predicted_click_rate != null ? `${p.predicted_click_rate}%` : '—'}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">
                              <span className={cn('text-xs font-medium',
                                p.status === 'completed' ? 'text-success' :
                                p.status === 'processing' ? 'text-primary' :
                                p.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                              )}>{p.status}</span>
                            </td>
                            <td className="py-2 whitespace-nowrap text-muted-foreground text-xs">
                              {new Date(p.created_at).toLocaleDateString('zh-CN')}
                            </td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
                {!loading && projects.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm py-12">所选时间范围内暂无数据</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
