import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { platformRequest } from '@/api/platforms';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { RefreshCw, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
interface Metrics { id: string; publish_task_id: string; platform: string; video_id: string; view_count: number | null;
  like_count: number | null; comment_count: number | null; share_count: number | null; collected_at: string; source: string }
export default function DataFeedbackPage() {
  const [params] = useSearchParams(), projectId = params.get('projectId');
  const [data, setData] = useState<Metrics[]>([]);
  const [platform, setPlatform] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncIssues, setSyncIssues] = useState<string[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await platformRequest('platform-publish', { action: 'metrics' });
      const tasks = await platformRequest('platform-publish', { action: 'list' });
      const allowed = new Set(tasks.tasks.filter((task: any) => !projectId || task.project_id === projectId).map((task: any) => task.id));
      setSyncIssues(tasks.tasks.filter((task: any) => allowed.has(task.id) && task.metrics_error)
        .map((task: any) => `${task.platform} · ${task.title || task.id}：${task.metrics_error}`));
      setData(result.metrics.filter((item: Metrics) => allowed.has(item.publish_task_id))); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '指标读取失败'); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  const sync = async () => {
    setSyncing(true);
    try {
      const result = await platformRequest('platform-publish', { action: 'sync' });
      toast.info(`已更新 ${result.collected} 条官方指标`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '同步失败'); }
    finally { setSyncing(false); }
  };
  const shown = data.filter(item => platform === 'all' || item.platform === platform);
  const count = (field: 'view_count' | 'like_count' | 'comment_count' | 'share_count') => {
    const values = shown.map(item => item[field]).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0).toLocaleString() : '—';
  };
  return <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <div className="flex flex-wrap justify-between items-start gap-4"><div><h1 className="text-2xl font-semibold flex gap-2 items-center"><BarChart3 className="h-5 w-5" />发布数据回流</h1><p className="text-sm text-muted-foreground mt-2">来自已授权平台官方 API 的累计视频指标，显示最后一次成功采集结果。</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link to="/publish">管理平台授权</Link></Button><Button disabled={syncing} onClick={() => void sync()}><RefreshCw className="h-4 w-4 mr-2" />{syncing ? '同步中…' : '同步官方数据'}</Button></div></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {syncIssues.length > 0 && <div role="status" className="border border-border rounded-xl p-4 text-sm space-y-2">
      <p className="font-medium">以下视频尚未取得最新指标</p>{syncIssues.map(issue => <p key={issue} className="text-muted-foreground">{issue}</p>)}
    </div>}
    <label className="flex gap-3 items-center text-sm">平台<select value={platform} onChange={event => setPlatform(event.target.value)} className="h-10 border border-input rounded-md px-3 bg-background"><option value="all">全部</option><option value="tiktok">TikTok</option><option value="douyin">抖音</option></select></label>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{(['view_count', 'like_count', 'comment_count', 'share_count'] as const).map((field, index) => <div key={field} className="border border-border rounded-xl bg-card p-5"><p className="text-sm text-muted-foreground">{['播放量', '点赞', '评论', '分享'][index]}</p><p className="text-2xl font-semibold mt-2">{count(field)}</p></div>)}</div>
    <p className="text-sm text-muted-foreground">缺失指标显示「—」。曝光、点击、转化、广告消耗与营收需要对应广告/电商权限，不从播放量推算。</p>
    {loading ? <p role="status" className="py-10 text-sm text-muted-foreground">正在读取指标…</p> : !shown.length ? <div className="border border-dashed rounded-xl text-center py-12"><p className="text-sm text-muted-foreground">尚无官方采集结果。先授权账号、完成公开发布并同步数据。</p></div> : <>
      <div className="h-64 border border-border bg-card rounded-xl p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={shown.map(item => ({ name: `${item.platform} ${item.video_id.slice(-6)}`, 播放量: item.view_count }))}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="播放量" fill="hsl(var(--primary))" /></BarChart></ResponsiveContainer></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-border">{['平台 / 视频', '播放', '点赞', '评论', '分享', '最后采集'].map(label => <th key={label} className="py-3 px-2 font-medium">{label}</th>)}</tr></thead><tbody>{shown.map(item => <tr key={item.id} className="border-b border-border"><td className="py-3 px-2">{item.platform} · {item.video_id}</td>{(['view_count', 'like_count', 'comment_count', 'share_count'] as const).map(field => <td key={field} className="py-3 px-2">{item[field]?.toLocaleString() ?? '—'}</td>)}<td className="py-3 px-2 whitespace-nowrap">{new Date(item.collected_at).toLocaleString()}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
