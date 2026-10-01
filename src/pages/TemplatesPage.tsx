import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { VideoTemplate } from '@/types/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Film, Search, Play, Eye, Zap, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const INDUSTRIES = ['全部', '电商', '教育', '金融', '美妆', '其他'];
const SCENES = ['全部场景', '产品介绍', '节日促销', '课程推广', '品牌宣传', '开箱测评'];

const INDUSTRY_COLORS: Record<string, string> = {
  '电商': 'bg-primary/10 text-primary',
  '教育': 'bg-info/10 text-info',
  '金融': 'bg-success/10 text-success',
  '美妆': 'bg-warning/10 text-warning',
  '其他': 'bg-muted text-muted-foreground',
};

function TemplateCard({ template, onPreview, onUse }: {
  template: VideoTemplate;
  onPreview: (t: VideoTemplate) => void;
  onUse: (t: VideoTemplate) => void;
}) {
  return (
    <Card className="h-full flex flex-col group card-hover overflow-hidden">
      {/* 缩略图 */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        {template.thumbnail
          ? <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          : <div className="w-full h-full flex items-center justify-center flex-col gap-2">
              <Film className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">暂无缩略图</p>
            </div>
        }
        {/* 悬浮预览按钮 */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <Button size="sm" variant="ghost" className="h-9 rounded-full border border-white/60 text-white hover:bg-white/10"
            onClick={() => onPreview(template)}>
            <Eye className="w-4 h-4 mr-1.5" />预览
          </Button>
        </div>
        {/* 时长标签 */}
        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
          <Clock className="w-3 h-3" />{template.duration}s
        </div>
        {/* 行业标签 */}
        <div className="absolute top-2 left-2">
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', INDUSTRY_COLORS[template.industry] ?? INDUSTRY_COLORS['其他'])}>
            {template.industry}
          </span>
        </div>
      </div>

      <CardContent className="p-3 flex flex-col flex-1 gap-2">
        <p className="text-sm font-semibold truncate" title={template.name}>{template.name}</p>
        <p className="text-xs text-muted-foreground">{template.scene}</p>
        <div className="flex flex-wrap gap-1">
          {template.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          已使用 <span className="font-semibold text-foreground">{template.use_count.toLocaleString()}</span> 次
        </p>
        <div className="flex gap-2 mt-auto pt-1">
          <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" onClick={() => onPreview(template)}>
            <Eye className="w-3 h-3 mr-1" />预览
          </Button>
          <Button size="sm" className="h-8 flex-1 text-xs" onClick={() => onUse(template)}>
            <Zap className="w-3 h-3 mr-1" />使用
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<VideoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('全部');
  const [scene, setScene] = useState('全部场景');
  const [previewTemplate, setPreviewTemplate] = useState<VideoTemplate | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('video_templates')
        .select('*')
        .eq('is_active', true)
        .order('use_count', { ascending: false });
      setTemplates(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, []);

  const filtered = templates.filter(t => {
    const q = search.toLowerCase();
    if (q && !t.name.toLowerCase().includes(q) && !t.tags.some(g => g.toLowerCase().includes(q))) return false;
    if (industry !== '全部' && t.industry !== industry) return false;
    if (scene !== '全部场景' && t.scene !== scene) return false;
    return true;
  });

  const handleUse = (t: VideoTemplate) => {
    navigate(`/video/create?templateId=${t.id}`);
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* 页头 */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
          <Film className="w-5 h-5 text-primary" />视频模板库
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">精选高转化视频模板，一键套用即可生成带货视频</p>
      </div>

      {/* 搜索 */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="搜索模板名称或标签..." className="pl-9 px-3" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* 行业分类导航 */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">按行业</p>
        <div className="flex gap-2 flex-wrap">
          {INDUSTRIES.map(ind => (
            <button key={ind} onClick={() => setIndustry(ind)}
              className={cn('px-4 py-2 rounded-full text-sm font-medium border transition-all',
                industry === ind
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'border-border hover:border-primary/50 text-muted-foreground hover:text-foreground')}>
              {ind}
            </button>
          ))}
        </div>
      </div>

      {/* 场景分类导航 */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">按场景</p>
        <div className="flex gap-2 flex-wrap">
          {SCENES.map(s => (
            <button key={s} onClick={() => setScene(s)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                scene === s
                  ? 'bg-secondary text-secondary-foreground border-border font-semibold'
                  : 'border-border/50 text-muted-foreground hover:text-foreground hover:border-border')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 结果数量 */}
      {!loading && (
        <p className="text-xs text-muted-foreground">共找到 <span className="font-semibold text-foreground">{filtered.length}</span> 个模板</p>
      )}

      {/* 模板网格 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Film className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">暂无匹配模板</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(t => (
            <TemplateCard key={t.id} template={t} onPreview={setPreviewTemplate} onUse={handleUse} />
          ))}
        </div>
      )}

      {/* 预览弹窗 */}
      <Dialog open={!!previewTemplate} onOpenChange={v => !v && setPreviewTemplate(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          {previewTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="text-balance">{previewTemplate.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* 缩略图全屏预览 */}
                <div className="aspect-video overflow-hidden rounded-xl bg-muted">
                  {previewTemplate.thumbnail
                    ? <img src={previewTemplate.thumbnail} alt={previewTemplate.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><Film className="w-12 h-12 text-muted-foreground/30" /></div>
                  }
                </div>
                {/* 模板信息 */}
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{previewTemplate.industry}</Badge>
                    <Badge variant="outline">{previewTemplate.scene}</Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />{previewTemplate.duration}秒
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {previewTemplate.tags.map(tag => (
                      <span key={tag} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    已被使用 <span className="font-semibold text-foreground">{previewTemplate.use_count.toLocaleString()}</span> 次
                  </p>
                </div>

                {previewTemplate.preview_video ? (
                  <video src={previewTemplate.preview_video} controls className="w-full rounded-xl" />
                ) : (
                  <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                    {/* 模板预览图区域 */}
                    <div className="relative aspect-video bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      {previewTemplate.thumbnail ? (
                        <img src={previewTemplate.thumbnail} alt={previewTemplate.name} className="w-full h-full object-cover opacity-90" />
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <Film className="w-10 h-10 text-muted-foreground/30" />
                          <span className="text-xs text-muted-foreground">模板预览</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                          <span className="text-[10px] text-white/90 font-medium">AI 预览生成</span>
                        </div>
                        <span className="text-[10px] text-white/70">{previewTemplate.duration}秒 · {INDUSTRY_COLORS[previewTemplate.industry]?.split(' ')[1]?.replace('text-', '') || '模板'}</span>
                      </div>
                    </div>
                    {/* 操作栏 */}
                    <div className="p-3 flex items-center gap-2 border-t border-border/30">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs gap-1.5"
                        onClick={() => toast.info('正在生成预览视频，请稍候...')}
                      >
                        <Play className="w-3 h-3" />生成预览
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-muted-foreground gap-1.5"
                        onClick={() => { navigate(`/video/create?templateId=${previewTemplate.id}`); setPreviewTemplate(null); }}
                      >
                        <Zap className="w-3 h-3" />直接使用
                      </Button>
                    </div>
                  </div>
                )}

                <Button className="w-full" onClick={() => { navigate(`/video/create?templateId=${previewTemplate.id}`); setPreviewTemplate(null); }}>
                  <Zap className="w-4 h-4 mr-2" />使用此模板
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
