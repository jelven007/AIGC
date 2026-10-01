/**
 * P2-N03: 智能封面候选组件
 * 可嵌入 WorksPage / 视频详情，调用 image-generation-advanced
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  ImageIcon, Sparkles, Loader2, CheckCircle2, RefreshCw, Download,
  Layers, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CoverCandidate {
  id: string;
  project_id: string;
  image_url: string;
  task_id: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  is_selected: boolean;
  style_prompt: string | null;
  created_at: string;
}

interface Props {
  projectId: string;
  projectTitle?: string;
}

const COVER_STYLES = [
  { id: 'product_close',   label: '产品特写',  prompt: '产品近景特写，高清电商风格，白色背景，专业打光' },
  { id: 'lifestyle',       label: '生活方式',  prompt: '场景化使用展示，温馨生活气息，自然采光' },
  { id: 'contrast_before', label: '对比冲击',  prompt: '使用前后对比，视觉冲击感强，清晰对比展示效果' },
  { id: 'text_headline',   label: '文字钩子',  prompt: '大字报风格封面，醒目标题文字，品牌色调' },
];

export default function CoverCandidates({ projectId, projectTitle }: Props) {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<CoverCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState('product_close');
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());

  const loadCandidates = useCallback(async () => {
    const { data } = await supabase
      .from('cover_candidates')
      .select('id, project_id, image_url, task_id, status, is_selected, style_prompt, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(12);
    setCandidates(Array.isArray(data) ? (data as CoverCandidate[]) : []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  // 轮询处理中的任务
  useEffect(() => {
    const processing = candidates.filter(c => c.status === 'processing' && c.task_id);
    if (processing.length === 0) return;
    const ids = new Set(processing.map(c => c.id));
    setPollingIds(ids);

    const interval = setInterval(async () => {
      for (const cand of processing) {
        if (!cand.task_id) continue;
        const { data } = await supabase.functions.invoke('ai-assistant', {
          body: { action: 'query_cover_task', task_id: cand.task_id, cover_id: cand.id },
        });
        const result = data?.data ?? data;
        if (result?.status === 'completed') {
          await supabase.from('cover_candidates')
            .update({ status: 'completed', image_url: result.image_url })
            .eq('id', cand.id);
          setCandidates(prev => prev.map(c =>
            c.id === cand.id ? { ...c, status: 'completed', image_url: result.image_url } : c
          ));
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [candidates.filter(c => c.status === 'processing').length]);

  const handleGenerate = async () => {
    if (!user) { toast.error('请先登录'); return; }
    const style = COVER_STYLES.find(s => s.id === selectedStyle);
    if (!style) return;
    setGenerating(true);
    try {
      const prompt = `${projectTitle ? `【${projectTitle}】` : ''}带货视频封面，${style.prompt}，竖屏9:16比例`;
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'generate_cover', project_id: projectId, prompt, user_id: user.id },
      });
      if (error) throw error;
      const result = data?.data ?? data;
      toast.success('封面生成任务已提交，稍后自动刷新');
      await loadCandidates();
    } catch (e) {
      toast.error('生成失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setGenerating(false);
    }
  };

  const handleSelect = async (id: string) => {
    // 取消其他选中
    await supabase.from('cover_candidates').update({ is_selected: false }).eq('project_id', projectId);
    await supabase.from('cover_candidates').update({ is_selected: true }).eq('id', id);
    setCandidates(prev => prev.map(c => ({ ...c, is_selected: c.id === id })));
    const selected = candidates.find(c => c.id === id);
    if (selected?.image_url) {
      await supabase.from('video_projects').update({ thumbnail_url: selected.image_url }).eq('id', projectId);
    }
    toast.success('已设置为视频封面');
  };

  const handleDownload = (url: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = `cover-${Date.now()}.jpg`; a.click();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2 text-balance">
              <ImageIcon className="w-4 h-4 text-primary shrink-0" />智能封面候选
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">AI 生成多种风格封面，点击选为正式封面</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs shrink-0 border-primary/40 text-primary">P2-N03</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 风格选择 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">封面风格</p>
          <div className="grid grid-cols-2 gap-1.5">
            {COVER_STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedStyle(s.id)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs border transition-all text-left',
                  selectedStyle === s.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border hover:bg-muted'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 生成按钮 */}
        <Button onClick={handleGenerate} disabled={generating} className="w-full" size="sm">
          {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {generating ? '生成中…' : '生成封面候选'}
        </Button>

        {/* 候选列表 */}
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="aspect-[9/16] bg-muted rounded-lg" />)}
          </div>
        ) : candidates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
            <Layers className="w-7 h-7 mx-auto mb-2 opacity-30" />
            <p>暂无封面候选，点击上方按钮生成</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {candidates.map(c => (
              <div key={c.id} className={cn('relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer group aspect-[9/16]',
                c.is_selected ? 'border-success' : 'border-transparent hover:border-primary/50'
              )}>
                {c.status === 'completed' && c.image_url ? (
                  <img src={c.image_url} alt="封面候选" className="w-full h-full object-cover" />
                ) : c.status === 'processing' || c.status === 'pending' ? (
                  <div className="w-full h-full bg-muted flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                    <span className="text-xs text-muted-foreground">生成中</span>
                  </div>
                ) : (
                  <div className="w-full h-full bg-muted/50 flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                {c.is_selected && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-success flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success-foreground" />
                  </div>
                )}
                {c.status === 'completed' && c.image_url && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2">
                    <Button
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={() => handleSelect(c.id)}
                    >
                      <Star className="w-3 h-3 mr-1" />{c.is_selected ? '已选' : '选为封面'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full h-7 text-xs border border-white/40 text-white hover:bg-white/10"
                      onClick={() => handleDownload(c.image_url!)}
                    >
                      <Download className="w-3 h-3 mr-1" />下载
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {candidates.length > 0 && (
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={loadCandidates}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />刷新状态
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
