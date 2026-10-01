/**
 * P2-M05: 异步任务队列管理页
 * video_jobs 队列状态 + 重试 + 并发控制 UI
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ListTodo, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Play, AlertTriangle, Trash2, BarChart3, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface VideoJob {
  id: string;
  user_id: string;
  job_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown> | null;
  platform_format: string | null;
  created_at: string;
  updated_at: string;
  project_id?: string;
}

const STATUS_CONFIG = {
  pending:    { label: '等待中', icon: Clock,        cls: 'bg-warning/10 text-warning border-warning/30' },
  processing: { label: '处理中', icon: Loader2,      cls: 'bg-info/10 text-info border-info/30' },
  completed:  { label: '已完成', icon: CheckCircle2, cls: 'bg-success/10 text-success border-success/30' },
  failed:     { label: '已失败', icon: XCircle,      cls: 'bg-destructive/10 text-destructive border-destructive/30' },
};

const JOB_TYPE_LABELS: Record<string, string> = {
  video_generate:   '视频生成',
  highlight_extract:'高光提取',
  cover_gen:        '封面生成',
  script_gen:       '脚本生成',
};

function JobRow({ job, onRetry, onDelete }: { job: VideoJob; onRetry: (id: string, pid?: string) => void; onDelete: (id: string) => void }) {
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const projectId = (job.input_data?.project_id as string) ?? job.project_id ?? undefined;

  return (
    <div className={cn('p-4 border rounded-lg transition-all', job.status === 'processing' ? 'border-info/40 bg-info/5' : 'border-border bg-card')}>
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0', cfg.cls)}>
          <StatusIcon className={cn('w-3.5 h-3.5', job.status === 'processing' && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-sm">{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</span>
            <Badge className={cn('text-xs px-1.5 py-0 border', cfg.cls)}>{cfg.label}</Badge>
            {job.attempts > 0 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                重试 {job.attempts}/{job.max_attempts}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            创建：{new Date(job.created_at).toLocaleString('zh-CN')}
            {job.next_retry_at && job.status === 'failed' && (
              <span className="ml-2 text-warning">下次重试：{new Date(job.next_retry_at).toLocaleTimeString('zh-CN')}</span>
            )}
          </p>
          {job.status === 'processing' && (
            <div className="mt-2">
              <Progress value={65} className="h-1" />
            </div>
          )}
          {job.status === 'failed' && !!(job.output_data?.error) && (
            <p className="text-xs text-destructive mt-1 truncate">错误：{String(job.output_data!.error)}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {job.status === 'failed' && job.attempts < job.max_attempts && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onRetry(job.id, projectId)}>
              <Play className="w-3 h-3" />重试
            </Button>
          )}
          {(job.status === 'completed' || job.status === 'failed') && (
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(job.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaskQueuePage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | VideoJob['status']>('all');
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const query = supabase
      .from('video_jobs')
      .select('id, user_id, job_type, status, attempts, max_attempts, next_retry_at, input_data, output_data, created_at, updated_at, platform_format')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    const { data } = await query;
    setJobs(Array.isArray(data) ? (data as VideoJob[]) : []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime 订阅
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('video_jobs_queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_jobs', filter: `user_id=eq.${user.id}` },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const handleRetry = async (jobId: string, projectId?: string) => {
    setRetrying(jobId);
    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'retry_video_job', job_id: jobId, project_id: projectId ?? '', user_id: user?.id ?? '' },
      });
      if (error) throw error;
      const result = data?.data ?? data;
      toast.success(`已重新提交（第 ${result?.attempts} 次）`);
      load();
    } catch (e) {
      toast.error('重试失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('video_jobs').delete().eq('id', id);
    setJobs(j => j.filter(job => job.id !== id));
    toast.success('已删除任务记录');
  };

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
  const counts = {
    all: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    processing: jobs.filter(j => j.status === 'processing').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
            <ListTodo className="w-5 h-5 text-primary shrink-0" />任务队列
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            管理视频生成、脚本创作等异步任务，支持失败重试
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs gap-1 border-primary/40 text-primary">
            <BarChart3 className="w-3 h-3" />P2-M05
          </Badge>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />刷新
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { key: 'processing', label: '运行中', color: 'text-info', icon: Loader2 },
          { key: 'pending',    label: '等待中', color: 'text-warning', icon: Clock },
          { key: 'completed',  label: '已完成', color: 'text-success', icon: CheckCircle2 },
          { key: 'failed',     label: '已失败', color: 'text-destructive', icon: XCircle },
        ].map(({ key, label, color, icon: Icon }) => (
          <Card key={key} className={cn('cursor-pointer hover:shadow-sm transition-all', filter === key && 'ring-2 ring-primary')} onClick={() => setFilter(key as VideoJob['status'])}>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Icon className={cn('w-7 h-7 shrink-0', color, key === 'processing' && 'animate-spin')} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{counts[key as keyof typeof counts]}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 并发限制说明 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
        <Zap className="w-4 h-4 shrink-0 text-warning" />
        <span>当前并发上限：<strong className="text-foreground">3</strong> 个视频任务 · 失败自动重试最多 <strong className="text-foreground">3</strong> 次（指数退避）</span>
      </div>

      {/* 过滤 Tab */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {([['all', '全部'], ['pending', '等待'], ['processing', '运行中'], ['completed', '完成'], ['failed', '失败']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0',
              filter === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            <span className="ml-1.5 text-xs">({counts[key]})</span>
          </button>
        ))}
      </div>

      {/* 任务列表 */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 bg-muted" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ListTodo className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">暂无{filter === 'all' ? '' : STATUS_CONFIG[filter]?.label}任务</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(job => (
            <JobRow
              key={job.id}
              job={job}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
