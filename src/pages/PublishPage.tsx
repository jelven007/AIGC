import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Send, Plus, Trash2, RefreshCw, Globe, CheckCircle2,
  Clock, AlertTriangle, Calendar, Eye, Video,
  TrendingUp, Share2, ExternalLink, Zap, Loader2, Shield, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── 类型 ────────────────────────────────────────────────────────────────────
type PublishPlatform = 'douyin' | 'tiktok' | 'xiaohongshu' | 'kuaishou' | 'bilibili';
type TaskStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

interface VideoProject {
  id: string;
  title: string;
  status: string;
}

interface PublishTask {
  id: string;
  project_id: string;
  platform: PublishPlatform;
  title: string | null;
  description: string | null;
  tags: string[];
  status: TaskStatus;
  scheduled_at: string | null;
  published_at: string | null;
  platform_url: string | null;
  error_message: string | null;
  created_at: string;
}

const PLATFORM_CONFIG: Record<PublishPlatform, { label: string; color: string; icon: string }> = {
  douyin:       { label: '抖音',   color: 'bg-[#fe2c55]/15 text-[#fe2c55]', icon: '🎵' },
  tiktok:       { label: 'TikTok', color: 'bg-black/10 text-foreground',    icon: '🎵' },
  xiaohongshu:  { label: '小红书', color: 'bg-[#ff2442]/15 text-[#ff2442]', icon: '📕' },
  kuaishou:     { label: '快手',   color: 'bg-[#ff6600]/15 text-[#ff6600]', icon: '⚡' },
  bilibili:     { label: 'B站',    color: 'bg-[#00a1d6]/15 text-[#00a1d6]', icon: '📺' },
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  draft:       { label: '草稿',   color: 'text-muted-foreground' },
  scheduled:   { label: '定时',   color: 'text-warning' },
  publishing:  { label: '发布中', color: 'text-primary' },
  published:   { label: '已发布', color: 'text-success' },
  failed:      { label: '失败',   color: 'text-destructive' },
};

// ─── 主页面 ──────────────────────────────────────────────────────────────────
export default function PublishPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [form, setForm] = useState({
    project_id: '',
    platforms: [] as PublishPlatform[],
    title: '',
    description: '',
    tags: '',
    scheduled_at: '',
  });
  const [creating, setCreating] = useState(false);

  // 平台授权状态（持久化到 localStorage）
  const [authStates, setAuthStates] = useState<Record<PublishPlatform, 'pending' | 'authorized' | 'expired'>>(() => {
    try {
      const saved = localStorage.getItem('platform_auth');
      return saved ? JSON.parse(saved) : {
        douyin: 'pending', tiktok: 'pending', xiaohongshu: 'pending',
        kuaishou: 'pending', bilibili: 'pending',
      };
    } catch {
      return { douyin: 'pending', tiktok: 'pending', xiaohongshu: 'pending', kuaishou: 'pending', bilibili: 'pending' };
    }
  });
  const [authLoading, setAuthLoading] = useState<Record<PublishPlatform, boolean>>({
    douyin: false, tiktok: false, xiaohongshu: false, kuaishou: false, bilibili: false,
  });

  const persistAuth = (next: Record<PublishPlatform, 'pending' | 'authorized' | 'expired'>) => {
    localStorage.setItem('platform_auth', JSON.stringify(next));
    setAuthStates(next);
  };

  const handleAuthorize = async (platform: PublishPlatform) => {
    setAuthLoading(prev => ({ ...prev, [platform]: true }));
    try {
      // 模拟 OAuth 授权流程（实际场景应跳转到平台授权页）
      await new Promise(r => setTimeout(r, 1500));
      // 随机模拟：80% 成功率
      const success = Math.random() > 0.2;
      if (success) {
        persistAuth({ ...authStates, [platform]: 'authorized' });
        toast.success(`${PLATFORM_CONFIG[platform].label} 授权成功`);
      } else {
        persistAuth({ ...authStates, [platform]: 'expired' });
        toast.error(`${PLATFORM_CONFIG[platform].label} 授权失败，请稍后重试`);
      }
    } finally {
      setAuthLoading(prev => ({ ...prev, [platform]: false }));
    }
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('publish_tasks').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('video_projects').select('id,title,status').eq('user_id', user.id).eq('status', 'completed').order('created_at', { ascending: false }).limit(30),
    ]);
    setTasks((t ?? []) as PublishTask[]);
    setProjects((p ?? []) as VideoProject[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateTasks = async () => {
    if (!form.project_id || form.platforms.length === 0) {
      toast.error('请选择视频和至少一个平台');
      return;
    }
    setCreating(true);
    try {
      for (const platform of form.platforms) {
        const { error } = await supabase.functions.invoke('phase3-assistant', {
          body: {
            action: 'create_publish_task',
            project_id: form.project_id,
            platform,
            title: form.title || null,
            description: form.description || null,
            tags: form.tags ? form.tags.split(/[,，\s]+/).filter(Boolean) : [],
            scheduled_at: form.scheduled_at || null,
          },
        });
        if (error) { const t = await error.context?.text?.(); throw new Error(t || error.message); }
      }
      toast.success(`已创建 ${form.platforms.length} 个发布任务`);
      setCreateOpen(false);
      setForm({ project_id: '', platforms: [], title: '', description: '', tags: '', scheduled_at: '' });
      await loadData();
    } catch (e) {
      toast.error(`创建失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async (taskId: string) => {
    setPublishing(taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'publishing' } : t));
    try {
      const { error } = await supabase.functions.invoke('phase3-assistant', {
        body: { action: 'publish_video', task_id: taskId },
      });
      if (error) { const t = await error.context?.text?.(); throw new Error(t || error.message); }
      toast.success('视频已发布成功！');
      await loadData();
    } catch (e) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'failed' } : t));
      toast.error(`发布失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setPublishing(null);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('publish_tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
    toast.success('发布任务已删除');
  };

  const togglePlatform = (platform: PublishPlatform) => {
    setForm(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter(p => p !== platform)
        : [...prev.platforms, platform],
    }));
  };

  const published = tasks.filter(t => t.status === 'published').length;
  const scheduled = tasks.filter(t => t.status === 'scheduled').length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />跨平台一键分发
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">P3-S01 · 抖音 · 快手 · 小红书 · B站 · TikTok 同步发布</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />创建发布任务
        </Button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '总任务', val: tasks.length, icon: Share2, color: 'text-primary', bg: 'bg-primary/10' },
          { label: '已发布', val: published, icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
          { label: '待发布', val: tasks.filter(t => t.status === 'draft').length, icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted' },
          { label: '定时中', val: scheduled, icon: Calendar, color: 'text-warning', bg: 'bg-warning/10' },
        ].map(m => (
          <Card key={m.label} className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', m.bg)}>
                <m.icon className={cn('w-5 h-5', m.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">{m.val}</p>
                <p className="text-xs text-muted-foreground truncate">{m.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 平台授权状态 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">平台授权状态</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(Object.entries(PLATFORM_CONFIG) as [PublishPlatform, typeof PLATFORM_CONFIG[PublishPlatform]][]).map(([key, cfg]) => {
              const state = authStates[key];
              const isLoading = authLoading[key];
              return (
                <div key={key} className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all',
                  state === 'authorized' ? 'border-success/40 bg-success/5' : 'border-border/60'
                )}>
                  <span className="text-2xl">{cfg.icon}</span>
                  <p className="text-xs font-medium">{cfg.label}</p>
                  {state === 'authorized' ? (
                    <Badge className="text-[10px] bg-success/10 text-success border-success/30 border gap-1">
                      <Shield className="w-2.5 h-2.5" />已授权
                    </Badge>
                  ) : state === 'expired' ? (
                    <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 gap-1">
                      <XCircle className="w-2.5 h-2.5" />授权失效
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/60">
                      待授权
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant={state === 'authorized' ? 'outline' : 'default'}
                    className={cn('h-7 text-xs w-full', state === 'authorized' && 'border-success/40 text-success hover:bg-success/10')}
                    onClick={() => handleAuthorize(key)}
                    disabled={isLoading || state === 'authorized'}
                  >
                    {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : state === 'authorized' ? '已连接' : state === 'expired' ? '重新授权' : '授权'}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 任务列表 */}
      <div className="space-y-2">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)
        ) : tasks.length === 0 ? (
          <div className="text-center py-16">
            <Globe className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">还没有发布任务，选择一个已完成的视频开始发布</p>
            <Button className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />创建发布任务
            </Button>
          </div>
        ) : tasks.map(task => {
          const platCfg = PLATFORM_CONFIG[task.platform];
          const statusCfg = STATUS_CONFIG[task.status];
          return (
            <div key={task.id} className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-card hover:bg-muted/20 transition-colors">
              <span className="text-xl shrink-0">{platCfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', platCfg.color)}>{platCfg.label}</span>
                  <p className="text-sm font-medium truncate">{task.title ?? '视频标题待填'}</p>
                  <span className={cn('text-xs font-medium', statusCfg.color)}>{statusCfg.label}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  {task.scheduled_at && (
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-3 h-3" />
                      定时：{new Date(task.scheduled_at).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
                    </span>
                  )}
                  {task.published_at && (
                    <span className="flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3 text-success" />
                      {new Date(task.published_at).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                  {task.tags.length > 0 && task.tags.slice(0,3).map(t => (
                    <span key={t} className="bg-muted px-1.5 py-0.5 rounded-full">#{t}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {task.platform_url && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild>
                    <a href={task.platform_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </Button>
                )}
                {(task.status === 'draft' || task.status === 'failed') && (
                  <Button
                    size="sm" className="h-7 text-xs gap-1"
                    onClick={() => handlePublish(task.id)}
                    disabled={publishing === task.id}
                  >
                    {publishing === task.id
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : <Send className="w-3 h-3" />}
                    发布
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(task.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 创建任务弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader><DialogTitle>创建发布任务</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <label className="text-sm font-normal">选择视频</label>
              <Select value={form.project_id} onValueChange={v => setForm(p => ({ ...p, project_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="选择已完成的视频…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0
                    ? <SelectItem value="none" disabled>暂无已完成的视频</SelectItem>
                    : projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-normal">发布平台（可多选）</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(PLATFORM_CONFIG) as [PublishPlatform, typeof PLATFORM_CONFIG[PublishPlatform]][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePlatform(key)}
                    className={cn(
                      'flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-colors',
                      form.platforms.includes(key)
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/60 hover:bg-muted/40'
                    )}
                  >
                    <span>{cfg.icon}</span>{cfg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-normal">发布标题（选填）</label>
              <Input placeholder="覆盖视频默认标题" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-normal">简介（选填）</label>
              <Textarea rows={2} placeholder="视频描述、活动信息…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="resize-none" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-normal">标签（逗号分隔）</label>
              <Input placeholder="口红,美妆,限时特价" value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-normal">定时发布（选填）</label>
              <Input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(p => ({ ...p, scheduled_at: e.target.value }))} />
            </div>

            <Button className="w-full gap-1.5" onClick={handleCreateTasks} disabled={creating}>
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? '创建中…' : `创建 ${form.platforms.length || ''} 个发布任务`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
