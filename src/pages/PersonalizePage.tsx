import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Wand2, RefreshCw, Sparkles, CheckCircle2, Plus, X,
  Sliders, Brain, Copy, RotateCcw, BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── 配置选项 ─────────────────────────────────────────────────────────────────
const STYLE_OPTIONS   = ['活泼轻快','专业权威','温暖亲切','幽默搞笑','简洁干练','情感共鸣'];
const TONE_OPTIONS    = ['口语化','书面化','故事性','问答式','分享式'];
const HOOK_OPTIONS    = ['痛点开场','惊喜反转','数据震惊','故事引入','提问悬念','直接展示'];
const CTA_OPTIONS     = ['限时优惠','点击链接','评论互动','关注领取','直接下单','更多同款'];
const CATEGORY_OPTIONS = ['美妆', '食品', '数码', '服装', '母婴', '家居', '健身', '宠物'];

interface Prefs {
  preferred_styles: string[];
  preferred_tones: string[];
  preferred_hooks: string[];
  cta_patterns: string[];
}

// ─── 多选标签组件 ─────────────────────────────────────────────────────────────
function TagSelector({
  label, options, selected, onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button
            key={opt} type="button"
            onClick={() => toggle(opt)}
            className={cn(
              'text-xs px-3 py-1.5 rounded-full border transition-colors',
              selected.includes(opt)
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border/60 text-muted-foreground hover:bg-muted/40'
            )}
          >
            {selected.includes(opt) && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────
export default function PersonalizePage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>({
    preferred_styles: [],
    preferred_tones: [],
    preferred_hooks: [],
    cta_patterns: [],
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState('prefs');

  // 生成脚本
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState('美妆');
  const [generating, setGenerating] = useState(false);
  const [generatedScript, setGeneratedScript] = useState('');
  const [copiedScript, setCopiedScript] = useState(false);

  const loadPrefs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_style_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      setPrefs({
        preferred_styles: (data.preferred_styles as string[]) ?? [],
        preferred_tones:  (data.preferred_tones as string[]) ?? [],
        preferred_hooks:  (data.preferred_hooks as string[]) ?? [],
        cta_patterns:     (data.cta_patterns as string[]) ?? [],
      });
    }
  }, [user]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke('phase3-assistant', {
        body: { action: 'update_style_preference', ...prefs },
      });
      if (error) { const t = await error.context?.text?.(); throw new Error(t || error.message); }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast.success('个性化偏好已保存！');
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!productName) { toast.error('请输入商品名称'); return; }
    setGenerating(true);
    setGeneratedScript('');
    try {
      const { data, error } = await supabase.functions.invoke('phase3-assistant', {
        body: { action: 'generate_personalized_script', product_name: productName, product_category: productCategory },
      });
      if (error) { const t = await error.context?.text?.(); throw new Error(t || error.message); }
      setGeneratedScript(data.script ?? '');
      if (data.style_applied) toast.success('已根据您的偏好生成个性化脚本！');
      else toast.success('脚本生成完成（尚未设置个性化偏好）');
    } catch (e) {
      toast.error(`生成失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(generatedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
    toast.success('脚本已复制');
  };

  const totalPrefs = Object.values(prefs).flat().length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* 标题 */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />AI 个性化微调
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">P3-S04 · 基于您的创作风格偏好，AI 为您量身定制内容</p>
      </div>

      {/* 偏好完整度 */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Sliders className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">风格偏好设置</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  已设置 <span className="text-primary font-medium">{totalPrefs}</span> 项偏好
                  {totalPrefs === 0 && ' — 设置后 AI 将按您的风格生成内容'}
                </p>
              </div>
            </div>
            <Badge variant={totalPrefs >= 4 ? 'default' : 'secondary'} className="shrink-0">
              {totalPrefs >= 8 ? '完善' : totalPrefs >= 4 ? '基础' : '待完善'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="prefs"><Sliders className="w-3.5 h-3.5 mr-1.5" />偏好设置</TabsTrigger>
          <TabsTrigger value="generate"><Sparkles className="w-3.5 h-3.5 mr-1.5" />个性化生成</TabsTrigger>
          <TabsTrigger value="guide"><BookOpen className="w-3.5 h-3.5 mr-1.5" />使用指南</TabsTrigger>
        </TabsList>

        {/* 偏好设置 */}
        <TabsContent value="prefs" className="mt-4">
          <Card>
            <CardContent className="pt-5 space-y-6 pb-5">
              <TagSelector
                label="内容风格"
                options={STYLE_OPTIONS}
                selected={prefs.preferred_styles}
                onChange={v => setPrefs(p => ({ ...p, preferred_styles: v }))}
              />
              <TagSelector
                label="语言语气"
                options={TONE_OPTIONS}
                selected={prefs.preferred_tones}
                onChange={v => setPrefs(p => ({ ...p, preferred_tones: v }))}
              />
              <TagSelector
                label="常用开场钩子"
                options={HOOK_OPTIONS}
                selected={prefs.preferred_hooks}
                onChange={v => setPrefs(p => ({ ...p, preferred_hooks: v }))}
              />
              <TagSelector
                label="CTA 模式"
                options={CTA_OPTIONS}
                selected={prefs.cta_patterns}
                onChange={v => setPrefs(p => ({ ...p, cta_patterns: v }))}
              />

              <div className="flex items-center gap-2 pt-2">
                <Button
                  className="gap-1.5"
                  onClick={handleSave}
                  disabled={saving || totalPrefs === 0}
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  {saving ? '保存中…' : saved ? '已保存！' : '保存偏好'}
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setPrefs({ preferred_styles: [], preferred_tones: [], preferred_hooks: [], cta_patterns: [] })}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />重置
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 个性化生成 */}
        <TabsContent value="generate" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-primary" />个性化脚本生成
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-normal">商品名称</label>
                  <Input
                    placeholder="例：玻尿酸精华液"
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-normal">商品品类</label>
                  <Select value={productCategory} onValueChange={setProductCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 偏好预览 */}
              {totalPrefs > 0 && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-primary mb-2 flex items-center gap-1">
                    <Brain className="w-3 h-3" />将应用您的个性化偏好
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {Object.values(prefs).flat().slice(0,8).map(t => (
                      <span key={t} className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">{t}</span>
                    ))}
                    {Object.values(prefs).flat().length > 8 && (
                      <span className="text-[10px] text-muted-foreground">+{Object.values(prefs).flat().length - 8}项</span>
                    )}
                  </div>
                </div>
              )}

              <Button className="w-full gap-1.5" onClick={handleGenerate} disabled={generating || !productName}>
                {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generating ? 'AI 生成中…' : '生成个性化脚本'}
              </Button>

              {generatedScript && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">生成结果</p>
                    <Button size="sm" variant="outline" className="gap-1 h-7" onClick={handleCopyScript}>
                      {copiedScript ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedScript ? '已复制' : '复制'}
                    </Button>
                  </div>
                  <Textarea
                    value={generatedScript}
                    readOnly
                    rows={8}
                    className="text-sm resize-none bg-muted/40"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 使用指南 */}
        <TabsContent value="guide" className="mt-4">
          <div className="space-y-3">
            {[
              {
                step: '01', title: '设置创作偏好',
                desc: '在「偏好设置」中选择您习惯的内容风格、语气语调、开场钩子和CTA方式，AI将学习您的个人特色。',
              },
              {
                step: '02', title: '积累历史创作',
                desc: '使用系统创作的脚本越多，AI对您风格的理解越准确。历史创作会作为Few-shot示例融入生成过程。',
              },
              {
                step: '03', title: '一键个性化生成',
                desc: '输入商品信息后点击生成，AI将融合您的偏好和历史风格，创作专属于您的带货脚本，无需反复修改。',
              },
              {
                step: '04', title: '持续迭代优化',
                desc: '您可随时更新偏好设置。系统会基于您的创作历史和交互反馈持续优化推荐效果。',
              },
            ].map(g => (
              <div key={g.step} className="flex items-start gap-4 p-4 rounded-xl border border-border/60 bg-card">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary font-bold text-sm">
                  {g.step}
                </div>
                <div>
                  <p className="text-sm font-semibold">{g.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 text-pretty leading-relaxed">{g.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
