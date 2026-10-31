import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { saveScriptDraft, saveScriptKnowledge, pendingScriptWrites, recoverScriptWrites } from '@/api/scriptDrafts';
import { useAuth } from '@/contexts/AuthContext';
import { useDraft } from '@/hooks/useDraft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Wand2, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp,
  Copy, CheckCircle2, BookOpen, Sparkles, Clock, Video,
  MessageSquare, Send, StopCircle, Loader2, Mic,
  Target, Heart, Zap, ShoppingCart, ChevronRight,
  AlertTriangle, Package, Info, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { sendDeepSeekStreamRequest } from '@/lib/sse';
import type { ScriptScene, Script } from '@/types/types';

// ── 四层Prompt工程配置 ────────────────────────────────────────────────────────
const FOUR_LAYER_STEPS = [
  {
    key: 'selling_point',
    label: '卖点提炼',
    icon: Target,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
    desc: '从商品信息提取差异化核心卖点',
  },
  {
    key: 'pain_point',
    label: '痛点共鸣',
    icon: Heart,
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    desc: '匹配目标用户的真实痛点与情感诉求',
  },
  {
    key: 'hook',
    label: '平台钩子',
    icon: Zap,
    color: 'text-info',
    bgColor: 'bg-info/10',
    borderColor: 'border-info/30',
    desc: '设计抓人眼球的开场钩子与悬念结构',
  },
  {
    key: 'cta',
    label: '引导行动',
    icon: ShoppingCart,
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/30',
    desc: '说明下一步行动，核对优惠和购买信息',
  },
];

const CATEGORIES = ['美妆护肤', '服装配饰', '家居用品', '数码电器', '食品饮料', '母婴用品', '运动户外', '其他'];
const PRICE_RANGES = ['¥0-50 平价', '¥50-200 中端', '¥200-500 中高端', '¥500-2000 高端', '¥2000+ 奢华'];
const CLASSIC_PAIN_POINTS: Record<string, string[]> = {
  '美妆护肤': ['肤色暗沉不均', '毛孔粗大油光', '干燥脱妆持久不住', '过敏刺激敏感'],
  '服装配饰': ['穿搭没搭配感', '版型不好显胖', '洗后变形掉色', '材质粗糙不舒适'],
  '家居用品': ['收纳凌乱空间小', '清洁费时费力', '产品易损坏不耐用', '安装复杂'],
  '数码电器': ['续航短频繁充电', '操作繁琐学习成本高', '信号不稳延迟高', '兼容性差'],
  '食品饮料': ['添加剂多不健康', '口感差难以坚持', '包装不环保', '价格偏高性价比低'],
  '母婴用品': ['材质安全担忧', '宝宝不愿配合使用', '收纳占地方', '性价比不高'],
  '运动户外': ['运动后恢复慢', '装备笨重不便携', '耐用性差易损', '不防水不防汗'],
  '其他': ['质量参差不齐', '售后服务差', '使用不方便', '价格虚高'],
};

// ── SSE 流式调用文心 ────────────────────────────────────────────────────────

async function callLLMStream(
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  knowledgeJobId?: string,
): Promise<void> {
  let failure: Error | null = null;
  await sendDeepSeekStreamRequest({
    messages,
    max_tokens: 2000,
    knowledge_job_id: knowledgeJobId,
    onData: onChunk,
    onComplete: () => {},
    onError: (err) => { failure = err; },
    signal,
  });
  if (signal.aborted) throw new Error('脚本生成已取消');
  if (failure) throw failure;
}

function parseScenes(value: string): ScriptScene[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 50 || parsed.some(scene =>
    !scene || ['scene', 'visual', 'dialogue', 'prompt'].some(key => typeof scene[key] !== 'string' || !scene[key].trim())
    || !Number.isInteger(scene.duration) || scene.duration < 1 || scene.duration > 120)) {
    throw new Error('模型分镜格式不正确，请重试');
  }
  return parsed.map((scene, i) => ({ ...scene, order: i + 1 }));
}

// ── 对话消息类型 ─────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

// ── 四层流水线状态 ────────────────────────────────────────────────────────────
type LayerKey = 'selling_point' | 'pain_point' | 'hook' | 'cta';
type LayerStatus = 'idle' | 'processing' | 'done';
type LayerStatuses = Record<LayerKey, LayerStatus>;
// ── 四层流水线可视化组件 ──────────────────────────────────────────────────────
function FourLayerPipeline({ statuses, activeLayer }: {
  statuses: LayerStatuses;
  activeLayer: LayerKey | null;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="text-xs font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />脚本结构检查
      </p>
      <div className="flex items-center gap-0">
        {FOUR_LAYER_STEPS.map((step, idx) => {
          const Icon = step.icon;
          const status = statuses[step.key as LayerKey];
          const isActive = activeLayer === step.key;
          return (
            <div key={step.key} className="flex items-center flex-1 min-w-0">
              <div className={cn(
                'flex-1 min-w-0 flex flex-col items-center gap-1 py-2 px-1 rounded-lg transition-all duration-500',
                status === 'done' && step.bgColor,
                isActive && 'bg-primary/10 ring-1 ring-primary/40',
              )}>
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center transition-all',
                  status === 'done' ? step.bgColor : 'bg-muted',
                  isActive && 'ring-2 ring-primary animate-pulse',
                )}>
                  {status === 'processing'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    : status === 'done'
                      ? <CheckCircle2 className={cn('w-3.5 h-3.5', step.color)} />
                      : <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  }
                </div>
                <span className={cn(
                  'text-[10px] font-medium text-center leading-tight',
                  status === 'done' ? step.color : 'text-muted-foreground',
                  isActive && 'text-primary',
                )}>
                  {step.label}
                </span>
              </div>
              {idx < FOUR_LAYER_STEPS.length - 1 && (
                <ChevronRight className={cn(
                  'w-3 h-3 shrink-0 transition-colors',
                  status === 'done' ? 'text-primary/60' : 'text-muted-foreground/30',
                )} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 场景编辑器 ────────────────────────────────────────────────────────────
function SceneCard({
  scene, index, onUpdate, onDelete,
}: {
  scene: ScriptScene;
  index: number;
  onUpdate: (idx: number, patch: Partial<ScriptScene>) => void;
  onDelete: (idx: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden shadow-sm">
      {/* 卡片头 */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {scene.order}
        </div>
        <div className="flex-1 min-w-0">
          <Input
            value={scene.scene}
            onChange={e => onUpdate(index, { scene: e.target.value })}
            aria-label={`场景 ${scene.order} 名称`}
            className="h-8 text-sm font-semibold bg-transparent border-transparent px-1"
            placeholder="场景名称"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />{scene.duration}s
          </span>
          <button onClick={() => onDelete(index)} aria-label={`删除场景 ${scene.order}`}
            className="w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <Trash2 className="w-3 h-3" />
          </button>
          <button onClick={() => setExpanded(v => !v)} aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '展开'}场景 ${scene.order}`}
            className="w-8 h-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">画面描述</Label>
              <Textarea rows={2} value={scene.visual}
                onChange={e => onUpdate(index, { visual: e.target.value })}
                className="text-sm resize-none" placeholder="画面描述..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Mic className="w-3 h-3" />台词文案
              </Label>
              <Textarea rows={2} value={scene.dialogue}
                onChange={e => onUpdate(index, { dialogue: e.target.value })}
                className="text-sm resize-none" placeholder="台词文案..." />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Sparkles className="w-3 h-3" />AIGC Prompt
              </Label>
              <Textarea rows={2} value={scene.prompt}
                onChange={e => onUpdate(index, { prompt: e.target.value })}
                className="text-sm resize-none font-mono" placeholder="AIGC Prompt..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />建议时长（秒）
              </Label>
              <Input type="number" min={1} max={30} value={scene.duration}
                onChange={e => onUpdate(index, { duration: Number(e.target.value) })}
                className="text-sm" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
export default function ScriptPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // P1-N05 草稿自动保存
  type ScriptDraft = {
    productName: string; category: string; priceRange: string;
    sellingPoints: string[]; audience: string; platform: string; videoLength: number; knowledgeJobId?: string;
    scenes?: ScriptScene[]; promptText?: string; generated?: boolean;
  };
  const { value: draft, save: saveDraft, clear: clearDraft, hasDraft } =
    useDraft<ScriptDraft>(`script-draft-${user?.id ?? 'anon'}`, {
      productName: '', category: '', priceRange: '',
      sellingPoints: [], audience: '', platform: 'douyin', videoLength: 25,
    });

  const [productName, setProductName]     = useState(draft.productName || '');
  const [category, setCategory]           = useState(draft.category || '美妆护肤');
  const [priceRange, setPriceRange]       = useState(draft.priceRange || '');
  const [sellingInput, setSellingInput]   = useState('');
  const [sellingPoints, setSellingPoints] = useState<string[]>(draft.sellingPoints || []);
  const [selectedPainPoints, setSelectedPainPoints] = useState<string[]>([]);
  const [audience, setAudience]           = useState(draft.audience || '');
  const [knowledgeJobId, setKnowledgeJobId] = useState(draft.knowledgeJobId || '');
  const [platform, setPlatform]           = useState(draft.platform || 'douyin');
  const [videoLength, setVideoLength]     = useState(draft.videoLength || 25);
  const [draftRestored, setDraftRestored] = useState(hasDraft);

  // 接收来自外部模块（Prompt知识库 / 风格复刻 / 竞品分析）传递的状态
  useEffect(() => {
    const state = location.state as any;
    if (state?.prompt) {
      setPromptText(state.prompt);
      toast.info('已自动载入外部优质 Prompt 模版！');
    }
    if (state?.productName) {
      setProductName(state.productName);
    }
    if (Array.isArray(state?.sellingPoints) && state.sellingPoints.every((point: unknown) => typeof point === 'string')) {
      setSellingPoints(state.sellingPoints.slice(0, 6));
    }
    if (state?.knowledgeJobId) setKnowledgeJobId(state.knowledgeJobId);
    if (state?.category) {
      setCategory(state.category);
    }
    if (state?.styleReport) {
      toast.success(`已载入爆款风格 DNA: ${state.styleReport.dna_fingerprint}`);
    }
    if (state?.competitorScript) {
      toast.success('已载入竞品爆款对标脚本结构！');
    }
  }, [location.state]);

  const [scenes, setScenes]       = useState<ScriptScene[]>(draft.scenes || []);
  const [promptText, setPromptText] = useState(draft.promptText || '');
  const [generating, setGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [generated, setGenerated]   = useState(!!draft.generated && !!draft.scenes?.length && !!draft.promptText);
  const [saving, setSaving]         = useState(false);
  const [pendingWrites, setPendingWrites] = useState(() => user ? pendingScriptWrites(user.id) : 0);
  const [copied, setCopied]         = useState(false);
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 四层流水线状态
  const [layerStatuses, setLayerStatuses] = useState<LayerStatuses>({
    selling_point: 'idle', pain_point: 'idle', hook: 'idle', cta: 'idle',
  });
  const [activeLayer, setActiveLayer] = useState<LayerKey | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current++; abortRef.current?.abort(); chatAbortRef.current?.abort(); };
  }, []);

  // 多轮对话优化
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // 自动保存草稿（防抖 500ms）
  useEffect(() => {
    saveDraft({ productName, category, priceRange, sellingPoints, audience, platform, videoLength, knowledgeJobId, scenes, promptText, generated });
  }, [productName, category, priceRange, sellingPoints, audience, platform, videoLength, knowledgeJobId, scenes, promptText, generated, saveDraft]);

  // ── 痛点选择切换 ─────────────────────────────────────────────────────────
  const togglePainPoint = (pp: string) => {
    setSelectedPainPoints(prev =>
      prev.includes(pp) ? prev.filter(p => p !== pp) : prev.length < 3 ? [...prev, pp] : prev
    );
  };

  // ── 添加卖点 ───────────────────────────────────────────────────────────
  const addSellingPoint = () => {
    const val = sellingInput.trim();
    if (!val) return;
    if (sellingPoints.length >= 6) { toast.warning('最多添加6个卖点'); return; }
    setSellingPoints(p => [...p, val]);
    setSellingInput('');
  };

  const removeSellingPoint = (i: number) =>
    setSellingPoints(p => p.filter((_, idx) => idx !== i));

  // ── SSE 流式生成脚本 (CR-01 四层Prompt) ─────────────────────────────────
  const handleGenerate = async () => {
    if (generating) return;
    if (!productName.trim()) { toast.error('请填写商品名称'); return; }
    if (sellingPoints.length === 0) { toast.error('请至少添加一个核心卖点'); return; }
    if (!audience.trim()) { toast.error('请填写目标用户'); return; }

    setGenerating(true);
    setStreamingText('');
    setLayerStatuses({ selling_point: 'idle', pain_point: 'idle', hook: 'idle', cta: 'idle' });
    const controller = new AbortController();
    abortRef.current = controller;
    const sequence = ++generation.current;
    const current = () => alive.current && sequence === generation.current && !controller.signal.aborted;

    // CR-01: 四层Prompt工程 — 卖点→痛点→平台钩子→CTA
    const systemPrompt = `你是专业的视频分镜脚本策划师，精通抖音/TikTok短视频「四层结构」创作：
①卖点层：深度理解商品核心差异化价值
②痛点层：匹配目标用户真实痛点与情感共鸣
③钩子层：设计平台专属的开场钩子与悬念结构（前3秒留存）
④CTA层：构建明确的行动召唤。商品价格、功效、活动和销量只使用已确认资料，参考话术不得引入新事实。`;

    const userPrompt = `请基于「四层Prompt工程」和以下商品资料生成完整产品展示视频脚本：

【商品基础信息】
- 商品名称：${productName}
- 商品品类：${category || '未指定'}
- 价格区间：${priceRange || '未指定'}
- 核心卖点：${sellingPoints.join('、')}

【目标用户与痛点】
- 目标用户：${audience}
- 核心痛点：${selectedPainPoints.length > 0 ? selectedPainPoints.join('、') : '待AI分析'}

【创作要求】
- 目标平台：${platform === 'tiktok' ? 'TikTok（英语用户，需要英文口播）' : '抖音（中文用户）'}
- 建议时长：${videoLength}秒
- 四层结构：①卖点提炼②痛点共鸣③平台钩子（前3秒强钩子）④CTA转化

请输出以下内容：

## 分镜脚本

生成5个场景的JSON数组（放在 \`\`\`json 代码块中）：
[
  {
    "order": 1,
    "scene": "场景名称（含四层标注）",
    "visual": "画面描述（15-30字）",
    "dialogue": "口播台词（20-40字，${platform === 'tiktok' ? '英文' : '中文'}）",
    "duration": 时长(秒，整数),
    "prompt": "英文AI生成Prompt（50-80词）",
    "layer": "selling_point|pain_point|hook|cta"
  }
]

## AIGC Prompt

生成整体视频的详细英文Prompt（150-200词），放在 \`\`\`prompt 代码块中。`;

    let fullText = '';
    try {
      await callLLMStream(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        (chunk) => {
          if (!current()) return;
          fullText += chunk;
          setStreamingText(fullText);
        },
        controller.signal,
        knowledgeJobId || undefined,
      );
      if (!current()) return;

      const jsonMatch = fullText.match(/```json\s*([\s\S]*?)```/);
      const promptMatch = fullText.match(/```prompt\s*([\s\S]*?)```/);

      if (!jsonMatch) throw new Error('模型未返回分镜JSON，请调整要求后重试');
      const parsed = parseScenes(jsonMatch[1].trim());
      const returnedPrompt = promptMatch?.[1].trim() || fullText.split('## AIGC Prompt')[1]?.replace(/```.*?```/gs, '').trim();
      if (!returnedPrompt) throw new Error('模型未返回完整视频Prompt，请重试');
      setScenes(parsed);
      setPromptText(returnedPrompt);
      setSavedScriptId(null);
      setLayerStatuses(Object.fromEntries(FOUR_LAYER_STEPS.map(step =>
        [step.key, parsed.some(scene => (scene as ScriptScene & { layer?: string }).layer === step.key) ? 'done' : 'idle'])) as LayerStatuses);
      setGenerated(true);
      setStreamingText('');
      setDraftRestored(false);
      setChatMessages([
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: fullText },
      ]);
      toast.success('脚本生成完成，请检查画面、台词和未标注的结构');
    } catch (err) {
      if (current()) toast.error(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      if (alive.current && sequence === generation.current) { setGenerating(false); setStreamingText(''); }
    }
  };

  const handleStopGenerate = () => {
    generation.current++;
    abortRef.current?.abort();
    setGenerating(false);
    setStreamingText('');
  };

  // ── 场景编辑 ───────────────────────────────────────────────────────────
  const updateScene = (idx: number, patch: Partial<ScriptScene>) => {
    setSavedScriptId(null);
    setScenes(s => s.map((sc, i) => i === idx ? { ...sc, ...patch } : sc));
  };

  const deleteScene = (idx: number) => {
    setSavedScriptId(null);
    setScenes(s => s.filter((_, i) => i !== idx).map((sc, i) => ({ ...sc, order: i + 1 })));
  };

  const addScene = () => {
    setSavedScriptId(null);
    setScenes(s => [...s, {
      order: s.length + 1, scene: `场景 ${s.length + 1}`,
      visual: '', dialogue: '', duration: 5, prompt: '',
    }]);
  };

  // ── P1-N02 多轮对话优化 ─────────────────────────────────────────────────
  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatStreaming) return;
    setChatInput('');
    setChatStreaming(true);

    const newHistory: ChatMessage[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages([...newHistory, { role: 'assistant', content: '', streaming: true }]);

    const controller = new AbortController();
    chatAbortRef.current = controller;
    const current = () => alive.current && !controller.signal.aborted;
    let assistantText = '';

    try {
      await callLLMStream(
        [
          { role: 'system', content: '你是专业的视频分镜脚本策划师，正在帮助用户优化已生成的脚本。请根据用户反馈直接修改或补充脚本内容，保留已确认的事实与创意目标。' },
          ...newHistory.map(m => ({ role: m.role, content: m.content })),
        ],
        (chunk) => {
          if (!current()) return;
          assistantText += chunk;
          setChatMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantText, streaming: true };
            return updated;
          });
        },
        controller.signal,
      );
      if (!current()) return;

      setChatMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: assistantText, streaming: false };
        return updated;
      });

      // 尝试从回复中提取更新的场景 JSON
      const jsonMatch = assistantText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = parseScenes(jsonMatch[1].trim());
          setScenes(parsed);
          setSavedScriptId(null);
          toast.success('脚本已根据对话更新！');
        } catch { toast.error('回复分镜格式无效，保留当前脚本'); }
      }
    } catch (err) {
      if (current()) {
        setChatInput(msg); setChatMessages(newHistory.slice(0, -1));
        toast.error(err instanceof Error ? err.message : '优化失败，请重试');
      }
    } finally {
      if (alive.current) {
        setChatStreaming(false);
        setChatMessages(prev => prev.map(item => ({ ...item, streaming: false })));
      }
    }
  };

  // ── 保存脚本（内部通用） ────────────────────────────────────────────────
  const saveScript = async (): Promise<Script | null> => {
    if (!user || !generated) return null;
    const script = await saveScriptDraft(user.id, {
      product_name:    productName,
      selling_points:  sellingPoints,
      target_audience: audience,
      platform,
      scenes,
      prompt_text:     promptText,
      edited_scenes:   null,
      edited_prompt:   null,
      status:          'done',
    });
    if (!alive.current) return null;
    setSavedScriptId((script as Script).id);
    return script as Script;
  };

  // ── 应用到知识库 ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user || !generated) return;
    setSaving(true);
    try {
      const script = await saveScript();
      if (!script) { toast.error('保存失败，请重试'); return; }
      const scriptId = script.id;
      if (!alive.current) return;
      await saveScriptKnowledge(user.id, {
        source_type:   'script_edit',
        source_id:     scriptId,
        title:         `${productName} 脚本`,
        content:       { scenes, prompt_text: promptText, selling_points: sellingPoints },
        quality_score: 3,
      });
      if (!alive.current) return;
      toast.success('脚本已保存到知识库，请前往知识库建立语义索引');
    } catch (cause) {
      if (alive.current) toast.error(cause instanceof Error ? cause.message : '知识保存失败');
    } finally {
      if (alive.current) { setSaving(false); setPendingWrites(pendingScriptWrites(user.id)); }
    }
  };

  // ── 应用到视频生成 ───────────────────────────────────────────────────────
  const handleApplyToVideo = async () => {
    if (!generated || saving) return;
    setSaving(true);
    try {
      const script = await saveScript();
      if (!alive.current) return;
      if (!script) throw new Error('脚本保存失败，请重试后应用到视频');
      navigate('/video/create', {
        state: { from: 'script', scriptId: script.id, productName, sellingPoints, platform, promptText, scenes },
      });
      toast.success('脚本Prompt已传入视频工作台，请确认模型与生成规格');
    } catch (cause) {
      if (alive.current) toast.error(cause instanceof Error ? cause.message : '脚本保存失败');
    } finally {
      if (alive.current && user) { setSaving(false); setPendingWrites(pendingScriptWrites(user.id)); }
    }
  };

  // ── 复制 Prompt ────────────────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(promptText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0);

  return (
    <div className="rounded-xl bg-background text-foreground p-4 md:p-6 space-y-6">
      {pendingWrites > 0 && <div role="alert" className="rounded-lg border p-4 text-sm space-y-2">
        <p>有 {pendingWrites} 份脚本或知识保存结果待确认，可恢复原UUID与原内容。</p>
        <Button variant="outline" disabled={saving} onClick={async () => {
          if (!user) return;
          setSaving(true);
          try {
            const result = await recoverScriptWrites(user.id);
            if (!alive.current) return;
            if (result.errors.length) toast.error(`仍有${result.errors.length}份保存待确认：${result.errors[0]}`);
            else toast.success(`已恢复${result.restored}份原保存`);
          } catch (cause) { if (alive.current) toast.error(cause instanceof Error ? cause.message : '恢复失败'); }
          finally { if (alive.current) { setSaving(false); setPendingWrites(pendingScriptWrites(user.id)); } }
        }}>恢复原脚本保存</Button>
      </div>}
      {/* ── 草稿恢复提示 ── */}
      {draftRestored && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
          <Info className="w-4 h-4 text-warning shrink-0" />
          <span className="flex-1 text-warning">已恢复上次未完成的草稿</span>
          <button
            aria-label="清除已恢复的草稿"
            onClick={() => { clearDraft(); setDraftRestored(false); setProductName(''); setCategory(''); setPriceRange(''); setSellingPoints([]); setAudience(''); setPlatform('douyin'); setVideoLength(25); setScenes([]); setPromptText(''); setGenerated(false); }}
            className="text-warning hover:text-warning/70 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* ── 页头 ── */}
      {knowledgeJobId && <div className="rounded-lg border p-3 text-sm flex flex-wrap items-center justify-between gap-2">
        <p>已带入知识库资料，将用于本次脚本生成。</p>
        <Button size="sm" variant="outline" onClick={() => setKnowledgeJobId('')}>移除知识引用</Button>
      </div>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
            <Wand2 className="w-5 h-5 text-primary shrink-0" />
            AI 视频分镜脚本
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            确认创作资料后生成分镜，逐镜头调整画面、台词、时长与视频提示词
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/knowledge')}
            className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
          >
            <Sparkles className="w-3.5 h-3.5" />
            从知识库选取资料
          </Button>
          <Badge variant="outline" className="text-xs shrink-0 gap-1 border-primary/40 text-primary">
            <Sparkles className="w-3 h-3" />分镜创作
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── 左侧：输入表单 ── */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-border bg-card text-card-foreground p-4 md:p-5 space-y-4 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs">1</span>
              创作资料 · 商品信息
            </h2>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">商品名称 *</Label>
              <Input value={productName} onChange={e => setProductName(e.target.value)}
                placeholder="例：无线降噪耳机 Pro" className="h-9" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">商品品类</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="选择品类" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">价格区间</Label>
                <Select value={priceRange} onValueChange={setPriceRange}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="选择价格" /></SelectTrigger>
                  <SelectContent>
                    {PRICE_RANGES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">核心卖点 * (最多6个)</Label>
              <div className="flex gap-2">
                <Input
                  aria-label="新增核心卖点"
                  value={sellingInput}
                  onChange={e => setSellingInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addSellingPoint()}
                  placeholder="输入卖点后按 Enter"
                  className="h-9 flex-1"
                />
                <Button aria-label="添加核心卖点" size="sm" variant="outline" className="h-9 px-3 shrink-0" onClick={addSellingPoint}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {sellingPoints.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {sellingPoints.map((sp, i) => (
                    <Badge key={i} variant="secondary" className="text-xs gap-1 pr-1">
                      {sp}
                      <button aria-label={`删除卖点 ${sp}`} onClick={() => removeSellingPoint(i)}
                        className="w-3.5 h-3.5 rounded-full bg-muted-foreground/20 hover:bg-destructive/20 hover:text-destructive flex items-center justify-center transition-colors">
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">目标用户 *</Label>
              <Input value={audience} onChange={e => setAudience(e.target.value)}
                placeholder="例：18-35岁爱好音乐的都市白领" className="h-9" />
            </div>

            {/* 经典痛点快选 */}
            {category && CLASSIC_PAIN_POINTS[category] && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-warning" />
                  经典痛点快选（最多3个）
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {CLASSIC_PAIN_POINTS[category].map(pp => (
                    <button
                      key={pp}
                      onClick={() => togglePainPoint(pp)}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-full border transition-all',
                        selectedPainPoints.includes(pp)
                          ? 'bg-warning/15 border-warning/50 text-warning font-medium'
                          : 'border-border/60 text-muted-foreground hover:border-warning/40 hover:text-foreground',
                      )}
                    >
                      {pp}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">目标平台</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="douyin">抖音</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">建议时长：{videoLength}s</Label>
                <Slider
                  min={10} max={60} step={5}
                  value={[videoLength]}
                  onValueChange={([v]) => setVideoLength(v)}
                  className="mt-3"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1 h-10" onClick={handleGenerate} disabled={generating}>
                {generating
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Wand2 className="w-4 h-4 mr-2" />
                }
                {generating ? 'AI 生成中...' : (generated ? '重新生成' : 'AI 一键生成脚本')}
              </Button>
              {generating && (
                <Button variant="outline" className="h-10 px-3 shrink-0" onClick={handleStopGenerate}>
                  <StopCircle className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* 四层流水线 */}
            {(generating || generated) && (
              <FourLayerPipeline statuses={layerStatuses} activeLayer={activeLayer} />
            )}

            {generating && (
              <div className="rounded-xl bg-muted/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">AI 正在流式输出脚本...</span>
                </div>
                {streamingText && (
                  <p className="text-xs text-foreground/80 line-clamp-3 font-mono">{streamingText.slice(-200)}</p>
                )}
              </div>
            )}
          </div>

          {/* 使用技巧 */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
            <p className="text-sm font-semibold text-primary">写好脚本的四个要点</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li><strong className="text-foreground">突出卖点</strong>：填写具体、可核实的功能优势</li>
              <li><strong className="text-foreground">贴近受众</strong>：说明使用场景和希望解决的问题</li>
              <li><strong className="text-foreground">做好开场</strong>：检查前几秒是否清楚、有吸引力</li>
              <li><strong className="text-foreground">引导行动</strong>：说明下一步，并核对优惠信息</li>
            </ul>
          </div>
        </div>

        {/* ── 右侧：生成结果 ── */}
        <div className="lg:col-span-3 space-y-5">
          {!generated && !generating && (
            <div className="rounded-2xl border-2 border-dashed border-border/60 flex flex-col items-center justify-center py-24 text-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-semibold text-muted-foreground">填写商品信息后点击生成</p>
              <p className="text-sm text-muted-foreground">生成结果会逐步显示，可继续修改画面和台词</p>
              <div className="flex flex-wrap justify-center items-center gap-2 mt-2">
                {FOUR_LAYER_STEPS.map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.key} className="flex items-center gap-1">
                      <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', step.bgColor, step.color)}>
                        <Icon className="w-3 h-3" />{step.label}
                      </span>
                      {i < FOUR_LAYER_STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {generated && (
            <>
              {/* 分镜脚本 */}
              <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
                <div className="flex flex-wrap gap-2 items-center justify-between px-4 md:px-5 py-3.5 border-b border-border bg-muted/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">分镜脚本</h2>
                    <Badge variant="secondary" className="text-xs">{scenes.length} 个场景</Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />总时长 {totalDuration}s
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1" onClick={addScene}>
                    <Plus className="w-3.5 h-3.5" />添加场景
                  </Button>
                </div>
                <div className="p-4 space-y-3">
                  {scenes.map((sc, i) => (
                    <SceneCard key={sc.order} scene={sc} index={i}
                      onUpdate={updateScene} onDelete={deleteScene} />
                  ))}
                </div>
              </div>

              <Separator />

              {/* Prompt 文案 */}
              <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold">AIGC Prompt 文案</h2>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={handleCopy}>
                    {copied
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-success" />已复制</>
                      : <><Copy className="w-3.5 h-3.5" />复制</>
                    }
                  </Button>
                </div>
                <div className="p-4">
                  <Textarea
                    value={promptText}
                    onChange={e => { setPromptText(e.target.value); setSavedScriptId(null); }}
                    rows={8}
                    className="text-sm font-mono resize-none bg-muted/30"
                    placeholder="Prompt 文案..."
                  />
                </div>
              </div>

              {/* ── P1-N02 多轮对话优化 ── */}
              <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border/50 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold">多轮对话优化脚本</h2>
                  <Badge variant="outline" className="text-xs ml-auto">对话修改</Badge>
                </div>
                <div className="flex flex-col">
                  <ScrollArea className="h-52 px-4 py-3">
                    {chatMessages.filter(m => m.role === 'user' && chatMessages.indexOf(m) > 1).length === 0
                      && chatMessages.filter(m => m.streaming).length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        在下方输入对脚本的修改要求，AI 会实时更新
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {chatMessages.slice(2).map((msg, i) => (
                          <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                            <div className={cn(
                              'max-w-[85%] rounded-xl px-3 py-2 text-xs',
                              msg.role === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-foreground',
                            )}>
                              {msg.role === 'assistant' && msg.streaming ? (
                                <span>{msg.content}<span className="animate-pulse">▋</span></span>
                              ) : (
                                <span className="whitespace-pre-wrap">{msg.content.slice(0, 400)}{msg.content.length > 400 ? '...' : ''}</span>
                              )}
                            </div>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                  <div className="px-4 pb-4 border-t border-border/50 pt-3 flex gap-2">
                    <Input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
                      placeholder="例：把第一个场景改为情感故事开场..."
                      className="h-9 text-sm"
                      disabled={chatStreaming}
                    />
                    <Button
                      size="sm"
                      className="h-9 px-3 shrink-0"
                      onClick={chatStreaming ? () => chatAbortRef.current?.abort() : handleChatSend}
                      disabled={!chatInput.trim() && !chatStreaming}
                    >
                      {chatStreaming
                        ? <StopCircle className="w-4 h-4" />
                        : <Send className="w-4 h-4" />
                      }
                    </Button>
                  </div>
                </div>
              </div>

              {/* 底部操作 */}
              <div className="flex flex-col gap-3">
                <Button className="w-full h-11" onClick={handleSave} disabled={saving}>
                  {saving
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <BookOpen className="w-4 h-4 mr-2" />
                  }
                  {saving ? '保存中...' : '保存并回写知识库'}
                </Button>
                <Button variant="outline" className="w-full h-11" disabled={saving || generating} onClick={handleApplyToVideo}>
                  <Video className="w-4 h-4 mr-2" />应用到视频生成
                </Button>
                <Button variant="outline" className="w-full h-11" disabled={saving || generating || scenes.length < 2 || scenes.length > 6}
                  onClick={() => {
                    if (scenes.some(scene => !scene.prompt.trim() || !scene.dialogue.trim() || scene.duration < 2 || scene.duration > 15)) {
                      toast.error('多镜头任务需要完整画面Prompt与台词，每镜头2至15秒'); return;
                    }
                    navigate('/batch-create', { state: { from: 'script', productName, scenes, platform } });
                  }}>
                  生成多镜头配音成片
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
