import { useState, useEffect } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Wand2, Plus, Search, Copy, Trash2, Pencil, Sparkles, Star,
  MoreVertical, BookOpen, Tag, TrendingUp, Film,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── 类型定义 ──────────────────────────────────────────────────────────────
interface PromptTemplate {
  id: string;
  user_id: string | null;
  title: string;
  category: string;
  platform: string;
  content: string;
  variables: Array<{ name: string; label: string }>;
  is_system: boolean;
  use_count: number;
  created_at: string;
}

const CATEGORIES = [
  { value: 'all',       label: '全部',     icon: BookOpen },
  { value: 'hook',      label: '开场钩子', icon: Sparkles },
  { value: 'review',    label: '测评种草', icon: Star },
  { value: 'lifestyle', label: '生活场景', icon: Film },
  { value: 'cta',       label: 'CTA转化',  icon: TrendingUp },
  { value: 'general',   label: '通用',     icon: Tag },
];
const PLATFORMS = ['douyin', 'tiktok', 'all'];
const PLATFORM_LABELS: Record<string, string> = { douyin: '抖音', tiktok: 'TikTok', all: '通用' };
const CATEGORY_COLORS: Record<string, string> = {
  hook:      'bg-warning/10 text-warning',
  review:    'bg-primary/10 text-primary',
  lifestyle: 'bg-success/10 text-success',
  cta:       'bg-destructive/10 text-destructive',
  general:   'bg-muted text-muted-foreground',
};

// ── 变量占位符替换 ─────────────────────────────────────────────────────────
function fillVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] || `{{${k}}}`);
}

// ── 模板卡片 ──────────────────────────────────────────────────────────────
function TemplateCard({
  tpl, onCopy, onEdit, onDelete, onUse,
}: {
  tpl: PromptTemplate;
  onCopy: (t: PromptTemplate) => void;
  onEdit: (t: PromptTemplate) => void;
  onDelete: (id: string) => void;
  onUse: (t: PromptTemplate) => void;
}) {
  const catColor = CATEGORY_COLORS[tpl.category] ?? CATEGORY_COLORS.general;
  const catLabel = CATEGORIES.find(c => c.value === tpl.category)?.label ?? tpl.category;

  return (
    <div className="flex flex-col h-full rounded-2xl border border-border/70 bg-card p-4 gap-3 group hover:border-primary/40 transition-colors">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-balance">{tpl.title}</span>
            {tpl.is_system && (
              <Badge variant="outline" className="text-xs shrink-0 gap-1 border-primary/40 text-primary">
                <Sparkles className="w-2.5 h-2.5" />系统
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', catColor)}>{catLabel}</span>
            <span className="text-xs text-muted-foreground">{PLATFORM_LABELS[tpl.platform] ?? tpl.platform}</span>
            {tpl.use_count > 0 && (
              <span className="text-xs text-muted-foreground">{tpl.use_count} 次使用</span>
            )}
          </div>
        </div>
        {!tpl.is_system && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(tpl)}>
                <Pencil className="w-4 h-4 mr-2" />编辑
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(tpl.id)} className="text-destructive">
                <Trash2 className="w-4 h-4 mr-2" />删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* 内容预览 */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1 text-pretty">
        {tpl.content}
      </p>

      {/* 变量标签 */}
      {tpl.variables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tpl.variables.map(v => (
            <span key={v.name} className="text-xs bg-accent/40 text-accent-foreground px-1.5 py-0.5 rounded font-mono">
              {`{{${v.name}}}`}
            </span>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-auto pt-1">
        <Button variant="outline" size="sm" className="flex-1 h-8" onClick={() => onCopy(tpl)}>
          <Copy className="w-3.5 h-3.5 mr-1.5" />复制
        </Button>
        <Button size="sm" className="flex-1 h-8" onClick={() => onUse(tpl)}>
          <Wand2 className="w-3.5 h-3.5 mr-1.5" />使用
        </Button>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
export default function PromptTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates]   = useState<PromptTemplate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('all');
  const [platFilter, setPlatFilter] = useState('all');

  // 新建/编辑弹框
  const [editOpen, setEditOpen]   = useState(false);
  const [editTpl, setEditTpl]     = useState<PromptTemplate | null>(null);
  const [saving, setSaving]       = useState(false);
  const [form, setForm] = useState({
    title: '', category: 'general', platform: 'douyin', content: '', variablesRaw: '',
  });

  // 使用弹框（变量填写）
  const [useOpen, setUseOpen]         = useState(false);
  const [useTpl, setUseTpl]           = useState<PromptTemplate | null>(null);
  const [varValues, setVarValues]     = useState<Record<string, string>>({});
  const [filledContent, setFilledContent] = useState('');

  // ── 加载 ─────────────────────────────────────────────────────────────────
  const loadTemplates = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('prompt_templates')
      .select('*')
      .or(`is_system.eq.true${user ? `,user_id.eq.${user.id}` : ''}`)
      .order('use_count', { ascending: false });
    setTemplates(Array.isArray(data) ? data as PromptTemplate[] : []);
    setLoading(false);
  };

  useEffect(() => { loadTemplates(); }, [user]);

  // ── 筛选 ─────────────────────────────────────────────────────────────────
  const filtered = templates.filter(t => {
    if (catFilter !== 'all' && t.category !== catFilter) return false;
    if (platFilter !== 'all' && t.platform !== platFilter && t.platform !== 'all') return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) &&
        !t.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ── 复制 ─────────────────────────────────────────────────────────────────
  const handleCopy = (t: PromptTemplate) => {
    navigator.clipboard.writeText(t.content).then(() => toast.success('已复制到剪贴板'));
  };

  // ── 使用（打开变量填写弹框）────────────────────────────────────────────
  const handleUse = (t: PromptTemplate) => {
    setUseTpl(t);
    const defaultVars: Record<string, string> = {};
    t.variables.forEach(v => { defaultVars[v.name] = ''; });
    setVarValues(defaultVars);
    setFilledContent(t.content);
    setUseOpen(true);
    // 累计使用次数
    supabase.from('prompt_templates')
      .update({ use_count: t.use_count + 1 })
      .eq('id', t.id)
      .then(() => {
        setTemplates(prev => prev.map(p => p.id === t.id ? { ...p, use_count: p.use_count + 1 } : p));
      });
  };

  // ── 更新填入后内容 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!useTpl) return;
    setFilledContent(fillVariables(useTpl.content, varValues));
  }, [varValues, useTpl]);

  const handleCopyFilled = () => {
    navigator.clipboard.writeText(filledContent).then(() => {
      toast.success('已复制填写后的 Prompt');
      setUseOpen(false);
    });
  };

  // ── 新建/编辑 ────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditTpl(null);
    setForm({ title: '', category: 'general', platform: 'douyin', content: '', variablesRaw: '' });
    setEditOpen(true);
  };

  const openEdit = (t: PromptTemplate) => {
    setEditTpl(t);
    setForm({
      title: t.title,
      category: t.category,
      platform: t.platform,
      content: t.content,
      variablesRaw: t.variables.map(v => `${v.name}:${v.label}`).join('\n'),
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('请填写模板标题和内容');
      return;
    }
    setSaving(true);
    try {
      const variables = form.variablesRaw
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
          const [name, ...rest] = l.split(':');
          return { name: name.trim(), label: rest.join(':').trim() || name.trim() };
        });

      const payload = {
        title: form.title.trim(),
        category: form.category,
        platform: form.platform,
        content: form.content.trim(),
        variables,
        user_id: user?.id ?? null,
        is_system: false,
      };

      if (editTpl) {
        await supabase.from('prompt_templates').update(payload).eq('id', editTpl.id);
        toast.success('模板已更新');
      } else {
        await supabase.from('prompt_templates').insert(payload);
        toast.success('模板已创建');
      }
      setEditOpen(false);
      loadTemplates();
    } catch { toast.error('保存失败，请重试'); }
    finally { setSaving(false); }
  };

  // ── 删除 ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    await supabase.from('prompt_templates').delete().eq('id', id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    toast.success('已删除');
  };

  const systemCount = templates.filter(t => t.is_system).length;
  const myCount     = templates.filter(t => !t.is_system).length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ── 页头 ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
            <BookOpen className="w-5 h-5 text-primary shrink-0" />Prompt 模板库
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 text-pretty">
            {systemCount} 个系统模板 · {myCount} 个自定义模板，提效 AI 视频脚本生成
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="shrink-0">
          <Plus className="w-4 h-4 mr-1.5" />新建模板
        </Button>
      </div>

      {/* ── 统计卡片 ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '模板总数',   value: templates.length,                                     color: 'bg-primary/10 text-primary' },
          { label: '系统模板',   value: systemCount,                                           color: 'bg-warning/10 text-warning' },
          { label: '自定义',     value: myCount,                                               color: 'bg-success/10 text-success' },
          { label: '总使用次数', value: templates.reduce((s, t) => s + t.use_count, 0),       color: 'bg-accent/50 text-accent-foreground' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-border/70 bg-card px-4 py-3">
            <p className={cn('text-2xl font-bold', s.color.split(' ')[1])}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── 筛选栏 ── */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索模板标题或内容..."
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select value={platFilter} onValueChange={setPlatFilter}>
            <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部平台</SelectItem>
              <SelectItem value="douyin">抖音</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── 品类 Tab ── */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
        {CATEGORIES.map(c => {
          const Icon = c.icon;
          const count = c.value === 'all' ? filtered.length : templates.filter(t => t.category === c.value).length;
          return (
            <button
              key={c.value}
              onClick={() => setCatFilter(c.value)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors shrink-0',
                catFilter === c.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {c.label}
              <span className={cn('text-xs font-normal ml-0.5', catFilter === c.value ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 模板网格 ── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/70 bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-3/4 bg-muted" />
              <Skeleton className="h-3 w-1/3 bg-muted" />
              <Skeleton className="h-16 w-full bg-muted" />
              <div className="flex gap-2">
                <Skeleton className="h-8 flex-1 bg-muted" />
                <Skeleton className="h-8 flex-1 bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">未找到匹配的模板</p>
            <p className="text-sm text-muted-foreground">调整筛选条件，或新建自定义模板</p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1.5" />新建模板
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              tpl={t}
              onCopy={handleCopy}
              onEdit={openEdit}
              onDelete={handleDelete}
              onUse={handleUse}
            />
          ))}
        </div>
      )}

      {/* ── 新建/编辑弹框 ── */}
      <Dialog open={editOpen} onOpenChange={v => { if (!saving) setEditOpen(v); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-balance">
              <Wand2 className="w-4 h-4 text-primary" />
              {editTpl ? '编辑模板' : '新建 Prompt 模板'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-normal text-muted-foreground">模板标题 *</label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="如：美妆开箱强钩子"
                className="px-3"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-normal text-muted-foreground">品类</label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-normal text-muted-foreground">平台</label>
                <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-normal text-muted-foreground">Prompt 内容 *</label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder={`填写 Prompt 模板内容，可用 {{变量名}} 标记动态部分\n如：为{{product_name}}生成一段开场钩子，风格活力青春...`}
                rows={6}
                className="px-3 resize-none text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-normal text-muted-foreground">
                变量定义（可选）
                <span className="ml-2 text-xs text-muted-foreground/60">每行格式：变量名:显示标签</span>
              </label>
              <Textarea
                value={form.variablesRaw}
                onChange={e => setForm(f => ({ ...f, variablesRaw: e.target.value }))}
                placeholder={`product_name:商品名称\ncategory:商品类目`}
                rows={3}
                className="px-3 resize-none text-sm font-mono"
              />
            </div>
            <Separator />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)} disabled={saving}>
                取消
              </Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : editTpl ? '更新模板' : '创建模板'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 使用弹框（变量填写）── */}
      <Dialog open={useOpen} onOpenChange={setUseOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          {useTpl && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-balance">
                  <Wand2 className="w-4 h-4 text-primary" />{useTpl.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* 变量填写 */}
                {useTpl.variables.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">填写变量</p>
                    {useTpl.variables.map(v => (
                      <div key={v.name} className="space-y-1">
                        <label className="text-sm font-normal text-muted-foreground">{v.label}</label>
                        <Input
                          value={varValues[v.name] ?? ''}
                          onChange={e => setVarValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                          placeholder={`请输入${v.label}...`}
                          className="px-3"
                        />
                      </div>
                    ))}
                    <Separator />
                  </div>
                )}
                {/* 预览 */}
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {useTpl.variables.length > 0 ? '填写后预览' : 'Prompt 内容'}
                  </p>
                  <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-sm leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                    {filledContent}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setUseOpen(false)}>取消</Button>
                  <Button className="flex-1" onClick={handleCopyFilled}>
                    <Copy className="w-4 h-4 mr-1.5" />复制并使用
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
