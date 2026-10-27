import {
  AlertCircle, AlignCenter, AlignLeft, AlignRight, ArrowRight, BadgeCheck, BarChart2, Bold, BookOpen, Captions, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Cloud, Copy, 
  CreditCard, Download, ExternalLink, Eye, 
  EyeOff, FileCheck2, 
  Film, Flame, FlipHorizontal, FlipVertical,
  FolderOpen, 
  Grid3x3, GripVertical, Heart, ImageIcon, Info, Italic,
  Layers, List, Loader2, Lock, Maximize, 
  Mic, Minimize, Move, Music, Music2, Package, Palette, Pause, 
  Play, Plus, Redo,
  RefreshCw, RotateCcw, RotateCw, Save, Scan, 
  Scissors, 
  Scissors as ScissorsIcon, Search, 
  Settings2, ShoppingBag, ShoppingCart, SkipBack, SkipForward, SlidersHorizontal, Smile, Sparkles, Star, 
  Tag, ToggleLeft, ToggleRight, Trash2, TrendingUp, Truck, Type, Undo, Upload, Volume2, VolumeX, Wand2, Waypoints, X, Zap, ZoomIn, ZoomOut 
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorMediaCache } from '@/hooks/useEditorMediaCache';
import { useEditorClock } from '@/hooks/useEditorClock';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { useAuth } from '@/contexts/AuthContext';
import { stableMedia } from '@/api/media';
import { listMaterialAssets, materialDuration, uploadMaterialAsset, type EditorMaterial } from '@/api/materialAssets';
import { EditorAssetsPanel } from '@/components/production/EditorAssetsPanel';
import { RecordingDialog } from '@/components/production/RecordingDialog';
import { MaterialUploadControl } from '@/components/production/MaterialUploadControl';
import { EditorAudioPanel, EQ_FREQUENCIES } from '@/components/production/EditorAudioPanel';
import { TimelineMediaPreview } from '@/components/production/TimelineMediaPreview';
import { deleteMaterial } from '@/api/accessControl';
import { useProductionJob } from '@/hooks/useProductionJob';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { useEditorPersistence } from '@/hooks/useEditorPersistence';
import { createEditorProject, listEditorProjects, saveEditorProject } from '@/api/editorProjects';
import { requireAccountSession } from '@/api/accountSession';
import { persistEditorSnapshot, type EditorSnapshot } from '@/lib/editorPersistence';
import { EditAnalysisDialog } from '@/components/production/EditAnalysisDialog';
import { beatCuts, sourceMatches, subtitleItems } from '@/lib/editTimeline';
import { cn } from '@/lib/utils';
import { extractVideoFirstFrame, extractVideoMeta, getVideoCoverImage } from '@/lib/videoFrame';
import { RENDER_TRANSITIONS, RENDER_BLENDS, DEFAULT_CHROMA, type ChromaSettings } from '../../supabase/functions/_shared/render-effects';


// ── 类型定义 ──────────────────────────────────────────────────────────────
// ── 文案字体标签 → 真实 CSS font-family 栈映射（中文标签本身不可被浏览器解析）──
const FONT_STACK_MAP: Record<string, string> = {
  '默认黑体': '"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
  '思源宋体': '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
  '快乐体': '"ZCOOL KuaiLe", "Comic Sans MS", cursive, sans-serif',
  '抖音美好体': '"ZCOOL QingKe HuangYou", "Douyin Meihao Ti", sans-serif',
  '手写体': '"Ma Shan Zheng", "STXingkai", "KaiTi", cursive',
  '综艺体': '"ZCOOL QingKe HuangYou", "FZZhengHei", sans-serif',
};
const resolveTextFont = (label?: string) =>
  (label && FONT_STACK_MAP[label]) ||
  (label && Object.values(FONT_STACK_MAP).includes(label) ? label : undefined) ||
  '"PingFang SC", "Microsoft YaHei", sans-serif';

// ── 降噪档位：用高通/低通/陷波双二阶滤波器组近似 AI 降噪的分频处理 ──
const DENOISE_LEVELS: Record<string, { hp: number; lp: number; notch: number }> = {
  '无降噪': { hp: 20, lp: 20000, notch: 1 },
  '轻度去噪': { hp: 80, lp: 14000, notch: 50 },
  '深度纯音': { hp: 120, lp: 11000, notch: 100 },
};

// ── 混响声场预设：以程序化生成指数衰减噪声脉冲响应驱动 ConvolverNode ──
const REVERB_PRESETS: Record<string, { seconds: number; decay: number; wet: number }> = {
  '录音棚': { seconds: 0.6, decay: 2.6, wet: 0.16 },
  'KTV沉浸': { seconds: 1.6, decay: 2.2, wet: 0.3 },
  '大厅空间': { seconds: 3.2, decay: 1.8, wet: 0.42 },
  '广播电台': { seconds: 0.35, decay: 3, wet: 0.12 },
  '温暖剧场': { seconds: 2.2, decay: 2, wet: 0.36 },
};

const makeReverbImpulse = (ctx: AudioContext, seconds: number, decay: number) => {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buffer;
};

export interface TrackItem {
  id: string;
  trackId: string;
  name: string;
  start: number;
  duration: number;
  type: 'video' | 'audio' | 'text' | 'image';
  url?: string;
  scale?: number;
  opacity?: number;
  volume?: number;
  speed?: number;
  sourceStart?: number;
  hidden?: boolean;
  locked?: boolean;
  fontStyle?: any;
  keyframes?: { time: number; property: string; value: number }[];
  // ── 专业视频画面属性 ──
  x?: number;
  y?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  filter?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  // ── 专业音频属性 ──
  mute?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  pan?: number;
  denoise?: string;
  reverb?: string;
  pitch?: number;
  eqBands?: Record<string, number>;
  echo?: number;
  voiceEffect?: 'none' | 'robot';
  // ── 专业文案/字幕属性 ──
  text?: string;
  fontSize?: number;
  fontColor?: string;
  fontFamily?: string;
  strokeColor?: string;
  strokeWidth?: number;
  bgColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  isBold?: boolean;
  isItalic?: boolean;
  animation?: string;
  entrance?: string;
  exit?: string;
}

export interface PipSettings {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  blendMode: string;
}

export interface PipLayer {
  id: string;
  name: string;
  url?: string;
  type?: 'video' | 'image';
  visible: boolean;
  locked: boolean;
}


export const getCssFilter = (filterId: string | null, intensity: number = 80, beautyEnabled: boolean = false) => {
  const parts: string[] = [];
  if (beautyEnabled) {
    parts.push('brightness(1.06) contrast(1.03) saturate(1.08)');
  }
  if (!filterId) return parts.length ? parts.join(' ') : 'none';
  const pct = intensity / 100;
  switch (filterId) {
    case 'f1': parts.push(`contrast(${1 + 0.2 * pct}) saturate(${1 - 0.2 * pct}) brightness(${1 - 0.05 * pct}) sepia(${0.2 * pct})`); break;
    case 'f2': parts.push(`sepia(${0.35 * pct}) saturate(${1 + 0.3 * pct}) brightness(${1 + 0.05 * pct})`); break;
    case 'f3': parts.push(`hue-rotate(${180 * pct}deg) saturate(${1 - 0.1 * pct})`); break;
    case 'f4': parts.push(`sepia(${0.4 * pct}) contrast(${1 + 0.15 * pct}) brightness(${1 - 0.1 * pct})`); break;
    case 'f5': parts.push(`grayscale(${pct}) contrast(${1 + 0.2 * pct})`); break;
    case 'f6': parts.push(`invert(${pct})`); break;
    case 'f7': parts.push(`saturate(${1 + 1.2 * pct}) contrast(${1 + 0.1 * pct})`); break;
    case 'f8': parts.push(`saturate(${Math.max(0, 1 - 0.8 * pct)}) brightness(${1 + 0.05 * pct})`); break;
    default: break;
  }
  return parts.length ? parts.join(' ') : 'none';
};

// 左侧面板模块枚举
type PanelId =
  | 'media'
  | 'effects'
  | 'text'
  | 'pip'
  | 'audio'
  | 'keyframe'
  | 'ai'
  | 'shop';

// ── 常量数据 ─────────────────────────────────────────────────────────────

// 转场效果数据
const TRANSITIONS = RENDER_TRANSITIONS;

// 滤镜数据
const FILTERS = [
  { id: 'f1', name: '电影感', category: 'LUT', intensity: 80 },
  { id: 'f2', name: '暖阳', category: 'LUT', intensity: 70 },
  { id: 'f3', name: '冷蓝调', category: 'LUT', intensity: 75 },
  { id: 'f4', name: '复古胶片', category: 'LUT', intensity: 65 },
  { id: 'f5', name: '黑白', category: '经典', intensity: 100 },
  { id: 'f6', name: '反色', category: '特殊', intensity: 100 },
  { id: 'f7', name: '高饱和', category: '调色', intensity: 60 },
  { id: 'f8', name: '低饱和', category: '调色', intensity: 50 },
];

// 内置文字贴纸，预览与导出均使用文字轨道。
const STICKERS = [
  { id: 's1', name: '星标', category: '静态贴纸', emoji: '★' },
  { id: 's2', name: '爱心', category: '静态贴纸', emoji: '♥' },
  { id: 's3', name: '强调符号', category: '静态贴纸', emoji: '+' },
  { id: 's7', name: '话题标签', category: '文字模板', emoji: '#话题' },
  { id: 's8', name: '自定义角标', category: '文字模板', emoji: '自定义标签' },
];


// 字体样式
const FONT_STYLES = [
  { id: 'fs1', name: '默认文字', preview: 'Aa', weight: '400' },
  { id: 'fs2', name: '粗体标题', preview: 'Aa', weight: '700' },
  { id: 'fs3', name: '花字·彩虹', preview: '彩', weight: '700' },
  { id: 'fs4', name: '霓虹发光', preview: 'Aa', weight: '700' },
  { id: 'fs5', name: '描边文字', preview: 'Aa', weight: '400' },
  { id: 'fs6', name: '字幕样式', preview: 'Aa', weight: '400' },
];

// 入场出场动画
const TEXT_ANIMATIONS = [
  { id: 'ta1', name: '淡入', dir: '入场' },
  { id: 'ta2', name: '从下弹出', dir: '入场' },
  { id: 'ta3', name: '打字机', dir: '入场' },
  { id: 'ta4', name: '旋转进入', dir: '入场' },
  { id: 'ta5', name: '淡出', dir: '出场' },
  { id: 'ta6', name: '向上消散', dir: '出场' },
];

// 混合模式
const BLEND_MODES = RENDER_BLENDS.map(mode => mode.name);


// 关键帧属性
const KF_PROPERTIES = ['位置X', '位置Y', '缩放', '旋转', '不透明度'];
const KF_CURVES = ['线性', '缓入', '缓出', '缓入缓出', '弹性', '自定义'];

// AI 工具入口
const AI_TOOLS = [
  { id: 'ai1', name: '色键去背景', desc: '绿幕或纯色背景，可调容差', icon: Scan, color: 'text-purple-400', badge: '调色' },
  { id: 'ai2', name: '画面提亮', desc: '亮度、对比度与饱和度调整', icon: Smile, color: 'text-pink-400', badge: '调色' },
  { id: 'ai3', name: '真实音轨卡点', desc: '后台检测音乐节拍，按实际位置切分', icon: Zap, color: 'text-yellow-400', badge: '剪辑' },
  { id: 'ai4', name: '时间分段字幕', desc: '按裁剪与速度识别，使用真实时间戳', icon: Captions, color: 'text-blue-400', badge: '语音' },
  { id: 'ai7', name: '人物去背景', desc: '逐帧人物分割，导出透明蒙版合成', icon: Scan, color: 'text-purple-400', badge: '人物' },
  { id: 'ai5', name: '创作脚本', desc: '打开脚本工作台生成文案', icon: BookOpen, color: 'text-emerald-400', badge: '脚本' },
  { id: 'ai6', name: '分镜规划', desc: '打开脚本工作台生成结构化分镜', icon: Grid3x3, color: 'text-indigo-400', badge: '脚本' },
];


// ── 子组件：折叠区块 ─────────────────────────────────────────────────────
function CollapsibleSection({ title, defaultOpen = true, children, badge }: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800/50">
      <button
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-xs font-medium text-zinc-300 flex items-center gap-2">
          {title}
          {badge && <span className="px-1.5 py-0.5 text-[9px] bg-indigo-600/40 text-indigo-300 rounded">{badge}</span>}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ── 子组件：搜索与筛选头部 ───────────────────────────────────────────────
function SearchBar({ placeholder, onSearch }: { placeholder: string; onSearch?: (v: string) => void }) {
  return (
    <div className="px-3 py-2 sticky top-0 bg-zinc-900 z-10 border-b border-zinc-800/50">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <input
          type="text"
          placeholder={placeholder}
          className="w-full bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 pl-7 pr-3 py-1.5 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          onChange={e => onSearch?.(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── 素材卡片（媒体库面板项） ──
function MaterialItemCard({ m, onAdd, onDelete }: {
  m: { id: string; name: string; url: string; type: string };
  onAdd: (m: any) => void;
  onDelete: (id: string) => void;
}) {
  const [aspect, setAspect] = useState('aspect-video');
  return (
    <div className={`bg-zinc-800 rounded border border-zinc-700 relative group overflow-hidden hover:border-zinc-500 transition-all hover:-translate-y-0.5 cursor-pointer ${aspect}`}>
      {m.url ? (
        m.type === 'audio' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-800/90 text-zinc-400 gap-1.5 p-2">
            <Music className="w-5 h-5 text-indigo-400" />
            <span className="text-[9px] truncate w-full text-center">{m.name}</span>
          </div>
        ) : m.type === 'video' ? (
          <video
            src={`${m.url}#t=0.01`}
            preload="metadata"
            muted
            playsInline
            className="w-full h-full object-cover"
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              const ratio = vid.videoWidth / vid.videoHeight;
              if (ratio < 0.65) setAspect('aspect-[9/16]');
              else if (ratio < 0.8) setAspect('aspect-[3/4]');
              else if (ratio < 1.2) setAspect('aspect-square');
              else setAspect('aspect-video');
            }}
          />
        ) : (
          <img
            src={m.url}
            alt={m.name}
            className="w-full h-full object-cover"
            onLoad={(e) => {
              const img = e.currentTarget;
              const ratio = img.naturalWidth / img.naturalHeight;
              if (ratio < 0.65) setAspect('aspect-[9/16]');
              else if (ratio < 0.8) setAspect('aspect-[3/4]');
              else if (ratio < 1.2) setAspect('aspect-square');
              else setAspect('aspect-video');
            }}
          />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {m.type === 'audio' ? <Music className="w-5 h-5 text-zinc-600" /> : <ImageIcon className="w-5 h-5 text-zinc-600" />}
        </div>
      )}
      {m.type !== 'audio' && <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[10px] truncate text-zinc-300">{m.name}</div>}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
        <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full bg-indigo-600/80 text-white hover:bg-indigo-600" onClick={(e) => { e.stopPropagation(); onAdd(m); }}>
          <Plus className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full bg-red-600/80 text-white hover:bg-red-500" onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── 面板1：媒体库 ────────────────────────────────────────────────────────
function MediaLibraryPanel({ materials, onAdd, importedVideos, onImportVideo, onUpload, onDelete }: {
  materials: EditorMaterial[];
  onAdd: (m: EditorMaterial) => void | Promise<void>;
  importedVideos: { id: string; title: string; video_url: string; thumbnail_url: string | null }[];
  onImportVideo: (v: { id: string; title: string; video_url: string; thumbnail_url: string | null }) => void;
  onUpload: (file: File, rightsConfirmed: boolean) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('全部');
  const [pickerOpen, setPickerOpen] = useState(false);

  const filtered = materials.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === '全部' || m.type === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <div className="flex flex-col h-full">
      <SearchBar placeholder="搜索素材名称…" onSearch={setSearch} />

      {/* 筛选 + 视图切换 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/50 flex-wrap">
        {['全部', 'video', 'image', 'audio'].map(t => (
          <button
            key={t}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${typeFilter === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
            onClick={() => setTypeFilter(t)}
          >
            {t === '全部' ? '全部' : t === 'video' ? '视频' : t === 'image' ? '图片' : '音频'}
          </button>
        ))}
      </div>

      {/* 上传/添加视频按钮 */}
      <div className="px-3 py-2 border-b border-zinc-800/50">
        <button
          className="w-full flex items-center justify-center gap-2 py-2 rounded border border-dashed border-zinc-600 hover:border-indigo-500 bg-zinc-800/40 hover:bg-indigo-600/10 text-zinc-400 hover:text-indigo-300 transition-all text-[11px] font-medium"
          onClick={() => setPickerOpen(true)}
        >
          <Upload className="w-3.5 h-3.5" />
          上传视频 / 选择已生成视频
        </button>
      </div>

      {/* 已生成/上传视频弹窗 */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800 text-zinc-200 p-4">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium text-zinc-200 flex items-center gap-1.5 border-b border-zinc-800 pb-2">
              <Film className="w-3.5 h-3.5 text-indigo-400" />
              选择已生成视频 / 上传本地视频
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 上传本地视频区域 */}
            <div className="space-y-2">
              <MaterialUploadControl onUpload={onUpload} />
            </div>

            {/* 选择已生成的视频 */}
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-400">选择您已生成的带货视频：</p>
              <ScrollArea className="max-h-60 border border-zinc-800 rounded-lg bg-zinc-950 p-2">
                {importedVideos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Film className="w-8 h-8 text-zinc-850 animate-pulse" />
                    <p className="text-[10px] text-zinc-600 text-center">暂无已生成视频，请先前往「生成视频」页面创作</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {importedVideos.map(v => (
                      <button
                        key={v.id}
                        className="w-full flex items-center gap-2 p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-indigo-500 hover:bg-indigo-600/10 transition-all group text-left"
                        onClick={() => { onImportVideo(v); setPickerOpen(false); }}
                      >
                        <div className="w-14 h-8 rounded overflow-hidden bg-zinc-800 shrink-0">
                          {v.thumbnail_url ? (
                            <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                          ) : (
                            <video src={`${v.video_url}#t=0.01`} preload="metadata" muted playsInline className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-zinc-300 truncate font-medium">{v.title}</p>
                          <p className="text-[9px] text-zinc-500">点击导入到素材库</p>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-zinc-600 group-hover:text-indigo-400 shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
          <DialogFooter className="border-t border-zinc-800 pt-2.5">
            <Button size="sm" variant="ghost" className="h-8 border border-zinc-800 text-zinc-400 hover:text-zinc-200" onClick={() => setPickerOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 素材网格 */}
      <ScrollArea className="flex-1">
        <div className="px-3 py-2 grid grid-cols-2 gap-2">
          {filtered.map(m => (
            <MaterialItemCard key={m.id} m={m} onAdd={onAdd} onDelete={onDelete} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 py-8 text-center text-[11px] text-zinc-600">
              {materials.length === 0 ? '点击上方按钮添加视频素材' : '无匹配结果'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── 面板2：效果 ──────────────────────────────────────────────────────
function EffectsPanel({
  appliedFilter,
  setAppliedFilter,
  filterIntensity,
  setFilterIntensity,
  appliedTrans,
  setAppliedTrans,
  tracks,
  setTracks,
  currentTime, userId, onAdd,
}: {
  userId?: string; onAdd: (material: EditorMaterial) => void | Promise<void>;
  appliedFilter: string | null;
  setAppliedFilter: (f: string | null) => void;
  filterIntensity: Record<string, number>;
  setFilterIntensity: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  appliedTrans: string;
  setAppliedTrans: (t: string) => void;
  tracks: TrackItem[];
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  currentTime: number;
}) {
  const [activeTab, setActiveTab] = useState<'transition' | 'filter' | 'sticker' | 'audio'>('transition');
  const [transCategory, setTransCategory] = useState('全部');

  const transCategories = ['全部', '基础', '创意'];
  const filteredTrans = transCategory === '全部' ? TRANSITIONS : TRANSITIONS.filter(t => t.category === transCategory);

  const applyTransition = (id: string, name: string) => {
    if (appliedTrans === id) {
      setAppliedTrans('无');
      toast.info(`已移除转场：${name}`);
    } else {
      setAppliedTrans(id);
      toast.success(`已选择转场「${name}」`, { description: '成片在主轨相邻片段交接处应用，浏览器显示原片段预览' });
    }
  };

  const applyFilter = (id: string, name: string) => {
    if (appliedFilter === id) {
      setAppliedFilter(null);
      toast.info(`已移除滤镜：${name}`);
    } else {
      setAppliedFilter(id);
      if (filterIntensity[id] === undefined) {
        setFilterIntensity(prev => ({ ...prev, [id]: 80 }));
      }
      toast.success(`已应用「${name}」电影级滤镜，视频画布实时预览生效！`);
    }
  };

  const toggleSticker = (id: string, name: string) => {
    const stickerItem = STICKERS.find(s => s.id === id);
    if (!stickerItem) return;
    const trackItemId = `sticker-${id}`;
    const exists = tracks.some(t => t.id === trackItemId);

    if (exists) {
      setTracks(prev => prev.filter(t => t.id !== trackItemId));
      toast.info(`已从时间轴移除特效素材：${name}`);
    } else {
      const newItem: TrackItem = {
        id: trackItemId,
        trackId: 'effects',
        name: stickerItem.name,
        start: Number(currentTime.toFixed(1)),
        duration: 5,
        type: 'text', text: stickerItem.emoji, fontSize: 64, x: 80, y: 20,
        fontColor: '#ffffff', bgColor: 'transparent',
      };
      setTracks(prev => [...prev, newItem].sort((a, b) => a.start - b.start));
toast.success(`已添加「${name}」文字贴纸到时间轴`);
    }
  };


  const appliedStickersCount = tracks.filter(t => t.trackId === 'effects').length;

  return (
    <div className="flex flex-col h-full">
      {/* 子标签栏 */}
      <div className="flex border-b border-zinc-800 shrink-0">
        {([['transition', '转场'], ['filter', '滤镜'], ['sticker', '特效贴纸'], ['audio', '音乐音效']] as const).map(([id, label]) => (
          <button
            key={id}
            className={`flex-1 py-2 text-[11px] transition-colors ${activeTab === id ? 'text-white border-b-2 border-indigo-500 font-medium' : 'text-zinc-500 hover:text-zinc-300'}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'audio' ? <EditorAssetsPanel userId={userId} audioOnly onAdd={onAdd} /> : <ScrollArea className="flex-1">
        {/* ── 转场效果 ── */}
        {activeTab === 'transition' && (
          <div>
            <div className="px-3 pt-3 pb-2 flex items-center gap-1 flex-wrap">
              {transCategories.map(cat => (
                <button
                  key={cat}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${transCategory === cat ? 'bg-indigo-600 text-white font-medium' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                  onClick={() => setTransCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            {appliedTrans !== '无' && (
              <div className="mx-3 mb-2 px-2.5 py-1.5 bg-indigo-600/10 border border-indigo-600/30 rounded flex items-center justify-between">
                <span className="text-[11px] text-indigo-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-indigo-400" />
                  已应用转场：<strong className="text-white">{TRANSITIONS.find(t => t.id === appliedTrans)?.name}</strong>
                </span>
                <button className="text-[10px] text-zinc-400 hover:text-red-300 underline" onClick={() => { setAppliedTrans('无'); toast.info('已移除转场'); }}>移除</button>
              </div>
            )}
            <div className="px-3 grid grid-cols-2 gap-2">
              {filteredTrans.map(t => (
                <button key={t.id} type="button" aria-pressed={appliedTrans === t.id}
                  className={`rounded border p-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${appliedTrans === t.id ? 'border-indigo-500 bg-indigo-600/20 text-white' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
                  onClick={() => applyTransition(t.id, t.name)}>{t.name}</button>
              ))}
            </div>
            <p className="text-xs text-zinc-400 px-3 py-3">相邻片段默认过渡0.5秒，短片段自动缩短。创意转场保留前片尾帧；可在导出成片检查效果。</p>
          </div>
        )}

        {/* ── 滤镜与调色 ── */}
        {activeTab === 'filter' && (
          <div className="px-3 pt-3 space-y-3">
            {appliedFilter && (
              <div className="px-2.5 py-1.5 bg-indigo-600/10 border border-indigo-600/30 rounded flex items-center justify-between">
                <span className="text-[11px] text-indigo-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-indigo-400" />已生效滤镜：<strong className="text-white">{FILTERS.find(f => f.id === appliedFilter)?.name}</strong>
                </span>
                <button className="text-[10px] text-zinc-400 hover:text-red-300 underline" onClick={() => { setAppliedFilter(null); toast.info('已移除滤镜'); }}>清除滤镜</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {FILTERS.map(f => (
                <div key={f.id} className={`rounded border overflow-hidden bg-zinc-800 transition-all cursor-pointer hover:-translate-y-0.5 ${appliedFilter === f.id ? 'border-indigo-500 ring-1 ring-indigo-500/40 shadow-lg shadow-indigo-500/20' : 'border-zinc-700 hover:border-zinc-500'}`}>
                  <div className="aspect-video relative overflow-hidden" onClick={() => applyFilter(f.id, f.name)}>
                    <div className="w-full h-full flex items-center justify-center bg-zinc-700" style={{ filter: getCssFilter(f.id, filterIntensity[f.id] ?? f.intensity) }}><Palette className="w-6 h-6 text-zinc-200" /></div>
                    <div className="absolute inset-0 bg-black/20" />
                    <div className="absolute bottom-1 right-1 text-[9px] text-zinc-300 bg-black/60 px-1 rounded">{f.category}</div>
                    {appliedFilter === f.id && (
                      <div className="absolute top-1 left-1 bg-indigo-500 rounded-full p-0.5"><Check className="w-2.5 h-2.5 text-white" /></div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-[11px] text-zinc-200 mb-1 font-medium">{f.name}</p>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Slider
                        value={[filterIntensity[f.id] ?? f.intensity]}
                        onValueChange={([v]) => {
                          setFilterIntensity(prev => ({ ...prev, [f.id]: v }));
                          if (appliedFilter !== f.id) setAppliedFilter(f.id);
                        }}
                        max={100}
                        className="flex-1 [&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5"
                      />
                      <span className="text-[10px] text-zinc-400 w-7 text-right font-mono">{filterIntensity[f.id] ?? f.intensity}%</span>
                    </div>
                    <button
                      className={`w-full text-center text-[10px] py-1 rounded transition-colors font-medium ${appliedFilter === f.id ? 'bg-indigo-600 text-white' : 'text-indigo-400 hover:text-indigo-300 hover:bg-zinc-700/80 bg-zinc-800'}`}
                      onClick={() => applyFilter(f.id, f.name)}
                    >
                      {appliedFilter === f.id ? '✓ 正在应用' : '应用滤镜 →'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 特效与贴纸 ── */}
        {activeTab === 'sticker' && (
          <div className="px-3 pt-3 space-y-1">
            {appliedStickersCount > 0 && (
              <div className="px-2.5 py-1.5 bg-indigo-600/10 border border-indigo-600/30 rounded flex items-center justify-between mb-2">
                <span className="text-[11px] text-indigo-300">时间轴已有 {appliedStickersCount} 个特效片段</span>
                <button
                  className="text-[10px] text-zinc-400 hover:text-red-300 underline"
                  onClick={() => {
                    setTracks(prev => prev.filter(t => t.trackId !== 'effects'));
                    toast.info('已清除时间轴所有特效贴纸');
                  }}
                >
                  全部清除
                </button>
              </div>
            )}
            <CollapsibleSection title="贴纸库">
              <div className="pt-2 grid grid-cols-3 gap-2">
                {STICKERS.filter(s => s.category === '静态贴纸').map(s => {
                  const applied = tracks.some(t => t.id === `sticker-${s.id}`);
                  return (
                    <button
                      key={s.id}
                      className={`aspect-square rounded border flex items-center justify-center text-2xl transition-all hover:-translate-y-0.5 ${applied ? 'border-indigo-500 bg-indigo-600/20 ring-1 ring-indigo-500/50 shadow-md shadow-indigo-500/20' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'}`}
                      onClick={() => toggleSticker(s.id, s.name)}
                      title={`点击添加/移除 ${s.name}`}
                    >
                      {s.emoji}
                    </button>
                  );
                })}
              </div>
            </CollapsibleSection>
            <CollapsibleSection title="文字模板">
              <div className="pt-2 grid grid-cols-2 gap-2">
                {STICKERS.filter(s => s.category === '文字模板').map(s => {
                  const applied = tracks.some(t => t.id === `sticker-${s.id}`);
                  return (
<Button variant="outline" aria-pressed={applied} onClick={() => toggleSticker(s.id, s.name)}>{s.emoji}</Button>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        )}

      </ScrollArea>}
    </div>
  );
}

// ── 面板3：文本与字幕 ────────────────────────────────────────────────────
function TextSubtitlePanel({
  tracks,
  setTracks,
  currentTime,
  duration,
  selectedFont,
  setSelectedFont,
  onAnalyze,
}: {
  tracks: TrackItem[];
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  currentTime: number;
  duration: number;
  selectedFont: string | null;
  setSelectedFont: (f: string | null) => void;
  onAnalyze: () => void;
}) {
  const [fontSearch, setFontSearch] = useState('');
  const [activeEntrance, setActiveEntrance] = useState<string | null>(null);
  const [activeExit, setActiveExit] = useState<string | null>(null);
  const [letterSpacing, setLetterSpacing] = useState([4]);
  const [lineHeight, setLineHeight] = useState([15]);
  const [shadowBlur, setShadowBlur] = useState([8]);
  const [strokeWidth, setStrokeWidth] = useState([0]);
  const [bgOpacity, setBgOpacity] = useState([0]);
  const [subtitleText, setSubtitleText] = useState('');
  const [batchEditOpen, setBatchEditOpen] = useState(false);

  const handleAddText = () => {
    if (!subtitleText.trim()) {
      toast.warning('请输入字幕文本内容');
      return;
    }
    const newItem: TrackItem = {
      id: `text-${Date.now()}`,
      trackId: 'text',
      name: subtitleText.trim(),
      start: Number(currentTime.toFixed(1)),
      duration: 3.5,
      type: 'text',
      fontStyle: selectedFont || 'fs1',
      entrance: activeEntrance || undefined,
      exit: activeExit || undefined,
    };
    setTracks(prev => [...prev, newItem].sort((a, b) => a.start - b.start));
    toast.success(`已添加字幕文本到时间轴：${subtitleText.trim()}`);
    setSubtitleText('');
  };

  const handleExportSrt = () => {
    const textTracks = tracks.filter(t => t.type === 'text').sort((a, b) => a.start - b.start);
    if (textTracks.length === 0) {
      toast.warning('当前时间轴暂无字幕片段，请先添加字幕');
      return;
    }
    const formatSrtTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    let srtContent = '';
    textTracks.forEach((item, index) => {
      srtContent += `${index + 1}\n`;
      srtContent += `${formatSrtTime(item.start)} --> ${formatSrtTime(item.start + item.duration)}\n`;
      srtContent += `${item.name}\n\n`;
    });
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Shopro_Subtitles_${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`🎉 已成功导出 ${textTracks.length} 条字幕为 SRT 文件！`);
  };

  const textTracksList = tracks.filter(t => t.type === 'text').sort((a, b) => a.start - b.start);

  return (
    <div className="flex flex-col h-full">
      <SearchBar placeholder="搜索字体、样式…" onSearch={setFontSearch} />
      <ScrollArea className="flex-1">
        {/* 快速添加文本 */}
        <div className="px-3 pt-3 pb-2 border-b border-zinc-800/50">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-indigo-500 placeholder-zinc-500"
              placeholder="输入文本内容，回车添加…"
              value={subtitleText}
              onChange={e => setSubtitleText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddText(); }}
            />
            <button
              className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] shrink-0 transition-colors font-medium"
              onClick={handleAddText}
            >
              添加
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 mt-1.5">将在当前指针 ({currentTime.toFixed(1)}s) 处插入字幕</p>
        </div>

        {/* 字体样式 */}
        <CollapsibleSection title="字体样式">
          {selectedFont && (
            <div className="mx-3 mb-2 px-2.5 py-1.5 bg-indigo-600/10 border border-indigo-600/30 rounded flex items-center justify-between">
              <span className="text-[11px] text-indigo-300 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-indigo-400" />
                已选花字样式：<strong className="text-white">{FONT_STYLES.find(f => f.id === selectedFont)?.name}</strong>
              </span>
              <button className="text-[10px] text-zinc-400 hover:text-zinc-200 underline" onClick={() => setSelectedFont(null)}>重置默认</button>
            </div>
          )}
          <div className="px-3 pt-1 grid grid-cols-2 gap-2">
            {FONT_STYLES.filter(f => f.name.includes(fontSearch) || fontSearch === '').map(f => (
              <button
                key={f.id}
                className={`aspect-[3/2] rounded border flex flex-col items-center justify-center gap-1 transition-all hover:-translate-y-0.5 ${selectedFont === f.id ? 'border-indigo-500 bg-indigo-600/20 ring-1 ring-indigo-500/50 shadow-md shadow-indigo-500/20' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'}`}
                style={{ fontWeight: f.weight }}
                onClick={() => { setSelectedFont(f.id); toast.success(`已切换字幕样式：${f.name}`); }}
              >
                <span className={cn(
                  "text-lg",
                  f.id === 'fs3' ? "bg-gradient-to-r from-red-400 via-amber-300 to-blue-400 text-transparent bg-clip-text font-black" :
                  f.id === 'fs4' ? "text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" :
                  "text-zinc-200"
                )}>{f.preview}</span>
                <span className="text-[10px] text-zinc-400">{f.name}</span>
              </button>
            ))}
          </div>
        </CollapsibleSection>

        {/* 入场动画 */}
        <CollapsibleSection title="入场动画">
          <div className="px-3 pt-1 grid grid-cols-2 gap-2">
            {TEXT_ANIMATIONS.filter(a => a.dir === '入场' && ['ta1', 'ta2'].includes(a.id)).map(a => (
              <button
                key={a.id}
                className={`py-2 rounded border text-[11px] transition-all ${activeEntrance === a.id ? 'border-indigo-500 bg-indigo-600/10 text-indigo-300 font-medium' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}
                onClick={() => {
                  const next = a.id === activeEntrance ? undefined : a.id;
                  setActiveEntrance(next || null);
                  setTracks(previous => previous.map(track => track.type === 'text' ? { ...track, entrance: next } : track));
                  toast.success(next ? `字幕入场动画已设置：${a.name}` : '已移除字幕入场动画');
                }}
              >
                {activeEntrance === a.id && <Check className="inline w-3 h-3 mr-1 text-indigo-400" />}{a.name}
              </button>
            ))}
          </div>
        </CollapsibleSection>

        {/* 出场动画 */}
        <CollapsibleSection title="出场动画" defaultOpen={false}>
          <div className="px-3 pt-1 grid grid-cols-2 gap-2">
            {TEXT_ANIMATIONS.filter(a => a.dir === '出场').map(a => (
              <button
                key={a.id}
                className={`py-2 rounded border text-[11px] transition-all ${activeExit === a.id ? 'border-indigo-500 bg-indigo-600/10 text-indigo-300 font-medium' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}
                onClick={() => {
                  const next = a.id === activeExit ? undefined : a.id;
                  setActiveExit(next || null);
                  setTracks(previous => previous.map(track => track.type === 'text' ? { ...track, exit: next } : track));
                  toast.success(next ? `字幕出场动画已设置：${a.name}` : '已移除字幕出场动画');
                }}
              >
                {activeExit === a.id && <Check className="inline w-3 h-3 mr-1 text-indigo-400" />}{a.name}
              </button>
            ))}
          </div>
        </CollapsibleSection>

        {/* 智能字幕识别 */}
        <CollapsibleSection title="智能字幕与编辑" badge="AI">
          <div className="px-3 pt-1 space-y-2">
            <div className="p-3 bg-indigo-600/10 border border-indigo-600/30 rounded-lg space-y-2">
              <p className="text-[11px] text-zinc-300">选择已上传的音频或视频，确认价格后按真实时间分段生成字幕</p>
              <Button
                size="sm"
                className="w-full h-8 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium"
                onClick={onAnalyze}
              >
                <Captions className="w-3.5 h-3.5 mr-1.5" />分析片段并生成字幕
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-8 text-zinc-300 hover:text-white border border-zinc-700 hover:bg-zinc-800 text-[11px]"
              onClick={() => setBatchEditOpen(true)}
            >
              <AlignCenter className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />批量编辑时间轴字幕 ({textTracksList.length}条)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-8 text-zinc-300 hover:text-white border border-zinc-700 hover:bg-zinc-800 text-[11px]"
              onClick={handleExportSrt}
            >
              <Download className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />导出 SRT 字幕文件
            </Button>
          </div>
        </CollapsibleSection>

        {/* 高级选项 */}
        <CollapsibleSection title="高级排版样式" defaultOpen={false}>
          <div className="px-3 pt-1 space-y-3">
            {[
              { label: '字间距', value: letterSpacing, set: setLetterSpacing, min: 0, max: 20, unit: 'px' },
              { label: '行距', value: lineHeight, set: setLineHeight, min: 10, max: 40, unit: 'px' },
              { label: '阴影模糊', value: shadowBlur, set: setShadowBlur, min: 0, max: 30, unit: 'px' },
              { label: '描边宽度', value: strokeWidth, set: setStrokeWidth, min: 0, max: 10, unit: 'px' },
              { label: '背景透明度', value: bgOpacity, set: setBgOpacity, min: 0, max: 100, unit: '%' },
            ].map(({ label, value, set, min, max, unit }) => (
              <div key={label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">{label}</span>
                  <span className="text-[10px] text-zinc-400 font-mono">{value[0]}{unit}</span>
                </div>
                <Slider value={value} onValueChange={set} min={min} max={max} className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
              </div>
            ))}
            <Button size="sm" variant="ghost" className="w-full h-8 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-[11px]" onClick={() => { setLetterSpacing([4]); setLineHeight([15]); setShadowBlur([8]); setStrokeWidth([0]); setBgOpacity([0]); toast.info('已重置样式参数'); }}>
              <RotateCcw className="w-3 h-3 mr-1.5" />重置样式
            </Button>
          </div>
        </CollapsibleSection>
      </ScrollArea>

      {/* 批量编辑字幕弹窗 */}
      <Dialog open={batchEditOpen} onOpenChange={setBatchEditOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800 text-zinc-200 p-4">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 border-b border-zinc-800 pb-2">
              <AlignCenter className="w-4 h-4 text-indigo-400" />
              批量编辑时间轴字幕 ({textTracksList.length}条)
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-2 py-2 pr-1">
            {textTracksList.length === 0 ? (
              <p className="text-center text-xs text-zinc-500 py-6">暂无字幕，请先输入添加或一键语音识别</p>
            ) : (
              textTracksList.map((t, idx) => (
                <div key={t.id} className="flex items-center gap-2 p-2 bg-zinc-800/60 rounded border border-zinc-700">
                  <span className="text-[10px] text-zinc-500 w-4 text-center">{idx + 1}</span>
                  <input
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-100 px-2 py-1 outline-none focus:border-indigo-500"
                    value={t.name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setTracks(prev => prev.map(item => item.id === t.id ? { ...item, name: newName } : item));
                    }}
                  />
                  <div className="flex items-center gap-1 text-[10px] text-zinc-400 shrink-0 font-mono">
                    <span>{t.start}s</span>
                    <span>-</span>
                    <span>{(t.start + t.duration).toFixed(1)}s</span>
                  </div>
                  <button
                    className="text-zinc-500 hover:text-red-400 p-1"
                    onClick={() => {
                      setTracks(prev => prev.filter(item => item.id !== t.id));
                      toast.info('已删除该字幕');
                    }}
                    title="删除此字幕"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="border-t border-zinc-800 pt-2 flex items-center justify-between sm:justify-between">
            <span className="text-[10px] text-zinc-500">修改后将即时同步至时间轴与播放画面</span>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs" onClick={() => setBatchEditOpen(false)}>
              完成编辑
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 面板4：画中画与叠加层 ────────────────────────────────────────────────
function PipPanel({
  tracks,
  setTracks,
  currentTime,
  materials,
  pipSettings,
  setPipSettings,
  pipLayers,
  setPipLayers,
}: {
  tracks: TrackItem[];
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  currentTime: number;
  materials: EditorMaterial[];
  pipSettings: PipSettings;
  setPipSettings: React.Dispatch<React.SetStateAction<PipSettings>>;
  pipLayers: PipLayer[];
  setPipLayers: React.Dispatch<React.SetStateAction<PipLayer[]>>;
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);

  const toggleLayerProp = (id: string, prop: 'visible' | 'locked') => {
    setPipLayers(prev => prev.map(l => l.id === id ? { ...l, [prop]: !l[prop] } : l));
    setTracks(previous => previous.map(track => track.id === id ? {
      ...track, ...(prop === 'visible' ? { hidden: !track.hidden } : { locked: !track.locked }),
    } : track));
    toast.success(prop === 'visible' ? '已切换画中画图层显示状态' : '已切换锁定状态');
  };

  const removeLayer = (id: string, name: string) => {
    setPipLayers(prev => prev.filter(l => l.id !== id));
    setTracks(prev => prev.filter(t => t.id !== id));
    toast.success(`已删除画中画图层：${name}`);
  };

  const handleSelectPipItem = async (material: EditorMaterial) => {
    if (tracks.length >= 80 || currentTime >= 599.9) { toast.error('工程已达到时长或元素上限'); return; }
    const { name, url } = material; const isVideo = material.type === 'video';
    let length: number;
    try { length = Math.min(await materialDuration(material), 600 - currentTime); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : '素材时长读取失败'); return; }
    const newId = 'pip-' + crypto.randomUUID();
    const newLayer: PipLayer = {
      id: newId,
      name: `画中画 · ${name}`,
      url,
      type: isVideo ? 'video' : 'image',
      visible: true,
      locked: false,
    };
    setPipLayers(prev => [...prev, newLayer]);

    const newTrack: TrackItem = {
      id: newId,
      trackId: 'pip',
      name: `画中画 · ${name}`,
      start: Number(currentTime.toFixed(1)),
      duration: length,
      type: isVideo ? 'video' : 'image',
      url,
    };
    setTracks(prev => [...prev, newTrack].sort((a, b) => a.start - b.start));
    setAddModalOpen(false);
    toast.success(`已添加画中画「${name}」到当前播放头 (${currentTime.toFixed(1)}s) 处！`);
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        {/* 叠加层管理 */}
        <CollapsibleSection title="画中画叠加层管理">
          <div className="px-3 pt-1 space-y-2">
            <Button
              size="sm"
              className="w-full h-8 bg-indigo-600 hover:bg-indigo-700 text-white border-0 text-[11px] font-medium"
              onClick={() => setAddModalOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />添加画中画视频/图片轨道
            </Button>
            {pipLayers.map(layer => (
              <div key={layer.id} className={`flex items-center gap-2 p-2 rounded border transition-colors ${layer.locked ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-700 bg-zinc-800/60 hover:border-zinc-600'}`}>
                <GripVertical className="w-3.5 h-3.5 text-zinc-600 cursor-grab shrink-0" />
                <span className="text-[11px] text-zinc-200 flex-1 truncate font-medium">{layer.name}</span>
                <button
                  className="shrink-0 p-1 hover:bg-zinc-700 rounded"
                  onClick={() => toggleLayerProp(layer.id, 'visible')}
                  title={layer.visible ? '隐藏图层' : '显示图层'}
                >
                  {layer.visible
                    ? <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    : <EyeOff className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />}
                </button>
                <button
                  className="shrink-0 p-1 hover:bg-zinc-700 rounded"
                  onClick={() => toggleLayerProp(layer.id, 'locked')}
                  title={layer.locked ? '解锁图层' : '锁定图层'}
                >
                  <Lock className={`w-3.5 h-3.5 ${layer.locked ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-400'}`} />
                </button>
                <button
                  className="shrink-0 p-1 hover:bg-zinc-700 rounded"
                  onClick={() => removeLayer(layer.id, layer.name)}
                  title="删除图层"
                >
                  <X className="w-3.5 h-3.5 text-zinc-500 hover:text-red-400 transition-colors" />
                </button>
              </div>
            ))}
            {pipLayers.length === 0 && (
              <p className="text-center text-[11px] text-zinc-500 py-3">暂无画中画图层，点击上方按钮添加</p>
            )}
          </div>
        </CollapsibleSection>

        {/* 混合模式 */}
        <CollapsibleSection title="混合模式 (Blend Mode)">
          <div className="px-3 pt-1">
            <div className="grid grid-cols-2 gap-1.5">
              {BLEND_MODES.map(mode => (
                <button
                  key={mode}
                  className={`py-1.5 text-[11px] rounded border transition-colors ${pipSettings.blendMode === mode ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300 font-medium' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}
                  onClick={() => {
                    setPipSettings(p => ({ ...p, blendMode: mode }));
                    toast.success(`画中画混合模式已切换为：${mode}`);
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </CollapsibleSection>

        {/* 变换调整 */}
        <CollapsibleSection title="画中画位置与尺寸">
          <div className="px-3 pt-1 space-y-3">
            {[
              { label: '位置X', icon: Move, value: pipSettings.x, set: (v: number) => setPipSettings(p => ({ ...p, x: v })), min: 0, max: 100, unit: '%' },
              { label: '位置Y', icon: Move, value: pipSettings.y, set: (v: number) => setPipSettings(p => ({ ...p, y: v })), min: 0, max: 100, unit: '%' },
              { label: '画中画缩放', icon: ZoomIn, value: pipSettings.scale, set: (v: number) => setPipSettings(p => ({ ...p, scale: v })), min: 10, max: 200, unit: '%' },
              { label: '旋转角度', icon: RotateCcw, value: pipSettings.rotation, set: (v: number) => setPipSettings(p => ({ ...p, rotation: v })), min: -180, max: 180, unit: '°' },
              { label: '不透明度', icon: Eye, value: pipSettings.opacity, set: (v: number) => setPipSettings(p => ({ ...p, opacity: v })), min: 0, max: 100, unit: '%' },
            ].map(({ label, icon: Icon, value, set, min, max, unit }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[11px] text-zinc-400 flex items-center gap-1"><Icon className="w-3 h-3 text-indigo-400" />{label}</span>
                  <span className="text-[10px] text-zinc-400 font-mono">{value}{unit}</span>
                </div>
                <Slider value={[value]} onValueChange={([v]) => set(v)} min={min} max={max} className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="w-full h-8 text-zinc-400 hover:text-zinc-200 border border-zinc-700 text-[11px]"
              onClick={() => {
                setPipSettings({ x: 75, y: 25, scale: 100, rotation: 0, opacity: 100, blendMode: '正常' });
                toast.info('已重置画中画变换参数（恢复右上角标准位置）');
              }}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />重置画中画位置与尺寸
            </Button>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="画中画位置预设">
          <div className="flex flex-wrap gap-2 px-3">
            <Button variant="outline" onClick={() => setPipSettings(previous => ({ ...previous, x: 75, y: 25, scale: 100 }))}>右上角</Button>
            <Button variant="outline" onClick={() => setPipSettings(previous => ({ ...previous, x: 25, y: 25, scale: 100 }))}>左上角</Button>
          </div>
        </CollapsibleSection>
      </ScrollArea>

      {/* 选择画中画素材弹窗 */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800 text-zinc-200 p-4">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 border-b border-zinc-800 pb-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              选择画中画素材 (视频/图片/角标)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!materials.some(material => material.type !== 'audio') && <p className="text-sm text-zinc-400">请先从媒体库上传或生成自己的图片、视频。</p>}
            {materials.length > 0 && (
              <div>
                <p className="text-[11px] text-zinc-400 mb-2 font-medium">从媒体库选择：</p>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                  {materials.filter(m => m.type !== 'audio').map(m => (
                    <button
                      key={m.id}
                      className="w-full flex items-center justify-between p-2 rounded bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700 text-left text-xs"
                      onClick={() => void handleSelectPipItem(m)}
                    >
                      <span className="truncate flex-1">{m.name}</span>
                      <span className="text-[10px] text-indigo-400 shrink-0 ml-2">选择添加 +</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-zinc-800 pt-2">
            <Button size="sm" variant="ghost" className="border border-zinc-700 text-zinc-400" onClick={() => setAddModalOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ── 面板6：动画与关键帧 ──────────────────────────────────────────────────
interface KeyframePanelProps {
  selectedTrackItem: string | null;
  tracks: TrackItem[];
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  currentTime: number;
  duration: number;
  scale: number[];
  setScale: (v: number[]) => void;
  opacity: number[];
  setOpacity: (v: number[]) => void;
}

function KeyframePanel({
  selectedTrackItem,
  tracks,
  setTracks,
  currentTime,
  duration,
  scale,
  setScale,
  opacity,
  setOpacity,
}: KeyframePanelProps) {
  const [selectedProp, setSelectedProp] = useState<string | null>('缩放');
  const [selectedCurve, setSelectedCurve] = useState('缓入缓出');
  const [keyframes, setKeyframes] = useState<Record<string, { pos: number; val: number }[]>>({
    '缩放': [{ pos: 0, val: 100 }, { pos: 50, val: 115 }, { pos: 100, val: 100 }],
    '不透明度': [{ pos: 0, val: 0 }, { pos: 20, val: 100 }, { pos: 80, val: 100 }, { pos: 100, val: 0 }],
  });

  const selectedItem = tracks.find(t => t.id === selectedTrackItem);

  const addKeyframe = (prop: string) => {
    const pos = Math.max(0, Math.min(100, Math.round((currentTime / Math.max(0.1, duration)) * 100)));
    const val = prop === '缩放' ? scale[0] : prop === '不透明度' ? opacity[0]
      : prop === '旋转' ? selectedItem?.rotation || 0 : prop === '位置X' ? selectedItem?.x || 0 : selectedItem?.y || 0;

    setKeyframes(prev => ({
      ...prev,
      [prop]: [...(prev[prop] || []).filter(k => Math.abs(k.pos - pos) > 2), { pos, val }].sort((a, b) => a.pos - b.pos),
    }));

    if (selectedTrackItem) {
      setTracks(prev => prev.map(t => {
        if (t.id === selectedTrackItem) {
          const curKfs = t.keyframes || [];
          return {
            ...t,
            keyframes: [...curKfs, { time: Number(Math.max(0, Math.min(t.duration, currentTime - t.start)).toFixed(2)),
              property: ({ 缩放: 'scale', 不透明度: 'opacity', 旋转: 'rotation', 位置X: 'x', 位置Y: 'y' } as Record<string, string>)[prop] || prop, value: val }],
          };
        }
        return t;
      }));
      toast.success(`已为「${selectedItem?.name}」在 ${currentTime.toFixed(1)}s 添加 ${prop} 关键帧 (值: ${val})`);
    } else {
      toast.success(`已在播放头 ${currentTime.toFixed(1)}s (${pos}%) 处记录 ${prop} 关键帧`);
    }
  };

  const removeKeyframe = (prop: string, idx: number) => {
    setKeyframes(prev => ({ ...prev, [prop]: prev[prop].filter((_, i) => i !== idx) }));
    const property = ({ 缩放: 'scale', 不透明度: 'opacity', 旋转: 'rotation', 位置X: 'x', 位置Y: 'y' } as Record<string, string>)[prop];
    setTracks(previous => previous.map(track => {
      if (track.id !== selectedTrackItem) return track;
      let position = -1;
      return { ...track, keyframes: track.keyframes?.filter(frame => {
        if (![property, prop].includes(frame.property)) return true;
        position++; return position !== idx;
      }) };
    }));
    toast.info('已移除关键帧');
  };

  const handleApplyPreset = (preset: string) => {
    if (!selectedTrackItem) {
      toast.warning('请先在下方时间轴点击选中一个轨道片段（视频/图片/文字）');
      return;
    }

    if (preset === '弹入弹出') {
      setScale([100]);
      setOpacity([100]);
      setKeyframes(prev => ({
        ...prev,
        '缩放': [{ pos: 0, val: 20 }, { pos: 25, val: 115 }, { pos: 40, val: 100 }, { pos: 85, val: 100 }, { pos: 100, val: 0 }],
      }));
    } else if (preset === '缩放放大') {
      setScale([120]);
      setKeyframes(prev => ({
        ...prev,
        '缩放': [{ pos: 0, val: 100 }, { pos: 100, val: 125 }],
      }));
    } else if (preset === '旋转进场') {
      setKeyframes(prev => ({
        ...prev,
        '旋转': [{ pos: 0, val: -180 }, { pos: 30, val: 0 }],
      }));
    } else if (preset === '位移滑入') {
      setKeyframes(prev => ({
        ...prev,
        '位置X': [{ pos: 0, val: -80 }, { pos: 25, val: 0 }],
      }));
    } else if (preset === '呼吸循环') {
      setScale([105]);
      setKeyframes(prev => ({
        ...prev,
        '缩放': [{ pos: 0, val: 100 }, { pos: 50, val: 110 }, { pos: 100, val: 100 }],
      }));
    } else {
      setKeyframes(prev => ({
        ...prev,
        '位置X': [{ pos: 0, val: 0 }, { pos: 25, val: -5 }, { pos: 50, val: 5 }, { pos: 75, val: -3 }, { pos: 100, val: 0 }],
      }));
    }

    setTracks(prev => prev.map(t => {
      if (t.id === selectedTrackItem) {
        const presetFrames: Record<string, [number, number][]> = {
          弹入弹出: [[0, 20], [.25, 115], [.4, 100], [.85, 100], [1, 1]],
          缩放放大: [[0, 100], [1, 125]], 旋转进场: [[0, -180], [.3, 0]],
          位移滑入: [[0, -80], [.25, 0]], 呼吸循环: [[0, 100], [.5, 110], [1, 100]],
        };
        const property = preset === '旋转进场' ? 'rotation' : preset === '位移滑入' ? 'x' : 'scale';
        return {
          ...t,
          scale: preset === '缩放放大' ? 120 : preset === '呼吸循环' ? 105 : 100,
          keyframes: [...(t.keyframes || []).filter(frame => frame.property !== property),
            ...(presetFrames[preset] || [[0, 0], [.25, -5], [.5, 5], [.75, -3], [1, 0]]).map(([time, value]) => ({
              property: presetFrames[preset] ? property : 'x', time: time * t.duration, value,
            }))],
        };
      }
      return t;
    }));

    toast.success(`已为「${selectedItem?.name}」应用预设动画：${preset}`);
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        {/* 当前选中片段提示 */}
        <div className="px-3 pt-2 pb-1">
          <div className="p-2 rounded bg-zinc-800/60 border border-zinc-700/60 flex items-center justify-between text-xs">
            <span className="text-zinc-400 truncate">
              目标: <span className="text-indigo-300 font-medium">{selectedItem ? selectedItem.name : '未选择片段（请在时间轴选中）'}</span>
            </span>
            {selectedItem && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/30 text-indigo-300 shrink-0 ml-1">
                {selectedItem.type}
              </span>
            )}
          </div>
        </div>

        {/* 属性关键帧 */}
        <CollapsibleSection title="属性关键帧">
          <div className="px-3 pt-1 space-y-1.5">
            {KF_PROPERTIES.map(prop => (
              <div key={prop} className={`rounded border cursor-pointer transition-colors ${selectedProp === prop ? 'border-indigo-500 bg-indigo-600/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'}`}>
                <div
                  className="flex items-center justify-between p-2"
                  onClick={() => setSelectedProp(prop === selectedProp ? null : prop)}
                >
                  <span className="text-[11px] text-zinc-300">{prop}</span>
                  <div className="flex items-center gap-2">
                    {keyframes[prop]?.length > 0 && (
                      <span className="text-[10px] text-indigo-400 bg-indigo-600/20 px-1.5 rounded">{keyframes[prop].length} 帧</span>
                    )}
                    <button
                      className="text-zinc-500 hover:text-indigo-400 transition-colors p-1"
                      onClick={e => { e.stopPropagation(); addKeyframe(prop); }}
                      title="在当前播放位置添加关键帧"
                    >
                      <Plus className="w-4 h-4 text-indigo-400" />
                    </button>
                  </div>
                </div>
                {/* 展开关键帧列表 */}
                {selectedProp === prop && keyframes[prop]?.length > 0 && (
                  <div className="border-t border-zinc-700/50 px-2 py-1.5 space-y-1">
                    <div className="relative h-8 bg-zinc-900 rounded">
                      {keyframes[prop].map((kf, i) => (
                        <button
                          key={i}
                          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-indigo-400 rotate-45 hover:bg-indigo-300 transition-colors"
                          style={{ left: `calc(${kf.pos}% - 5px)` }}
                          onClick={() => removeKeyframe(prop, i)}
                          title={`时间位置: ${kf.pos}% | 值: ${kf.val} — 点击删除`}
                        />
                      ))}
                    </div>
                    <p className="text-[9px] text-zinc-500 text-center">点击菱形删除关键帧</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* 动画曲线 */}
        <CollapsibleSection title="动画曲线预设">
          <div className="px-3 pt-1 grid grid-cols-2 gap-1.5">
            {KF_CURVES.map(curve => (
              <button
                key={curve}
                className={`py-2 text-[11px] rounded border transition-colors ${selectedCurve === curve ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300 font-medium' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}`}
                onClick={() => { setSelectedCurve(curve); toast.success(`已切换动画曲线：${curve}`); }}
              >
                {selectedCurve === curve && <Check className="inline w-3 h-3 mr-1" />}{curve}
              </button>
            ))}
          </div>
        </CollapsibleSection>

        {/* 关键帧时间轴可视化 */}
        <CollapsibleSection title="时间轴预览">
          <div className="px-3 pt-1">
            <div className="bg-zinc-800 rounded border border-zinc-700 p-2 space-y-2">
              {KF_PROPERTIES.slice(0, 3).map(prop => (
                <div key={prop} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 w-12 shrink-0 truncate">{prop}</span>
                  <div className="flex-1 h-5 bg-zinc-900 rounded relative overflow-hidden cursor-pointer"
                    onClick={() => addKeyframe(prop)}>
                    {(keyframes[prop] || [{ pos: 10, val: 0 }, { pos: 55, val: 80 }, { pos: 85, val: 100 }]).map((kf, i) => (
                      <div
                        key={i}
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-indigo-400 rounded-full"
                        style={{ left: `${kf.pos}%` }}
                      />
                    ))}
                    <div className="absolute top-1/2 -translate-y-px h-px bg-indigo-400/30 inset-x-2" />
                  </div>
                  <button className="shrink-0 text-zinc-500 hover:text-zinc-300" onClick={() => addKeyframe(prop)}>
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500 text-center mt-2">点击轨道添加关键帧 · 当前曲线: {selectedCurve}</p>
          </div>
        </CollapsibleSection>

        {/* 快捷动画预设 */}
        <CollapsibleSection title="快捷动画预设">
          <div className="px-3 pt-1 grid grid-cols-2 gap-2">
            {['弹入弹出', '旋转进场', '缩放放大', '位移滑入', '抖动强调', '呼吸循环'].map(preset => (
              <button
                key={preset}
                className="py-2.5 text-[11px] text-zinc-300 bg-zinc-800/80 rounded border border-zinc-700 hover:border-indigo-500/80 hover:bg-indigo-600/10 hover:text-indigo-200 transition-all font-medium"
                onClick={() => handleApplyPreset(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </CollapsibleSection>

        <div className="px-3 py-3 border-t border-zinc-800">
          <Button size="sm" className="w-full h-8 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px]"
            onClick={() => {
              if (selectedTrackItem) {
                toast.success(`关键帧动画已成功写入「${selectedItem?.name}」并应用到播放时间轴`);
              } else {
                toast.info('关键帧动画已记录，请在时间轴选中片段后绑定');
              }
            }}>
            <Check className="w-3.5 h-3.5 mr-1.5" />应用动画到片段
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}

// ── AI工具操作抽屉 ────────────────────────────────────────────────────────
function AiToolDialog({ tool, open, onClose, onApply, currentChroma }: {
  tool: typeof AI_TOOLS[0] | null;
  open: boolean;
  onClose: () => void;
  onApply: (toolId: string, chroma?: ChromaSettings) => void;
  currentChroma: ChromaSettings;
}) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [chroma, setChroma] = useState<ChromaSettings>({ ...DEFAULT_CHROMA });

  useEffect(() => { if (!open) { setRunning(false); setDone(false); } }, [open]);
  useEffect(() => { if (open) setChroma({ ...currentChroma }); }, [open, currentChroma]);

  const handleRun = async () => {
    if (!tool) return;
    setRunning(true);
    setDone(false);
    try { onApply(tool.id, tool.id === 'ai1' ? chroma : undefined); setDone(true); }
    finally { setRunning(false); }
  };

  if (!tool) return null;
  const Icon = tool.icon;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center ${tool.color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{tool.name}</div>
              <div className="text-[11px] text-zinc-400 font-normal">{tool.desc}</div>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          {/* AI工具参数区 */}
          {tool.id === 'ai1' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-300">移除主视频中接近指定颜色的像素，适用于绿幕、蓝幕或纯色背景。主体含同色时也会被移除；请在成片中检查边缘效果。</p>
              <label className="flex items-center justify-between gap-3 text-xs text-zinc-300">
                背景颜色<input type="color" aria-label="色键背景颜色" value={chroma.color}
                  onChange={e => setChroma(p => ({ ...p, color: e.target.value }))} />
              </label>
              {([{ key: 'similarity', label: '颜色容差', min: .01 }, { key: 'smoothness', label: '边缘平滑', min: 0 }] as const).map(({ key, label, min }) => (
                <label key={key} className="flex items-center justify-between gap-3 text-xs text-zinc-300">
                  {label}<input type="number" aria-label={label} min={min} max={1} step={.01}
                    className="w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1" value={chroma[key]}
                    onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= min && value <= 1) setChroma(p => ({ ...p, [key]: value })); }} />
                </label>
              ))}
              <Button variant="ghost" size="sm" onClick={() => { onApply('ai1'); onClose(); }}>关闭色键去背景</Button>
            </div>
          )}
          {tool.id === 'ai2' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-300">切换画面提亮预设：亮度106%、对比度103%、饱和度108%。调整会写入成片；精细调整请选中轨道修改参数。</p>
            </div>
          )}
          {tool.id === 'ai7' && <p className="text-xs text-zinc-300">
            使用固定人物分割模型逐帧移除背景，应用到主视频并写入成片。头发、遮挡和快速移动的边缘需检查导出效果。
          </p>}
          {(tool.id === 'ai5' || tool.id === 'ai6') && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-300">打开脚本工作台，以商品事实和授权知识生成文案或结构化分镜，再选择自己的素材进行剪辑。</p>
            </div>
          )}

          {/* 进度/结果 */}
          {running && (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-600/10 border border-indigo-600/30 rounded">
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
              <span className="text-[12px] text-indigo-300">AI 算法处理中，正在生成轨道结果…</span>
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-600/10 border border-emerald-600/30 rounded">
              <BadgeCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-[12px] text-emerald-300">设置已更新，导出后可检查实际成片。</span>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="border border-zinc-700 text-zinc-400 hover:text-zinc-200" onClick={onClose}>关闭</Button>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleRun} disabled={running || done}>
            {running ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />计算中…</> : done ? <><Check className="w-3.5 h-3.5 mr-1.5" />已完成</> : <><Wand2 className="w-3.5 h-3.5 mr-1.5" />立即执行</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 面板7：AI工具入口 ────────────────────────────────────────────────────
interface AiToolsPanelProps {
  onApplyAiTool: (toolId: string, chroma?: ChromaSettings) => void;
  chromaSettings: ChromaSettings;
  tracks: TrackItem[];
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  currentTime: number;
}

function AiToolsPanel({ onApplyAiTool, tracks, setTracks, currentTime, chromaSettings }: AiToolsPanelProps) {
  const [selectedTool, setSelectedTool] = useState<typeof AI_TOOLS[0] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openTool = (tool: typeof AI_TOOLS[0]) => {
    if (tool.id === 'ai3' || tool.id === 'ai4') { onApplyAiTool(tool.id); return; }
    setSelectedTool(tool);
    setDialogOpen(true);
  };

  const handleImportStoryboard = (name: string) => {
    onApplyAiTool('ai5');
  };

  return (
    <div className="flex flex-col h-full">
      <AiToolDialog
        currentChroma={chromaSettings}
        tool={selectedTool}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onApply={(toolId, chroma) => {
          onApplyAiTool(toolId, chroma);
        }}
      />
      <ScrollArea className="flex-1">
        <CollapsibleSection title="核心AI工具箱">
          <div className="px-3 pt-1 space-y-2">
            {AI_TOOLS.map(tool => (
              <button
                key={tool.id}
                aria-label={tool.name}
                className="w-full flex items-center gap-3 p-3 bg-zinc-800/60 border border-zinc-700 rounded hover:border-zinc-500 hover:bg-zinc-800 transition-all group text-left"
                onClick={() => openTool(tool)}
              >
                <div className={`w-9 h-9 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform ${tool.color}`}>
                  <tool.icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-zinc-200">{tool.name}</span>
                    <span className="px-1.5 py-0.5 text-[9px] bg-zinc-700 text-zinc-400 rounded">{tool.badge}</span>
                  </div>
                  <p className="text-[10px] text-zinc-500">{tool.desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0 group-hover:text-zinc-300 transition-colors" />
              </button>
            ))}
          </div>
        </CollapsibleSection>

        {/* 创作脚本模板 */}
        <CollapsibleSection title="带货分镜脚本模板">
          <div className="px-3 pt-1 space-y-2">
            {[
              { name: '带货开场钩子模板', desc: '3秒黄金痛点抓取，快速拉升留存率' },
              { name: '产品细节微距分镜', desc: '4秒多角度微距展示与品质感特写' },
              { name: '核心卖点痛点解决', desc: '对比实验/实景使用场景演示' },
              { name: '促销促单结尾模板', desc: '限时秒杀话术 + 紧迫感动作指引' },
            ].map(({ name, desc }) => (
              <button key={name} className="w-full flex items-start gap-2 p-2.5 bg-zinc-800/50 border border-zinc-700 rounded hover:border-indigo-500/50 hover:bg-indigo-600/5 transition-colors text-left group"
                onClick={() => handleImportStoryboard(name)}>
                <BookOpen className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-zinc-200 font-medium">{name}</p>
                  <p className="text-[10px] text-zinc-500">{desc}</p>
                </div>
                <Download className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5 group-hover:text-indigo-400" />
              </button>
            ))}
          </div>
        </CollapsibleSection>
      </ScrollArea>
    </div>
  );
}

// ── 左侧边栏主组件 ────────────────────────────────────────────────────────
const PANEL_ITEMS: { id: PanelId; icon: React.ElementType; label: string; shortLabel: string; shortcut: string }[] = [
  { id: 'media', icon: Film, label: '媒体库', shortLabel: '媒体库', shortcut: 'M' },
  { id: 'effects', icon: Sparkles, label: '效果', shortLabel: '效果', shortcut: 'E' },
  { id: 'text', icon: Type, label: '字幕', shortLabel: '字幕', shortcut: 'T' },
  { id: 'pip', icon: Layers, label: '画中画', shortLabel: '画中画', shortcut: 'P' },
  { id: 'audio', icon: Music2, label: '音频编辑', shortLabel: '音频', shortcut: 'A' },
  { id: 'keyframe', icon: Waypoints, label: '关键帧', shortLabel: '关键帧', shortcut: 'K' },
  { id: 'ai', icon: Wand2, label: 'AI工具', shortLabel: 'AI工具', shortcut: 'I' },
  { id: 'shop', icon: FolderOpen, label: '资源库', shortLabel: '资源库', shortcut: 'S' },
];

interface LeftSidebarProps {
  chromaSettings: ChromaSettings;
  materials: EditorMaterial[];
  onAdd: (m: EditorMaterial) => void | Promise<void>;
  importedVideos: { id: string; title: string; video_url: string; thumbnail_url: string | null }[];
  onImportVideo: (v: { id: string; title: string; video_url: string; thumbnail_url: string | null }) => void;
  onUpload: (file: File, rightsConfirmed: boolean) => Promise<void>;
  onDelete: (id: string) => void;
  // Panel 2 Effects
  appliedFilter: string;
  setAppliedFilter: (f: string) => void;
  filterIntensity: Record<string, number>;
  setFilterIntensity: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  appliedTrans: string;
  setAppliedTrans: (t: string) => void;
  // Panel 3 Text
  selectedFont: string;
  setSelectedFont: (f: string) => void;
  // Panel 4 PIP
  pipSettings: PipSettings;
  setPipSettings: React.Dispatch<React.SetStateAction<PipSettings>>;
  pipLayers: PipLayer[];
  setPipLayers: React.Dispatch<React.SetStateAction<PipLayer[]>>;
  // Panel 5 Audio
  videoRef: React.RefObject<HTMLVideoElement>;
  // Panel 6 Keyframes
  selectedTrackItem: string | null;
  duration: number;
  scale: number[];
  setScale: (v: number[]) => void;
  opacity: number[];
  setOpacity: (v: number[]) => void;
  // Panel 7 AI & Panel 8 Shop
  onApplyAiTool: (toolId: string, chroma?: ChromaSettings) => void;
  userId?: string; onRecord: () => void;
  // Shared
  tracks: TrackItem[];
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>;
  currentTime: number;
}

function LeftSidebar({
  materials,
  onAdd,
  importedVideos,
  onImportVideo,
  onUpload,
  onDelete,
  appliedFilter,
  setAppliedFilter,
  filterIntensity,
  setFilterIntensity,
  appliedTrans,
  setAppliedTrans,
  selectedFont,
  setSelectedFont,
  pipSettings,
  setPipSettings,
  pipLayers,
  setPipLayers,
  videoRef,
  selectedTrackItem,
  duration,
  scale,
  setScale,
  opacity,
  setOpacity,
  onApplyAiTool,
  userId, onRecord,
  tracks,
  setTracks,
  currentTime,
  chromaSettings,
}: LeftSidebarProps) {
  const [activePanel, setActivePanel] = useState<PanelId>('media');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable],button,[role=dialog]')) return;
      const item = PANEL_ITEMS.find(p => p.shortcut.toLowerCase() === e.key.toLowerCase());
      if (item) { setActivePanel(item.id); setCollapsed(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    // 移动端：占满一行宽度并限高内部滚动；lg 及以上恢复固定列宽
    <div className={`flex shrink-0 border-r border-zinc-800 transition-all duration-300 max-lg:max-h-[32%] ${collapsed ? 'w-14' : 'w-full lg:w-80'}`}>
      {/* 垂直图标导航栏 */}
      <div className="w-14 shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col py-2 gap-0.5 overflow-y-auto">
        {PANEL_ITEMS.map(item => (
          <button
            key={item.id}
            title={`${item.label} (${item.shortcut})`}
            aria-label={`${item.label} (${item.shortcut})`}
            className={`relative mx-1 w-12 h-12 rounded flex flex-col items-center justify-center gap-0.5 transition-all group ${activePanel === item.id && !collapsed
              ? 'bg-indigo-600/20 text-indigo-400 ring-1 ring-inset ring-indigo-600/40'
              : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
            onClick={() => {
              if (activePanel === item.id) { setCollapsed(!collapsed); }
              else { setActivePanel(item.id); setCollapsed(false); }
            }}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] leading-none mt-0.5 tracking-tight">{item.shortLabel}</span>
            {/* 激活指示条 */}
            {activePanel === item.id && !collapsed && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-400 rounded-r" />
            )}
            {/* 悬停标签 */}
            <div className="absolute left-12 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
              {item.label} <span className="text-zinc-500 ml-1">{item.shortcut}</span>
            </div>
          </button>
        ))}
        {/* 折叠按钮 */}
        <div className="flex-1" />
        <button
          className="mx-1 w-12 h-10 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开面板' : '收起面板'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* 内容面板 */}
      {!collapsed && (
        <div className="flex-1 min-w-0 flex flex-col bg-zinc-900">
          {/* 面板标题 */}
          <div className="h-10 border-b border-zinc-800 flex items-center px-3 shrink-0">
            {(() => { const cur = PANEL_ITEMS.find(p => p.id === activePanel); return cur ? <><cur.icon className="w-4 h-4 text-zinc-400 mr-2" /><span className="text-xs font-medium text-zinc-300">{cur.label}</span></> : null; })()}
          </div>
          {/* 面板内容 */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activePanel === 'media' && (
              <MediaLibraryPanel
                materials={materials}
                onAdd={onAdd}
                importedVideos={importedVideos}
                onImportVideo={onImportVideo}
                onUpload={onUpload}
                onDelete={onDelete}
              />
            )}
            {activePanel === 'effects' && (
              <EffectsPanel userId={userId} onAdd={onAdd}
                appliedFilter={appliedFilter}
                setAppliedFilter={setAppliedFilter}
                filterIntensity={filterIntensity}
                setFilterIntensity={setFilterIntensity}
                appliedTrans={appliedTrans}
                setAppliedTrans={setAppliedTrans}
                tracks={tracks}
                setTracks={setTracks}
                currentTime={currentTime}
              />
            )}
            {activePanel === 'text' && (
              <TextSubtitlePanel
                tracks={tracks}
                setTracks={setTracks}
                currentTime={currentTime}
                duration={duration}
                selectedFont={selectedFont}
                setSelectedFont={setSelectedFont}
                onAnalyze={() => onApplyAiTool('ai4')}
              />
            )}
            {activePanel === 'pip' && (
              <PipPanel
                pipSettings={pipSettings}
                setPipSettings={setPipSettings}
                pipLayers={pipLayers}
                setPipLayers={setPipLayers}
                tracks={tracks}
                setTracks={setTracks}
                currentTime={currentTime}
                materials={materials}
              />
            )}
            {activePanel === 'audio' && <EditorAudioPanel tracks={tracks} setTracks={setTracks}
              selectedId={selectedTrackItem} currentTime={currentTime} onRecord={onRecord} />}
            {activePanel === 'keyframe' && (
              <KeyframePanel
                selectedTrackItem={selectedTrackItem}
                tracks={tracks}
                setTracks={setTracks}
                currentTime={currentTime}
                duration={duration}
                scale={scale}
                setScale={setScale}
                opacity={opacity}
                setOpacity={setOpacity}
              />
            )}
            {activePanel === 'ai' && (
              <AiToolsPanel
                chromaSettings={chromaSettings}
                onApplyAiTool={onApplyAiTool}
                tracks={tracks}
                setTracks={setTracks}
                currentTime={currentTime}
              />
            )}
            {activePanel === 'shop' && <EditorAssetsPanel userId={userId} onAdd={onAdd} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 视频预加载与内存 Blob 缓存系统 ───────────────────────────────────────

// ── 主页面组件 ───────────────────────────────────────────────────────────
const DEFAULT_TRACKS: TrackItem[] = [];

// 清理历史草稿/存档中遗留的「光晕特效」片段，保证效果轨初始为空
const stripLegacyGlowFx = (list: TrackItem[]) => list;

export default function VideoEditPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  return <VideoEditWorkspace key={`${user?.id || 'signed-out'}:${params.get('importId') || 'new'}`} />;
}

function VideoEditWorkspace() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const importId = searchParams.get('importId');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const [zoom, setZoom] = useState(0);
  const [selectedTrackItem, setSelectedTrackItem] = useState<string | null>(() => {
    return DEFAULT_TRACKS.find(t => t.type === 'video')?.id || null;
  });
  const [projectTitle, setProjectTitle] = useState('未命名项目');
  const [saving, setSaving] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [materials, setMaterials] = useState<EditorMaterial[]>([]);
  const timeline = useEditorHistory<TrackItem>(DEFAULT_TRACKS);
  const { tracks, setTracks } = timeline;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── 导出渲染控制与全阶段进度状态 ──
  const [exportStage, setExportStage] = useState<'idle' | 'rendering' | 'completed' | 'failed'>('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatusText, setExportStatusText] = useState('准备开始渲染...');
  const [exportResolution, setExportResolution] = useState<'1080p' | '720p' | '4k'>('1080p');
  const [exportFps, setExportFps] = useState<'30' | '60'>('30');
  const [exportFileName, setExportFileName] = useState('');
  const [exportLogs, setExportLogs] = useState<Array<{ time: string; stage: string; percent: number; done: boolean }>>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{
    video_url: string;
    thumbnail_url: string;
    title: string;
    duration: number;
    resolution: string;
    size: string;
    project_id: string;
  } | null>(null);
  const renderTask = useProductionJob('render', user?.id, importId);
  useEffect(() => {
    const job = renderTask.job;
    if (!job) return;
    setExportProgress(job.progress);
    if (job.status === 'pending' || job.status === 'running') {
      setExportStage('rendering'); setExporting(true);
      setExportStatusText(job.status === 'pending' ? '工程已排队，等待后台渲染' : 'FFmpeg正在合成时间轴，关闭页面后仍继续');
    } else if (job.status === 'completed' && job.result?.url) {
      setExportStage('completed'); setExporting(false);
      setExportResult({ video_url: job.result.url, thumbnail_url: job.result.thumbnail_url || '',
        title: projectTitle, duration: job.result.duration || duration, resolution: job.result.resolution || '',
        size: `${((job.result.size || 0) / 1024 / 1024).toFixed(1)} MB`, project_id: job.project_id || '' });
      window.dispatchEvent(new CustomEvent('shopro:works-updated'));
    } else if (['failed', 'unknown'].includes(job.status)) {
      setExportStage('failed'); setExporting(false); setExportError(job.error_message || '渲染失败');
    }
  }, [renderTask.job]);

  // 内部稳定跟踪当前项目 ID（消除路由异步更新延迟）
  const [scale, setScale] = useState([100]);
  const [opacity, setOpacity] = useState([100]);
  const [volume, setVolume] = useState([100]);
  const restoredAttributes = useRef<{ id: string; scale?: number[]; opacity?: number[]; volume?: number[] } | null>(null);
  const [editorAspect, setEditorAspect] = useState('aspect-video');
  const [timelineScrollOffset, setTimelineScrollOffset] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // 生成视频列表（用于一键导入）& 预览 URL
  const [importedVideos, setImportedVideos] = useState<{ id: string; title: string; video_url: string; thumbnail_url: string | null }[]>([]);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  // 播放主时钟引用：供 rAF 帧循环读取当前激活片段与预览源，避免依赖每次渲染新建的对象导致 effect 频繁重建
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const rulerPlayheadRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const bottomTimeDisplayRef = useRef<HTMLSpanElement>(null);
  const currentTimeRef = useRef<number>(0);
  const { cachedUrls, isPreloading, preloadProgress, getMedia } = useEditorMediaCache(tracks
    .filter(track => track.type === 'video' && track.url).map(track => track.url!).concat(previewVideoUrl ? [previewVideoUrl] : []));
  const activeVideoClipRef = useRef<TrackItem | undefined>(undefined);
  const previewVideoUrlRef = useRef<string | null>(null);

  // Sync ruler scroll offset with timeline scroll container
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const onScroll = () => setTimelineScrollOffset(el.scrollLeft);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 工程时长保持用户值，轨道增长时才扩展，短视频不强制补到30秒。
  useEffect(() => {
    const maxEndTime = tracks.reduce((max, item) => Math.max(max, item.start + item.duration), 0);
    const minNeeded = Math.max(.1, maxEndTime);
    if (duration < minNeeded) {
      setDuration(minNeeded);
    }
  }, [tracks, duration]);

  // Fullscreen handler
  const handleFullscreen = () => {
    const el = previewContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => toast.error('全屏失败'));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, []);

  const [dragInfo, setDragInfo] = useState<{
    id: string;
    startX: number;
    startY: number;
    initialStart: number;
    initialTrackId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const handleTrackItemMouseDown = (e: React.MouseEvent, item: TrackItem) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTrackItem(item.id);
    if (item.locked) return;
    setDragInfo({
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      initialStart: item.start,
      initialTrackId: item.trackId,
      offsetX: 0,
      offsetY: 0,
    });
  };

  useEffect(() => {
    if (!dragInfo) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragInfo.startX;
      const dy = e.clientY - dragInfo.startY;
      setDragInfo(prev => prev ? { ...prev, offsetX: dx, offsetY: dy } : null);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const dx = e.clientX - dragInfo.startX;
      const dy = e.clientY - dragInfo.startY;

      const item = tracks.find(t => t.id === dragInfo.id);
      if (item) {
        const trackContainer = rulerRef.current;
        let finalStart = item.start;
        if (trackContainer) {
          const ticksContainer = trackContainer.querySelector('.flex-1');
          if (ticksContainer) {
            const rect = ticksContainer.getBoundingClientRect();
            const scrollableWidth = rect.width;
            if (scrollableWidth > 0) {
              const secondsPerPixel = duration / scrollableWidth;
              const dt = dx * secondsPerPixel;
              finalStart = Math.max(0, Math.min(duration - item.duration, dragInfo.initialStart + dt));
            }
          }
        }

        const trackTypes: ('video' | 'audio' | 'text' | 'image')[] = ['video', 'audio', 'text', 'image'];
        const currentIdx = trackTypes.indexOf(item.type);
        const trackShift = Math.round(dy / 38);
        let newIdx = currentIdx + trackShift;
        newIdx = Math.max(0, Math.min(trackTypes.length - 1, newIdx));
        const newType = trackTypes[newIdx];
        const newTrackId = newType === 'text' ? 'text' : newType === 'image' ? 'effects' : newType;

        setTracks(prev => prev.map(t => {
          if (t.id === dragInfo.id) {
            return {
              ...t,
              start: Number(finalStart.toFixed(2)),
              type: newType,
              trackId: newTrackId,
            };
          }
          return t;
        }));

        if (newType !== item.type) {
          toast.success(`已将片段拖动至新轨道`, { description: `新位置: ${newType === 'video' ? '主视频' : newType === 'audio' ? '音频' : newType === 'text' ? '字幕' : '特效'}` });
        }
      }

      setDragInfo(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragInfo, tracks, duration]);

  const handleDeleteMaterial = async (id: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      setMaterials(prev => prev.filter(m => m.id !== id));
      toast.success('已从当前素材面板移除');
      return;
    }
    try {
      await deleteMaterial(id);
      setMaterials(prev => prev.filter(m => m.id !== id));
      toast.success('素材已从媒体库删除');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '素材删除失败');
    }
  };

  // Timeline layout constants — px-per-second based
  const TRACK_LABEL_W = 60; // width of the track icon label column in px
  const TRACK_CONTENT_OFFSET = TRACK_LABEL_W + 12; // 60 + 6 (padding) + 6 (gap) = 72px
  const BASE_PX_PER_SEC = 20; // at zoom=0 each second = 20px
  const pxPerSec = BASE_PX_PER_SEC * (1 + zoom * 0.08); // zoom 0→100 scales 20→180px/s
  const timelinePxWidth = TRACK_CONTENT_OFFSET + duration * pxPerSec;
  const timelineMinWidth = 600; // minimum scrollable width


  // Find active video/image clip under the playhead (prioritize selected and newest clips)
  const activeVideoClip = (() => {
    const selectedClip = tracks.find(t => t.id === selectedTrackItem && t.type === 'video' && t.trackId !== 'pip' && !t.hidden);
    if (selectedClip) {
      const end = selectedClip.start + selectedClip.duration;
      if (currentTime >= selectedClip.start && currentTime <= end) {
        return selectedClip;
      }
    }
    return tracks.slice().reverse().find(track => {
      const end = track.start + track.duration;
      return currentTime >= track.start && currentTime < end && track.type === 'video' && track.trackId !== 'pip' && !track.hidden;
    });
  })();
  activeVideoClipRef.current = activeVideoClip;
  previewVideoUrlRef.current = previewVideoUrl;

  const activeImageClip = (() => {
    const selectedClip = tracks.find(t => t.id === selectedTrackItem && t.type === 'image' && t.trackId === 'image');
    if (selectedClip) {
      const end = selectedClip.start + selectedClip.duration;
      if (currentTime >= selectedClip.start && currentTime <= end) {
        return selectedClip;
      }
    }
    return tracks.slice().reverse().find(track => {
      const end = track.start + track.duration;
      return currentTime >= track.start && currentTime <= end && track.type === 'image' && track.trackId === 'image';
    });
  })();

  // 播放头下方激活的字幕片段
  const activeTextClips = (() => {
    return tracks.filter(track => {
      const end = track.start + track.duration;
      return currentTime >= track.start && currentTime < end && !track.hidden && track.type === 'text';
    });
  })();

  // 播放头下方激活的画中画片段
  const activePipClip = (() => {
    return tracks.find(track => {
      const end = track.start + track.duration;
      return currentTime >= track.start && currentTime < end && !track.hidden && (track.trackId === 'pip' || track.id.startsWith('pip-'));
    });
  })();

  // 播放头下方激活的贴纸/特效片段
  const activeStickerClip = (() => {
    return tracks.find(track => {
      const end = track.start + track.duration;
      return currentTime >= track.start && currentTime < end && !track.hidden && track.type === 'image'
        && (track.trackId === 'sticker' || track.id.startsWith('sticker-') || track.trackId === 'effects');
    });
  })();

  // 参真实与预览播放的全部音频轨片段（隐藏 <audio> 播放器驱动）
  const audioMediaClips = tracks.filter(t => t.type === 'audio' && t.url);

  // ── 8大面板核心业务状态 ──────────────────────────────────────────
  const [appliedFilter, setAppliedFilter] = useState('无');
  const [filterIntensity, setFilterIntensity] = useState<Record<string, number>>({
    '电影质感': 80,
    '温暖午后': 75,
    '日系清新': 80,
    '复古胶片': 85,
    '清爽胶片': 75,
  });
  const [appliedTrans, setAppliedTrans] = useState('无');
  const [selectedFont, setSelectedFont] = useState('默认黑体');
  const [pipSettings, setPipSettings] = useState<PipSettings>({
    x: 75,
    y: 25,
    scale: 100,
    rotation: 0,
    opacity: 100,
    blendMode: '正常',
  });
  const [pipLayers, setPipLayers] = useState<PipLayer[]>([]);
  useEffect(() => {
    setPipLayers(tracks.filter(track => track.trackId === 'pip' && ['video', 'image'].includes(track.type)).map(track => ({
      id: track.id, name: track.name, url: track.url, type: track.type as 'video' | 'image', visible: !track.hidden, locked: !!track.locked,
    })));
  }, [tracks]);
  const [aiBeautyEnabled, setAiBeautyEnabled] = useState(false);
  const [aiCutoutEnabled, setAiCutoutEnabled] = useState(false);
  const [personCutoutEnabled, setPersonCutoutEnabled] = useState(false);
  const [editMode, setEditMode] = useState<'beats' | 'subtitles' | null>(searchParams.has('editJob') ? 'subtitles' : null);
  const [chromaSettings, setChromaSettings] = useState<ChromaSettings>({ ...DEFAULT_CHROMA });

  // AI 工具执行回调
  const handleApplyAiTool = useCallback((toolId: string, chroma?: ChromaSettings) => {
    if (toolId === 'ai1') {
      if (chroma) {
        setChromaSettings(chroma); setAiCutoutEnabled(true); setPersonCutoutEnabled(false);
        toast.success('色键去背景已启用，导出成片时执行');
      } else { setAiCutoutEnabled(false); toast.info('已关闭色键去背景'); }
    } else if (toolId === 'ai2') {
      setAiBeautyEnabled(prev => {
        const next = !prev;
        if (next) toast.success('已启用画面提亮');
        else toast.info('已关闭画面提亮');
        return next;
      });
    } else if (toolId === 'ai7') {
      setPersonCutoutEnabled(prev => !prev); setAiCutoutEnabled(false);
      toast.info('人物分割设置已切换，导出时逐帧处理');
    } else if (toolId === 'ai3' || toolId === 'ai4') {
      setEditMode(toolId === 'ai3' ? 'beats' : 'subtitles');
    } else if (toolId === 'ai5' || toolId === 'ai6') {
      navigate('/script');
    }
  }, [navigate]);


  const hasVideoClips = tracks.some(t => t.type === 'video' && t.trackId !== 'pip' && !t.hidden);
  const rawVideoSrc = activeVideoClip?.url
    ? activeVideoClip.url
    : hasVideoClips
      ? undefined
      : (previewVideoUrl || undefined);
  const currentVideoSrc = (rawVideoSrc && cachedUrls[rawVideoSrc]) ? cachedUrls[rawVideoSrc] : rawVideoSrc;

  // Selected track item object (默认回退展示主视频轨道)
  const mainVideoTrack = tracks.find(t => t.type === 'video') || tracks[0];
  const selectedTrackObj = tracks.find(t => t.id === selectedTrackItem) || mainVideoTrack;

  // 画面预览特效以“播放头下的激活片段”为准，无激活片段时回退选中片段，避免选中文案/音频时主画面属性被重置
  const videoFxClip = activeVideoClip ?? selectedTrackObj;

  const [speed, setSpeed] = useState(1);

  // 确保当选中片段不存在或未设置时，属性设置面板默认显示主视频轨道
  useEffect(() => {
    if (tracks.length > 0) {
      const exists = tracks.some(t => t.id === selectedTrackItem);
      if (!exists) {
        const main = tracks.find(t => t.type === 'video') || tracks[0];
        if (main) setSelectedTrackItem(main.id);
      }
    }
  }, [tracks, selectedTrackItem]);

  // Sync state with selected item attributes
  useEffect(() => {
    if (selectedTrackObj) {
      const restored = restoredAttributes.current?.id === selectedTrackObj.id ? restoredAttributes.current : null;
      setScale([selectedTrackObj.scale ?? restored?.scale?.[0] ?? 100]);
      setOpacity([selectedTrackObj.opacity ?? restored?.opacity?.[0] ?? 100]);
      setVolume([selectedTrackObj.volume ?? restored?.volume?.[0] ?? 100]);
      setSpeed(selectedTrackObj.speed ?? 1);
      restoredAttributes.current = null;
    }
  }, [selectedTrackObj?.id, selectedTrackObj?.scale, selectedTrackObj?.opacity, selectedTrackObj?.volume, selectedTrackObj?.speed]);

  const updateTrackItem = useCallback((id: string, updates: Partial<TrackItem>) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, ...updates };
      if (updates.text !== undefined && updates.name === undefined) {
        updated.name = updates.text.slice(0, 30) || '无标题文案';
      }
      return updated;
    }));
  }, []);

  // ── 音频轨真实播放引擎：隐藏播放器 + Web Audio 效果链（降噪EQ/Pan/混响/淡入淡出）──────
  interface AudioFxNodes {
    ctx: AudioContext;
    source: MediaElementAudioSourceNode;
    hp: BiquadFilterNode;
    lp: BiquadFilterNode;
    notch: BiquadFilterNode;
    equalizers: BiquadFilterNode[];
    panner: StereoAudioPannerNodeCompat;
    dry: GainNode;
    convolver: ConvolverNode;
    wetGain: GainNode;
    reverbName: string;
  }
  type StereoAudioPannerNodeCompat = StereoPannerNode;

  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioGraphRef = useRef<Record<string, AudioFxNodes>>({});
  const audioBlobCacheRef = useRef<Record<string, string>>({});
  const audioBlobPendingRef = useRef<Set<string>>(new Set());
  const audioBlobFailedRef = useRef<Set<string>>(new Set());
  const audioFxWarnedRef = useRef<Set<string>>(new Set());

  const getSharedAudioCtx = () => {
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        audioCtxRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    return audioCtxRef.current;
  };

  // 为指定片段懒创建 Web Audio 效果链；仅当媒体已被代理为同源 blob URL 时才能安全接入图谱（跨域直接路由会被浏览器静音）
  const ensureAudioGraph = (clipId: string, el: HTMLAudioElement): AudioFxNodes | null => {
    const existing = audioGraphRef.current[clipId];
    if (existing) return existing;
    const ctx = getSharedAudioCtx();
    if (!ctx || !el.src.startsWith('blob:')) return null;
    try {
      const source = ctx.createMediaElementSource(el);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 20;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      const notch = ctx.createBiquadFilter();
      notch.type = 'notch';
      notch.frequency.value = 1;
      const panner = ctx.createStereoPanner();
      const dry = ctx.createGain();
      dry.gain.value = 1;
      const convolver = ctx.createConvolver();
      const wetGain = ctx.createGain();
      wetGain.gain.value = 0;
      source.connect(hp);
      hp.connect(lp);
      lp.connect(notch);
      const equalizers = EQ_FREQUENCIES.map(frequency => {
        const node = ctx.createBiquadFilter(); node.type = 'peaking';
        node.frequency.value = frequency; node.Q.value = 1; return node;
      });
      notch.connect(equalizers[0]);
      equalizers.forEach((node, index) => node.connect(equalizers[index + 1] || panner));
      panner.connect(dry);
      dry.connect(ctx.destination);
      panner.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(ctx.destination);
      const nodes: AudioFxNodes = { ctx, source, hp, lp, notch, equalizers, panner, dry, convolver, wetGain, reverbName: '' };
      audioGraphRef.current[clipId] = nodes;
      return nodes;
    } catch {
      return null;
    }
  };

  // 将片段当前属性实时写入效果链节点（降噪分频/声像/混响湿声比例与脉冲响应）
  const applyAudioClipFxParams = (clip: TrackItem, nodes: AudioFxNodes) => {
    const level = DENOISE_LEVELS[clip.denoise || '无降噪'] || DENOISE_LEVELS['无降噪'];
    let hpHz = level.hp;
    let lpHz = level.lp;
    if (clip.reverb === '广播电台') {
      hpHz = Math.max(hpHz, 240);
      lpHz = Math.min(lpHz, 3600);
    }
    nodes.hp.frequency.setTargetAtTime(hpHz, nodes.ctx.currentTime, 0.03);
    nodes.lp.frequency.setTargetAtTime(lpHz, nodes.ctx.currentTime, 0.03);
    nodes.notch.frequency.setTargetAtTime(level.notch, nodes.ctx.currentTime, 0.03);
    nodes.equalizers.forEach((node, index) => node.gain.setTargetAtTime(clip.eqBands?.[EQ_FREQUENCIES[index]] || 0, nodes.ctx.currentTime, .03));
    nodes.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, (clip.pan ?? 0) / 100)), nodes.ctx.currentTime, 0.03);
    const preset = REVERB_PRESETS[clip.reverb || ''] || null;
    nodes.wetGain.gain.setTargetAtTime(preset ? preset.wet : 0, nodes.ctx.currentTime, 0.05);
    if (preset && nodes.reverbName !== clip.reverb) {
      try {
        nodes.convolver.buffer = makeReverbImpulse(nodes.ctx, preset.seconds, preset.decay);
        nodes.reverbName = clip.reverb!;
      } catch {
        console.warn('Reverb IR generate failed for:', clip.reverb);
      }
    }
  };

  const handleScaleChange = (val: number[]) => {
    setScale(val);
    const targetId = selectedTrackItem || selectedTrackObj?.id;
    if (targetId) {
      setTracks(prev => prev.map(t => t.id === targetId ? { ...t, scale: val[0] } : t));
    }
  };

  const handleOpacityChange = (val: number[]) => {
    setOpacity(val);
    const targetId = selectedTrackItem || selectedTrackObj?.id;
    if (targetId) {
      setTracks(prev => prev.map(t => t.id === targetId ? { ...t, opacity: val[0] } : t));
    }
  };

  const handleVolumeChange = (val: number[]) => {
    setVolume(val);
    const targetId = selectedTrackItem || selectedTrackObj?.id;
    if (targetId) {
      setTracks(prev => prev.map(t => t.id === targetId ? { ...t, volume: val[0] } : t));
    }
  };

  const handleSpeedChange = (val: number) => {
    setSpeed(val);
    const targetId = selectedTrackItem || selectedTrackObj?.id;
    if (targetId) {
      setTracks(prev => prev.map(t => t.id === targetId ? { ...t, speed: val } : t));
    }
  };

  const handleSplit = useCallback(() => {
    if (!selectedTrackItem) {
      toast.error('请先选择一个轨道片段');
      return;
    }
    const item = tracks.find(t => t.id === selectedTrackItem);
    if (!item) return;

    const relativePlayhead = currentTime - item.start;
    if (relativePlayhead <= 0.1 || relativePlayhead >= item.duration - 0.1) {
      toast.warning('当前播放指针不在选中片段范围内，或距离边缘太近');
      return;
    }

    const firstHalfDuration = relativePlayhead;
    const secondHalfDuration = item.duration - relativePlayhead;
    const frames = item.keyframes || [];
    const boundaryFrames = [...new Set(frames.map(frame => frame.property))].map(property => {
      const propertyKey = ({ 缩放: 'scale', 不透明度: 'opacity', 音量: 'volume', 旋转: 'rotation', 位置X: 'x', 位置Y: 'y' } as Record<string, string>)[property] || property;
      const base = Number((item as any)[propertyKey] ?? (['scale', 'opacity', 'volume'].includes(propertyKey) ? 100 : 0));
      const points = [{ time: 0, value: base }, ...frames.filter(frame => frame.property === property)].sort((a, b) => a.time - b.time);
      const before = points.filter(point => point.time <= relativePlayhead).at(-1)!;
      const after = points.find(point => point.time > relativePlayhead);
      const value = after ? before.value + (after.value - before.value) * (relativePlayhead - before.time) / (after.time - before.time) : before.value;
      return { property, time: relativePlayhead, value };
    });

    const firstHalf = {
      ...item,
      duration: Number(firstHalfDuration.toFixed(2)),
      keyframes: [...frames.filter(frame => frame.time < relativePlayhead), ...boundaryFrames],
    };

    const secondHalf = {
      ...item,
      sourceStart: item.type === 'image' || item.type === 'text' ? 0 : (item.sourceStart || 0) + relativePlayhead * (item.speed || 1),
      keyframes: [...boundaryFrames.map(frame => ({ ...frame, time: 0 })),
        ...frames.filter(frame => frame.time > relativePlayhead).map(frame => ({ ...frame, time: frame.time - relativePlayhead }))],
      id: `${item.id}_split_${Date.now()}`,
      name: `${item.name} (后半段)`,
      start: Number(currentTime.toFixed(2)),
      duration: Number(secondHalfDuration.toFixed(2)),
    };

    setTracks(prev => {
      const filtered = prev.filter(t => t.id !== selectedTrackItem);
      return [...filtered, firstHalf, secondHalf].sort((a, b) => a.start - b.start);
    });

    setSelectedTrackItem(firstHalf.id);
    toast.success('片段已成功分割');
  }, [selectedTrackItem, tracks, currentTime]);

  const handleCopy = useCallback(() => {
    if (!selectedTrackItem) {
      toast.error('请先选择一个轨道片段');
      return;
    }
    const item = tracks.find(t => t.id === selectedTrackItem);
    if (!item) return;

    const copyItem = {
      ...item,
      id: `${item.id}_copy_${Date.now()}`,
      name: `${item.name} (副本)`,
      start: Number((item.start + item.duration).toFixed(2)),
    };

    setTracks(prev => [...prev, copyItem]);
    setSelectedTrackItem(copyItem.id);
    toast.success('已复制片段并放置在原片段后方');
  }, [selectedTrackItem, tracks]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedTrackItem) {
      toast.error('请先选择一个轨道片段');
      return;
    }
    setTracks(prev => prev.filter(t => t.id !== selectedTrackItem));
    setSelectedTrackItem(null);
    toast.success('片段已成功删除');
  }, [selectedTrackItem]);

  // Sync volume and speed of the video element（尊重片段“静音/原声音量”属性，不再强制取消静音）
  useEffect(() => {
    if (videoRef.current) {
      const activeVol = activeVideoClip?.volume ?? 100;
      videoRef.current.volume = Math.max(0, Math.min(1, activeVol / 100));
      videoRef.current.muted = !!activeVideoClip?.mute;
    }
  }, [activeVideoClip, activeVideoClip?.volume, activeVideoClip?.mute, previewVideoUrl]);

  useEffect(() => {
    if (videoRef.current) {
      const activeSpeed = activeVideoClip?.speed ?? 1;
      videoRef.current.playbackRate = activeSpeed;
    }
  }, [activeVideoClip?.speed]);

  // 音频轨片段随播放头实时同步：播放/暂停/寻址对齐、音量、淡入淡出包络、静音、变速，并驱动效果链参数
  useEffect(() => {
    audioMediaClips.forEach(clip => {
      const el = audioElsRef.current.get(clip.id);
      if (!el || !clip.url) return;
      const rawUrl = clip.url;

      // 1) 同源 blob 代理：成功前不接入 Web Audio，避免跨域路由被浏览器静默；失败源永久记录，不重复发起注定失败的请求
      const blobUrl = audioBlobCacheRef.current[rawUrl];
      if (!blobUrl && !audioBlobPendingRef.current.has(rawUrl) && !audioBlobFailedRef.current.has(rawUrl)) {
        audioBlobPendingRef.current.add(rawUrl);
        getMedia(rawUrl)
          .then(url => {
            if (!url.startsWith('blob:')) { audioBlobFailedRef.current.add(rawUrl); return; }
            audioBlobCacheRef.current[rawUrl] = url;
            const current = audioElsRef.current.get(clip.id); if (current) current.src = url;
          })
          .catch(() => audioBlobFailedRef.current.add(rawUrl))
          .finally(() => audioBlobPendingRef.current.delete(rawUrl));
      } else if (blobUrl && el.src !== blobUrl && !el.src.startsWith('blob:')) {
        el.src = blobUrl;
      }

      // 2) 时间/音量/包络/变速/播放控制
      const local = currentTime - clip.start;
      const sourceTime = (clip.sourceStart || 0) + local * (clip.speed || 1);
      const within = local >= 0 && local <= clip.duration;
      const fi = clip.fadeIn ?? 0;
      const fo = clip.fadeOut ?? 0;
      let env = 1;
      if (fi > 0) env = Math.min(env, Math.max(0, local / fi));
      if (fo > 0) env = Math.min(env, Math.max(0, (clip.duration - local) / fo));
      env = Math.max(0, Math.min(1, env));
      const targetVol = clip.mute ? 0 : Math.max(0, Math.min(1, ((clip.volume ?? 100) / 100) * env));
      if (Math.abs(el.volume - targetVol) > 0.02) el.volume = targetVol;
      const rate = Math.max(0.25, Math.min(4, clip.speed ?? 1));
      if (el.playbackRate !== rate) el.playbackRate = rate;

      if (isPlaying && within) {
        if (Math.abs(el.currentTime - sourceTime) > 0.3) {
          try {
            el.currentTime = Math.max(0, sourceTime);
          } catch {
            /* 元数据未就绪时忽略本次 seek */
          }
        }
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }

      // 3) Web Audio 效果链（与面板默认展示一致：降噪默认“轻度去噪”、混响默认“原声纯净”）
      const curDenoise = clip.denoise || '无降噪';
      const curReverb = clip.reverb || '原声纯净';
      const needsFx =
        (clip.pan ?? 0) !== 0 ||
        Object.values(clip.eqBands || {}).some(gain => gain !== 0) ||
        curReverb !== '原声纯净' ||
        curDenoise !== '无降噪';
      const graphReady = el.src.startsWith('blob:');
      const nodes = audioGraphRef.current[clip.id] || (needsFx && graphReady ? ensureAudioGraph(clip.id, el) : null);
      if (nodes) {
        applyAudioClipFxParams(clip, nodes);
      } else if (needsFx && audioBlobFailedRef.current.has(rawUrl) && !audioFxWarnedRef.current.has(rawUrl)) {
        // 首次在该不可代理音源上开启声像/降噪/混响时，如实告知降级范围，避免“改了没反应”的困惑
        audioFxWarnedRef.current.add(rawUrl);
        toast.info('⚠️ 该音频源不支持跨域特效处理：声像/降噪/混响无法生效，音量、淡入淡出、静音与变速真实生效');
      }
    });
  }, [audioMediaClips, tracks, currentTime, isPlaying]);

  // 用户点击播放后恢复 AudioContext（浏览器自动播放策略要求手势后 resume）
  useEffect(() => {
    if (isPlaying) {
      audioCtxRef.current?.resume().catch(() => {});
    }
  }, [isPlaying]);

  // 卸载时释放音频引擎资源：断开效果链、关闭上下文、回收 blob
  useEffect(() => {
    const graphs = audioGraphRef.current;
    const blobs = audioBlobCacheRef.current;
    return () => {
      Object.values(graphs).forEach(n => {
        try {
          n.source.disconnect();
          n.dry.disconnect();
          n.wetGain.disconnect();
        } catch {
          /* 已断开则忽略 */
        }
      });
      Object.values(blobs).forEach(u => URL.revokeObjectURL(u));
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const handleUndo = useCallback(() => {
    if (timeline.canUndo) {
      timeline.undo();
      toast.success('撤销成功');
    } else {
      toast.info('没有可以撤销的操作');
    }
  }, [timeline.canUndo, timeline.undo]);

  const handleRedo = useCallback(() => {
    if (timeline.canRedo) {
      timeline.redo();
      toast.success('重做成功');
    } else {
      toast.info('没有可以重做的操作');
    }
  }, [timeline.canRedo, timeline.redo]);

  // Global keydown listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in inputs/textareas
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Ctrl + Z (Undo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl + Y (Redo)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
      // Space (Play/Pause)
      else if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      }
      // Delete/Backspace
      else if (e.code === 'Backspace' || e.code === 'Delete') {
        if (selectedTrackItem) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedTrackItem, handleDeleteSelected, handleUndo, handleRedo]);

  // 示例项目选择器
  const [sampleProjects, setSampleProjects] = useState<{ id: string; title: string; thumbnail_url: string | null; status: string }[]>([]);
  const [showSamplePicker, setShowSamplePicker] = useState(false);

  useEffect(() => {
    if (importId || !user) return;
    const controller = new AbortController();
    void listEditorProjects(user.id, 9, controller.signal).then(setSampleProjects).catch(() => {});
    return () => controller.abort();
  }, [importId, user?.id]);

  // 加载已生成完成的视频（供一键导入）
  const loadImportedVideos = useCallback(async () => {
    if (!user) return;
    const data = await listEditorProjects(user.id);
    if (!persistence.active.current) return;
    const mapped = data.filter(v => !!v.video_url).map(v => ({
      ...v,
      video_url: v.video_url!, thumbnail_url: v.thumbnail_url,
    }));
    setImportedVideos(mapped);
  }, [user]);

  const loadMaterials = useCallback(async () => {
    if (!user) { setMaterials([]); return; }
    try {
      const result = await listMaterialAssets(0, 30, undefined, '', user.id);
      if (persistence.active.current) setMaterials(result.materials);
    }
    catch (cause) { if (persistence.active.current) toast.error(cause instanceof Error ? cause.message : '素材读取失败'); }
  }, [user]);

  const restoreProject = useCallback((snapshot: EditorSnapshot) => {
    const selected = snapshot.tracks.find(track => track.id === snapshot.selectedTrackItem)
      || snapshot.tracks.find(track => track.type === 'video') || snapshot.tracks[0];
    restoredAttributes.current = selected ? { id: selected.id, scale: snapshot.scale, opacity: snapshot.opacity, volume: snapshot.volume } : null;
    setSelectedTrackItem(selected?.id || null);
    setProjectTitle(snapshot.projectTitle);
    timeline.reset(stripLegacyGlowFx(snapshot.tracks));
    setDuration(snapshot.duration);
    setPreviewVideoUrl(snapshot.previewVideoUrl || null);
    setCurrentTime(snapshot.currentTime || 0);
    if (snapshot.zoom !== undefined) setZoom(snapshot.zoom);
    if (snapshot.scale) setScale(snapshot.scale);
    if (snapshot.opacity) setOpacity(snapshot.opacity);
    if (snapshot.volume) setVolume(snapshot.volume);
    if (snapshot.editorAspect) setEditorAspect(snapshot.editorAspect);
    if (snapshot.appliedFilter) setAppliedFilter(snapshot.appliedFilter);
    if (snapshot.appliedTrans) setAppliedTrans(snapshot.appliedTrans);
    if (snapshot.pipSettings) setPipSettings(snapshot.pipSettings);
    if (snapshot.filterIntensity) setFilterIntensity(snapshot.filterIntensity);
    if (snapshot.chromaSettings) setChromaSettings(snapshot.chromaSettings);
    setPersonCutoutEnabled(Boolean(snapshot.personCutoutEnabled));
    setAiBeautyEnabled(Boolean(snapshot.aiBeautyEnabled ?? snapshot.beautyEnabled));
    setAiCutoutEnabled(Boolean(snapshot.aiCutoutEnabled && snapshot.chromaSettings));
  }, [timeline.reset]);
  const persistence = useEditorPersistence(user?.id, importId, restoreProject);
  const { currentProjectIdRef } = persistence;

  // 智能提取封面：真实首帧优先，绝不使用占位网图
  const resolveProjectThumbnail = async (trackList: TrackItem[], videoUrl: string | null) => {
    if (videoUrl) {
      try {
        const cover = await getVideoCoverImage(videoUrl);
        if (cover) return cover;
      } catch {}
    }
    const firstMedia = trackList.find(t => (t.type === 'video' || t.type === 'image') && t.url);
    if (firstMedia?.url) {
      if (firstMedia.type === 'video') {
        try {
          const cover = await getVideoCoverImage(firstMedia.url);
          if (cover) return cover;
        } catch {}
      } else {
        return firstMedia.url;
      }
    }
    return null;
  };

  // 项目持久化内部保存函数（新建/更新统一收拢，保证路由与作品库同步）
  const saveProjectInternal = async (options?: {
    customTitle?: string;
    customStatus?: 'draft' | 'processing' | 'completed' | 'failed';
    customVideoUrl?: string;
    customThumbnailUrl?: string;
    customTracks?: TrackItem[];
    silent?: boolean;
  }): Promise<string | null> => {
    if (!user) {
      if (!options?.silent) toast.error('请先登录后再保存项目');
      return null;
    }

    if (!persistence.ready || !persistence.active.current) throw new Error('工程尚未恢复完成，请稍后保存');
    if (!currentProjectIdRef.current) {
      currentProjectIdRef.current = crypto.randomUUID();
      persistence.pendingCreate.current = true;
    }
    const targetId = currentProjectIdRef.current;
    const finalDuration = Math.ceil(duration);
    const validTitle = (options?.customTitle || projectTitle || '未命名剪辑项目').trim();
    const finalStatus = options?.customStatus || 'draft';
    const finalVideoUrl = options?.customVideoUrl ?? previewVideoUrl ?? null;
    const finalTracks = options?.customTracks ?? tracks;

    const styleData = {
      duration: Number(duration.toFixed(3)),
      tracks: finalTracks,
      zoom,
      scale,
      opacity,
      volume,
      editorAspect,
      appliedFilter,
      filterIntensity,
      beautyEnabled: aiBeautyEnabled,
      aiBeautyEnabled,
      aiCutoutEnabled,
      personCutoutEnabled,
      chromaSettings, appliedTrans, pipSettings,
      previewVideoUrl: finalVideoUrl,
      currentTime,
      last_saved_at: new Date().toISOString(),
      edit_mode: true,
    };

    const payload: Record<string, any> = {
      title: validTitle,
      user_id: user.id,
      status: finalStatus,
      duration: finalDuration,
      resolution: editorAspect === 'aspect-[9/16]' ? '1080x1920' : '1920x1080',
      video_url: finalVideoUrl,
      thumbnail_url: options?.customThumbnailUrl ?? null,
      materials: finalTracks.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        url: t.url,
        start: t.start,
        duration: t.duration,
      })),
      style_data: styleData,
      updated_at: new Date().toISOString(),
    };

    persistence.persist({ ...styleData, importId: targetId, projectTitle: validTitle,
      pendingCreate: persistence.pendingCreate.current });
    return persistence.queue.run(async () => {
      try {
        if (!persistence.active.current) throw new Error('工程页面已切换，请在原工程恢复保存');
        await requireAccountSession(user.id);
        const creating = persistence.pendingCreate.current;
        if (creating) {
          payload.thumbnail_url = options?.customThumbnailUrl ?? await resolveProjectThumbnail(finalTracks, finalVideoUrl);
          await createEditorProject(user.id, targetId, payload, persistence.signal);
          persistence.pendingCreate.current = false;
        } else {
          for (const field of ['user_id', 'status', 'duration', 'resolution', 'video_url', 'thumbnail_url']) delete payload[field];
          await saveEditorProject(user.id, targetId, payload, persistence.signal);
        }
        if (!persistence.active.current) return targetId;
        persistence.persist({ ...latestSnapshot.current,
          ...(options?.customTracks && latestSnapshot.current.tracks === tracks ? { tracks: finalTracks } : {}),
          importId: targetId, pendingCreate: false });
        persistence.setError('');
        if (!options?.silent) toast.success(creating ? '新剪辑项目已创建并成功保存' : '剪辑项目已成功保存');
        window.dispatchEvent(new CustomEvent('shopro:works-updated'));
        if (!importId && !options?.silent) navigate(`/video/edit?importId=${targetId}`, { replace: true });
        return targetId;
      } catch (err: any) {
        if (persistence.active.current) {
          persistence.setError(err.message || '工程保存结果待确认，请恢复原工程');
          if (!options?.silent) toast.error('保存失败: ' + (err.message || '网络或数据异常'));
        }
        throw err;
      }
    });
  };

  useEffect(() => {
    void loadMaterials();
    void loadImportedVideos().catch(cause => { if (persistence.active.current) toast.error(cause.message || '作品读取失败'); });
  }, [loadMaterials, loadImportedVideos]);

  const snapshot = useMemo<EditorSnapshot>(() => ({
    importId: currentProjectIdRef.current || importId, projectTitle, tracks, zoom, duration, scale, opacity, volume, editorAspect, selectedTrackItem,
    previewVideoUrl, appliedFilter, appliedTrans, pipSettings, filterIntensity, chromaSettings,
    aiCutoutEnabled, personCutoutEnabled, aiBeautyEnabled, pendingCreate: persistence.pendingCreate.current,
  }), [tracks, zoom, duration, projectTitle, previewVideoUrl, importId, scale, opacity, volume, editorAspect, selectedTrackItem,
    appliedFilter, appliedTrans, pipSettings, filterIntensity, chromaSettings, aiCutoutEnabled, personCutoutEnabled, aiBeautyEnabled]);
  const latestSnapshot = useRef(snapshot); latestSnapshot.current = snapshot;
  useEffect(() => {
    if (!persistence.ready || !user) return;
    const timer = setTimeout(() => { try { persistence.persist(latestSnapshot.current); } catch {} }, 300);
    return () => clearTimeout(timer);
  }, [snapshot, persistence.ready, persistence.persist, user?.id]);
  useEffect(() => {
    if (!persistence.ready || !user) return;
    const flush = () => {
      try { persistEditorSnapshot(user.id, { ...latestSnapshot.current, importId: currentProjectIdRef.current,
        pendingCreate: persistence.pendingCreate.current }); } catch {}
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [persistence.ready, user?.id]);

  // Debounced auto-save to database
  useEffect(() => {
    const targetId = currentProjectIdRef.current || importId;
    if (!targetId || !user || !persistence.ready) return;

    const timer = setTimeout(async () => {
      try {
        await saveProjectInternal({ silent: true });
        console.log('Database auto-saved successfully');
      } catch (e) {
        console.error('Database auto-save error:', e);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [snapshot, persistence.ready, user?.id]);


  // 同步播放/暂停到 video 元素（静音态由片段属性决定，不再强制取消静音）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.muted = !!activeVideoClip?.mute;
      v.play().catch((err) => {
        console.warn('Play fail, fallback muted autoplay:', err);
        v.muted = true;
        v.play().catch(e => console.warn('Play sync fail:', e));
      });
    } else {
      v.pause();
    }
  }, [isPlaying, currentVideoSrc, activeVideoClip?.mute]);

  useEditorClock({ playing: isPlaying, time: currentTime, duration, pixelsPerSecond: pxPerSec, offset: TRACK_CONTENT_OFFSET,
    setTime: setCurrentTime, stop: () => setIsPlaying(false), video: videoRef, clip: activeVideoClipRef,
    timeRef: currentTimeRef, playhead: playheadLineRef, ruler: rulerPlayheadRef, display: timeDisplayRef,
    bottomDisplay: bottomTimeDisplayRef, scroll: timelineScrollRef });

  // 播放到达时间轴末尾自动暂停（副作用移出 state updater，避免并发渲染下重复触发）
  useEffect(() => {
    if (isPlaying && currentTime >= duration) setIsPlaying(false);
  }, [isPlaying, currentTime, duration]);

  // Sync player time during active playback (drift correction)
  useEffect(() => {
    if (!isPlaying) return;
    const v = videoRef.current;
    if (!v || v.seeking || v.readyState < 2) return;
    if (activeVideoClip) {
      const expectedLocalTime = (activeVideoClip.sourceStart || 0) + (currentTime - activeVideoClip.start) * (activeVideoClip.speed || 1);
      if (Math.abs(v.currentTime - expectedLocalTime) > 1.5) {
        v.currentTime = Math.max(0, expectedLocalTime);
      }
    }
  }, [currentTime, isPlaying, activeVideoClip]);

  // Sync player time when scrubbing or when timeline currentTime changes (non-playing)
  useEffect(() => {
    if (isPlaying) return; // Do not seek the video element while playing to avoid stutter and feedback loops
    const v = videoRef.current;
    if (!v) return;
    if (activeVideoClip) {
      const localTime = (activeVideoClip.sourceStart || 0) + (currentTime - activeVideoClip.start) * (activeVideoClip.speed || 1);
      if (Math.abs(v.currentTime - localTime) > 0.1) {
        v.currentTime = Math.max(0, localTime);
      }
    } else if (previewVideoUrl) {
      if (Math.abs(v.currentTime - currentTime) > 0.1) {
        v.currentTime = Math.max(0, Math.min(duration, currentTime));
      }
    }
  }, [currentTime, isPlaying, activeVideoClip, previewVideoUrl, duration]);

  const handleSeek = (clientX: number) => {
    const ruler = rulerRef.current;
    if (!ruler) return;
    const ticksContainer = ruler.querySelector('.ruler-ticks-container');
    if (!ticksContainer) return;
    const rect = ticksContainer.getBoundingClientRect();

    const x = clientX - rect.left;
    const timelineX = x + timelineScrollOffset;
    const newTime = Math.max(0, Math.min(duration, timelineX / pxPerSec));
    setCurrentTime(newTime);

    if (videoRef.current) {
      const activeVideo = tracks.find(track => {
        const end = track.start + track.duration;
        return newTime >= track.start && newTime <= end && track.type === 'video';
      });
      if (activeVideo) {
        videoRef.current.currentTime = Math.max(0, (activeVideo.sourceStart || 0) + (newTime - activeVideo.start) * (activeVideo.speed || 1));
      } else {
        videoRef.current.currentTime = Math.max(0, Math.min(duration, newTime));
      }
    }
  };

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    handleSeek(e.clientX);
  };

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleSeek(e.clientX);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      handleSeek(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // 手动点击保存草稿
  const handleSave = async () => {
    if (!user) { toast.error('请先登录后再保存项目'); return; }
    setSaving(true);
    try {
      await saveProjectInternal({ silent: false });
    } catch (e: any) {
      console.error('Manual save failed:', e);
    } finally {
      setSaving(false);
      setSaveDialogOpen(false);
    }
  };

  const addingMaterial = useRef(false);
  const makeMaterialTrack = async (material: EditorMaterial): Promise<TrackItem> => {
    const start = currentTimeRef.current;
    if (start >= 600 || tracks.length >= 80) throw new Error('工程最多10分钟、80个元素，请先精简时间轴');
    const length = Math.min(await materialDuration(material), 600 - start);
    if (length < .1) throw new Error('剩余时间不足，请移动播放头后添加');
    return { id: crypto.randomUUID(), trackId: material.type, type: material.type, name: material.name,
      start, duration: length, url: material.url, sourceStart: 0, speed: 1, fadeIn: 0, fadeOut: 0, denoise: '无降噪' };
  };
  const addToTimeline = async (material: EditorMaterial) => {
    if (addingMaterial.current) return;
    addingMaterial.current = true;
    try {
      const item = await makeMaterialTrack(material);
      setTracks(previous => [...previous, item]); setSelectedTrackItem(item.id);
      toast.success(`已添加「${material.name}」到时间轴`);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '素材添加失败'); }
    finally { addingMaterial.current = false; }
  };
  const handleImportVideo = async (video: { id: string; title: string; video_url: string; thumbnail_url: string | null }) => {
    await addToTimeline({ id: video.id, name: video.title, url: video.video_url, type: 'video' });
  };
  const handleUpload = async (file: File, rightsConfirmed: boolean) => {
    if (!user) throw new Error('请先登录');
    const material = await uploadMaterialAsset(file, user.id, rightsConfirmed);
    setMaterials(previous => [material, ...previous.filter(item => item.id !== material.id)]);
    toast.success(`素材已保存：${material.name}`);
  };

  // 导出视频 - 开启参数确认与全阶段渲染弹窗
  const handleExport = () => {
    if (!user) {
      toast.error('请先登录后再导出视频');
      return;
    }
    if (tracks.length === 0) {
      toast.error('当前时间轴暂无素材片段，请先添加素材后再导出');
      return;
    }
    setExportFileName(projectTitle || '未命名剪辑视频');
    setExportStage('idle');
    setExportError(null);
    setExportProgress(0);
    setExportDialogOpen(true);
  };

  // 确认执行导出与真实渲染全流程任务
  const executeExportTask = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    if (tracks.length === 0) {
      toast.error('请先添加至少一个视频或素材片段');
      return;
    }

    setExporting(true);
    setExportStage('rendering');
    setExportProgress(5);
    setExportError(null);
    setExportResult(null);

    const finalTitle = (exportFileName || projectTitle || '未命名剪辑成片').trim();
    try {
      setExportStatusText('正在上传工程中的本地素材');
      const renderTracks: Array<Record<string, unknown>> = [];
      for (const [index, track] of tracks.entries()) {
        if (track.hidden) continue;
        const pip = track.trackId === 'pip';
        const bounds = videoRef.current?.parentElement?.getBoundingClientRect();
        const visualOffset = track.type === 'video' && !pip;
        const convertX = (value: number) => 50 + value / (bounds?.width || 640) * 100;
        const convertY = (value: number) => 50 + value / (bounds?.height || 360) * 100;
        renderTracks.push({
          ...track, layer: index,
          ...(visualOffset ? { x: convertX(track.x || 0), y: convertY(track.y || 0) } : {}),
          keyframes: (track.keyframes || []).map(frame => {
            const property = ({ 缩放: 'scale', 不透明度: 'opacity', 音量: 'volume', 旋转: 'rotation', 位置X: 'x', 位置Y: 'y' } as Record<string, string>)[frame.property] || frame.property;
            return { ...frame, property, value: visualOffset && property === 'x' ? convertX(frame.value)
              : visualOffset && property === 'y' ? convertY(frame.value) : frame.value };
          }),
          ...(track.type !== 'text' ? { url: await stableMedia(track.url || '', user.id) }
            : { text: track.text || track.name, bgColor: track.bgColor || track.fontStyle?.bg || 'rgba(0,0,0,0.75)',
              fontColor: track.fontColor || track.fontStyle?.color || '#ffffff' }),
          ...(pip ? { x: track.x ?? pipSettings.x, y: track.y ?? pipSettings.y,
            scale: track.scale ?? pipSettings.scale * 0.35, opacity: track.opacity ?? pipSettings.opacity,
            rotation: track.rotation ?? pipSettings.rotation,
            blendMode: RENDER_BLENDS.find(mode => mode.name === pipSettings.blendMode)?.id || 'normal' } : {}),
          ...(aiCutoutEnabled && track.type === 'video' && !pip ? { chromaKey: chromaSettings } : {}),
          ...(personCutoutEnabled && track.type === 'video' && !pip ? {
            personMask: { model: 'pphumanseg-2023mar', threshold: .5, feather: 1 },
          } : {}),
          ...(['video', 'image'].includes(track.type) && (track.filter || appliedFilter) !== '无'
            ? { filter: track.filter || appliedFilter, filterIntensity: filterIntensity[track.filter || appliedFilter] ?? 80 } : {}),
          ...(aiBeautyEnabled && track.type === 'video' ? { brightness: 106, contrast: 103, saturation: 108 } : {}),
        });
      }
      const savedId = await saveProjectInternal({ customTitle: finalTitle, silent: true });
      if (!savedId) throw new Error('工程保存失败');
      const ratio = editorAspect === 'aspect-[9/16]' ? '9:16' : editorAspect === 'aspect-[3/4]' ? '3:4'
        : editorAspect === 'aspect-[4/3]' ? '4:3' : editorAspect === 'aspect-square' ? '1:1' : '16:9';
      const submitted = await renderTask.start({ version: 1, title: finalTitle, duration, tracks: renderTracks,
        transition: appliedTrans === '无' ? 'none' : appliedTrans,
        height: exportResolution === '4k' ? 2160 : exportResolution === '1080p' ? 1080 : 720,
        fps: Number(exportFps), ratio }, savedId);
      if (!submitted) {
        setExporting(false); setExportStage('failed');
        setExportError('提交结果待确认，请查看任务提示；保留原请求后会自动恢复');
        return;
      }
      setExportStatusText('工程已提交后台，重新打开此项目可恢复进度');
    } catch (e: any) {
      const errMsg = e.message || '渲染任务提交失败';
      setExportError(errMsg);
      setExportStage('failed');
      toast.error('导出失败: ' + errMsg);
    } finally {
      setExporting(false);
    }
  };

  // 下载已导出的视频文件
  const handleDownloadExported = async () => {
    if (!exportResult?.video_url) return;
    const toastId = toast.loading('正在准备下载文件...');
    try {
      const res = await fetch(exportResult.video_url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${exportResult.title || '导出成片'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success('视频文件下载已启动', { id: toastId });
    } catch (e) {
      toast.dismiss(toastId);
      // 降级新窗口打开直接播放或保存
      window.open(exportResult.video_url, '_blank');
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `00:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  if (!persistence.ready) return <div className="p-6 space-y-3">
    {persistence.error ? <p role="alert">{persistence.error}</p> : <p role="status">正在恢复剪辑工程…</p>}
    {persistence.error && <Button onClick={() => window.location.reload()}>重新加载工程</Button>}
  </div>;

  return (
    // 移动端：MainLayout 对本页隐藏顶部 header 且底部 Tab 栏已移除，直接占满动态视口高度
    <div className="flex flex-col h-screen max-lg:h-[100dvh] w-full bg-zinc-950 text-zinc-300 overflow-hidden">
      {persistence.error && <p role="alert" className="shrink-0 p-2 text-sm text-rose-300 break-words">{persistence.error}</p>}
      <RecordingDialog open={recordingOpen} onClose={() => setRecordingOpen(false)} onSave={async file => {
        if (!user) throw new Error('请先登录');
        const material = await uploadMaterialAsset(file, user.id, true, 'recording');
        const item = await makeMaterialTrack(material), next = [...tracks, item];
        if (!await saveProjectInternal({ customTracks: next, silent: true })) throw new Error('工程保存失败，录音已入库，可从资源库添加');
        setTracks(next); setSelectedTrackItem(item.id); await loadMaterials(); toast.success('录音已入库并保存到工程');
      }} />
      <EditAnalysisDialog mode={editMode} onClose={() => setEditMode(null)} userId={user?.id}
        projectKey={importId || 'draft'} tracks={tracks} selectedId={selectedTrackItem}
        restoreJobId={searchParams.get('editJob')} onRestoreMode={setEditMode}
        onApply={async (result, jobId) => {
          if (!sourceMatches(tracks.find(track => track.id === result.source.id), result.source)) {
            throw new Error('原片段已裁剪、变速或移动，请恢复原片段后应用');
          }
          let next: TrackItem[];
          if (result.mode === 'beats') next = beatCuts(tracks, result).tracks;
          else {
            if (tracks.some(track => track.id.startsWith(`subtitle:${jobId}:`))) throw new Error('原任务字幕已应用，无需重复添加');
            next = [...tracks, ...subtitleItems(result, duration, jobId)];
            if (next.length > 80) throw new Error('应用后超过80个轨道元素，请先精简时间轴');
          }
          if (!await saveProjectInternal({ customTracks: next, silent: true })) throw new Error('工程保存失败，请恢复原任务结果');
          setTracks(next); return true;
        }} />
      {/* ─── 顶部工具栏 ──────────────────────────────────────────── */}
      <div className="h-12 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between px-2 md:px-4 shrink-0 gap-2">
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-8 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={loadMaterials}>
            <Upload className="w-4 h-4 mr-1.5" /><span className="hidden md:inline">刷新素材</span>
          </Button>
          <div className="w-px h-4 bg-zinc-700 mx-1" />
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800" title="撤销 Ctrl+Z" onClick={handleUndo}>
            <Undo className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800" title="重做 Ctrl+Y" onClick={handleRedo}>
            <Redo className="w-4 h-4" />
          </Button>
        </div>

        <div className="font-medium text-sm text-zinc-400 flex items-center gap-2 min-w-0">
          <span className="truncate max-w-[90px] sm:max-w-[120px] md:max-w-xs">{projectTitle}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 shrink-0 text-[10px] text-zinc-500 hover:text-white" onClick={() => setSaveDialogOpen(true)}>
            重命名
          </Button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button aria-label="保存项目" variant="ghost" size="sm" className="h-8 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            <span className="hidden md:inline">保存</span>
          </Button>
          <Button aria-label="导出视频" size="sm" className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleExport} disabled={saving}>
            <Download className="w-4 h-4 mr-1.5" /><span className="hidden md:inline">导出</span>
          </Button>
        </div>
      </div>

      {/* ─── 中部工作区 ──────────────────────────────────────────── */}
      {/* 移动端纵向堆叠（左面板 → 预览 → 属性面板），lg 及以上恢复左右分栏 */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

        {/* 左侧边栏 */}
        <LeftSidebar
          chromaSettings={chromaSettings}
          materials={materials}
          onAdd={addToTimeline}
          importedVideos={importedVideos}
          onImportVideo={handleImportVideo}
          onUpload={handleUpload}
          onDelete={handleDeleteMaterial}
          appliedFilter={appliedFilter}
          setAppliedFilter={setAppliedFilter}
          filterIntensity={filterIntensity}
          setFilterIntensity={setFilterIntensity}
          appliedTrans={appliedTrans}
          setAppliedTrans={setAppliedTrans}
          selectedFont={selectedFont}
          setSelectedFont={setSelectedFont}
          pipSettings={pipSettings}
          setPipSettings={setPipSettings}
          pipLayers={pipLayers}
          setPipLayers={setPipLayers}
          videoRef={videoRef}
          selectedTrackItem={selectedTrackItem}
          duration={duration}
          scale={scale}
          setScale={setScale}
          opacity={opacity}
          setOpacity={setOpacity}
          onApplyAiTool={handleApplyAiTool}
          userId={user?.id} onRecord={() => { setIsPlaying(false); setRecordingOpen(true); }}
          tracks={tracks}
          setTracks={setTracks}
          currentTime={currentTime}
        />

        {/* 中央预览区（min-h-0 保证移动端纵向堆叠时可正常收缩，lg 及以上行为不变） */}
        <div className="flex-1 min-h-0 flex flex-col bg-black relative min-w-0" ref={previewContainerRef}>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            <div style={{ containerType: 'inline-size' }} className={`w-auto h-full max-h-full max-w-full bg-zinc-900 border border-zinc-800 shadow-2xl relative overflow-hidden flex items-center justify-center transition-all duration-300 ${editorAspect === 'aspect-[9/16]' ? 'aspect-[9/16]' :
              editorAspect === 'aspect-[3/4]' ? 'aspect-[3/4]' :
                editorAspect === 'aspect-square' ? 'aspect-square' :
                  'aspect-video'
              }`}>

              {/* 顶部激活效果与AI状态标签 */}
              <div className="absolute top-3 left-3 z-30 flex flex-wrap gap-1.5 pointer-events-none">
                {appliedFilter !== '无' && (
                  <div className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur border border-indigo-500/50 text-[10px] text-indigo-300 flex items-center gap-1 shadow-lg">
                    <Sparkles className="w-3 h-3 text-indigo-400" />
                    <span>滤镜: {appliedFilter} ({filterIntensity[appliedFilter] ?? 80}%)</span>
                  </div>
                )}
                {aiBeautyEnabled && (
                  <div className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur border border-pink-500/50 text-[10px] text-pink-300 flex items-center gap-1 shadow-lg">
                    <Wand2 className="w-3 h-3 text-pink-400" />
                    <span>画面提亮已启用</span>
                  </div>
                )}
                {aiCutoutEnabled && (
                  <div className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur border border-emerald-500/50 text-[10px] text-emerald-300 flex items-center gap-1 shadow-lg">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>色键去背景 · 导出后生效</span>
                  </div>
                )}
                {personCutoutEnabled && <div className="px-2 py-0.5 rounded-full bg-black/70 border border-purple-500/50 text-[10px] text-purple-300">
                  人物去背景 · 导出后生效
                </div>}
                {appliedTrans !== '无' && (
                  <div className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur border border-amber-500/50 text-[10px] text-amber-300 flex items-center gap-1 shadow-lg">
                    <span>成片转场: {TRANSITIONS.find(t => t.id === appliedTrans)?.name || appliedTrans}</span>
                  </div>
                )}
                {isPreloading && (
                  <div className="px-2 py-0.5 rounded-full bg-indigo-950/80 backdrop-blur border border-indigo-500/60 text-[10px] text-indigo-300 flex items-center gap-1 shadow-lg animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                    <span>视频预热缓存中...</span>
                  </div>
                )}
              </div>

              {/* 示例项目选择器 */}
              {!importId && showSamplePicker && (
                <div className="absolute inset-0 bg-zinc-950/95 p-4 overflow-y-auto z-40">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-zinc-200">选择示例项目</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-7 h-7 text-zinc-500 hover:text-white"
                      onClick={() => setShowSamplePicker(false)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {sampleProjects.map(p => (
                      <button
                        key={p.id}
                        className="group relative aspect-video rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700 hover:border-indigo-500 transition-colors"
                        onClick={() => navigate(`/video/edit?importId=${p.id}`)}
                      >
                        {p.thumbnail_url
                          ? <img src={p.thumbnail_url} alt={p.title} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                          : <div className="w-full h-full flex items-center justify-center"><Play className="w-6 h-6 text-zinc-600" /></div>
                        }
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                          <p className="text-[10px] text-white font-medium line-clamp-1">{p.title}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview content based on current time */}
              {activeImageClip ? (
                <img
                  src={activeImageClip.url}
                  alt={activeImageClip.name}
                  className="w-full h-full object-contain transition-all"
                  style={{
                    transform: `scale(${(activeImageClip.scale ?? 100) / 100}) rotate(${activeImageClip.rotation ?? 0}deg)`,
                    opacity: (activeImageClip.opacity ?? 100) / 100,
                    filter: getCssFilter(activeImageClip.filter || appliedFilter, filterIntensity[activeImageClip.filter || appliedFilter] ?? filterIntensity[appliedFilter] ?? 80, aiBeautyEnabled),
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const ratio = img.naturalWidth / img.naturalHeight;
                    if (ratio < 0.65) setEditorAspect('aspect-[9/16]');
                    else if (ratio < 0.8) setEditorAspect('aspect-[3/4]');
                    else if (ratio < 1.2) setEditorAspect('aspect-square');
                    else setEditorAspect('aspect-video');
                  }}
                />
              ) : (currentVideoSrc || hasVideoClips) ? (
                <video
                  ref={videoRef}
                  src={currentVideoSrc}
                  preload="auto"
                  className="w-full h-full object-contain bg-black cursor-pointer"
                  onClick={() => setIsPlaying(prev => !prev)}
                  style={{
                    transform: `scale(${(videoFxClip?.scale ?? 100) / 100}) translate(${videoFxClip?.x ?? 0}px, ${videoFxClip?.y ?? 0}px) rotate(${videoFxClip?.rotation ?? 0}deg) scaleX(${videoFxClip?.flipH ? -1 : 1}) scaleY(${videoFxClip?.flipV ? -1 : 1})`,
                    opacity: (videoFxClip?.opacity ?? 100) / 100,
                    filter: getCssFilter(videoFxClip?.filter || appliedFilter, filterIntensity[videoFxClip?.filter || appliedFilter] ?? filterIntensity[appliedFilter] ?? 80, aiBeautyEnabled),
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => {
                    if (isPlaying && currentTime >= duration - 0.2) {
                      setIsPlaying(false);
                    }
                  }}
                  onTimeUpdate={(e) => {
                    const vid = e.currentTarget;
                    if (!vid.seeking && isPlaying) {
                      const clip = activeVideoClipRef.current;
                      const target = clip ? clip.start + (vid.currentTime - (clip.sourceStart || 0)) / (clip.speed || 1) : vid.currentTime;
                      currentTimeRef.current = target;
                    }
                  }}
                  onCanPlay={(e) => {
                    const vid = e.currentTarget;
                    vid.muted = !!activeVideoClipRef.current?.mute;
                    if (!isPlaying) {
                      if (activeVideoClip) {
                        const localTime = (activeVideoClip.sourceStart || 0) + (currentTime - activeVideoClip.start) * (activeVideoClip.speed || 1);
                        if (Math.abs(vid.currentTime - localTime) > 0.1) {
                          vid.currentTime = Math.max(0, localTime);
                        }
                      } else if (previewVideoUrl) {
                        if (Math.abs(vid.currentTime - currentTime) > 0.1) {
                          vid.currentTime = Math.max(0, Math.min(duration, currentTime));
                        }
                      }
                    }
                    if (isPlaying) {
                      vid.play().catch(err => console.warn('onCanPlay play fail:', err));
                    }
                  }}
                  onLoadedMetadata={(e) => {
                    if (!activeVideoClip && videoRef.current) {
                      setDuration(videoRef.current.duration || 30);
                    }
                    const vid = e.currentTarget;
                    const ratio = vid.videoWidth / vid.videoHeight;
                    if (ratio < 0.65) setEditorAspect('aspect-[9/16]');
                    else if (ratio < 0.8) setEditorAspect('aspect-[3/4]');
                    else if (ratio < 1.2) setEditorAspect('aspect-square');
                    else setEditorAspect('aspect-video');
                  }}
                  onEnded={() => {
                    if (currentTime >= duration - 0.2) {
                      setIsPlaying(false);
                    }
                  }}
                  playsInline
                />
              ) : (
                <div className="text-zinc-700 flex flex-col items-center gap-2">
                  <Play className="w-14 h-14 opacity-20" />
                  <p className="text-sm text-zinc-600">从素材库导入视频或添加素材到时间轴以预览</p>
                </div>
              )}

              {/* 画中画浮层 (仅在时间轴存在激活的画中画片段时渲染) */}
              {activePipClip && (
                <div
                  className="absolute z-20 overflow-hidden shadow-2xl rounded border border-indigo-500/60 transition-all pointer-events-none"
                  style={{
                    left: `${activePipClip.x ?? pipSettings.x}%`,
                    top: `${activePipClip.y ?? pipSettings.y}%`,
                    transform: `translate(-50%, -50%) rotate(${activePipClip.rotation ?? pipSettings.rotation}deg)`,
                    opacity: (activePipClip.opacity ?? pipSettings.opacity) / 100,
                    mixBlendMode: RENDER_BLENDS.find(mode => mode.name === pipSettings.blendMode)?.css || 'normal',
                    width: `${activePipClip.scale ?? pipSettings.scale * .35}%`,
                    aspectRatio: '16/9',
                  }}
                >
                  <TimelineMediaPreview track={activePipClip} currentTime={currentTime} playing={isPlaying} />
                </div>
              )}

              {/* 动态贴纸与特效浮层 */}
              {activeStickerClip && (
                <div
                  className="absolute z-25 pointer-events-none transition-all"
                  style={{
                    top: '16%',
                    right: '10%',
                    width: `${Math.max(60, Math.min(180, (activeStickerClip.scale ?? 100) * 0.9))}px`,
                    opacity: (activeStickerClip.opacity ?? 100) / 100,
                  }}
                >
                  <img
                    src={activeStickerClip.url}
                    alt={activeStickerClip.name}
                    className="w-full h-auto drop-shadow-2xl"
                  />
                </div>
              )}

              {/* 实时字幕浮层 */}
              {activeTextClips.map(activeTextClip => (
                <div key={activeTextClip.id} className="absolute flex justify-center pointer-events-none z-30 transition-all w-[85%]"
                  style={{ left: `${activeTextClip.x ?? 50}%`, top: `${activeTextClip.y ?? 85}%`, transform: 'translate(-50%, -50%)' }}>
                  <span
                    className="px-2 py-1 md:px-4 md:py-1.5 rounded-lg w-full whitespace-pre-wrap break-words leading-relaxed select-none shadow-2xl transition-all"
                    style={{
                      fontSize: `clamp(10px, ${(activeTextClip.fontSize ?? Math.max(13, Math.min(24, (activeTextClip.scale ?? 100) * .16))) / 6.4}cqw, ${activeTextClip.fontSize ?? Math.max(13, Math.min(24, (activeTextClip.scale ?? 100) * .16))}px)`,
                      fontFamily: resolveTextFont(activeTextClip.fontFamily || activeTextClip.fontStyle?.fontFamily || selectedFont),
                      color: activeTextClip.fontColor || activeTextClip.fontStyle?.color || '#ffffff',
                      backgroundColor: activeTextClip.bgColor || activeTextClip.fontStyle?.bg || 'rgba(0, 0, 0, 0.75)',
                      textShadow: activeTextClip.strokeWidth ? `0 0 ${activeTextClip.strokeWidth}px ${activeTextClip.strokeColor || '#000000'}, 0 2px 8px rgba(0,0,0,0.9)` : '0 2px 8px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8)',
                      WebkitTextStroke: activeTextClip.strokeWidth ? `${Math.max(0.5, activeTextClip.strokeWidth / 2)}px ${activeTextClip.strokeColor || '#000000'}` : undefined,
                      fontWeight: activeTextClip.isBold ? 'bold' : '500',
                      fontStyle: activeTextClip.isItalic ? 'italic' : 'normal',
                      textAlign: activeTextClip.textAlign || 'center',
                      backdropFilter: 'blur(6px)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}
                  >
                    {activeTextClip.text || activeTextClip.name}
                  </span>
                </div>
              ))}

              {/* 音频轨隐藏播放器：为属性面板的音量/声像/淡入淡出/降噪/混响/变速提供真实媒体载体 */}
              {audioMediaClips.map(clip => (
                <audio
                  key={clip.id}
                  ref={el => {
                    if (el) {
                      audioElsRef.current.set(clip.id, el);
                    } else {
                      audioElsRef.current.delete(clip.id);
                    }
                  }}
                  src={clip.url}
                  preload="auto"
                  className="hidden"
                />
              ))}

              {/* 播放控制 */}
              <div className="absolute top-1/2 -translate-y-1/2 lg:top-auto lg:translate-y-0 lg:bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-zinc-900/80 backdrop-blur px-6 py-2 rounded-full border border-zinc-700/50 z-30">
                <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-700"
                  onClick={() => { setCurrentTime(0); if (videoRef.current) videoRef.current.currentTime = 0; }}>
                  <SkipBack className="w-4 h-4 fill-current" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-10 h-10 rounded-full bg-zinc-200 text-zinc-900 hover:bg-white hover:text-black"
                  onClick={() => {
                    if (!isPlaying && currentTime >= duration - 0.2) {
                      setCurrentTime(0);
                      if (videoRef.current) videoRef.current.currentTime = 0;
                    }
                    setIsPlaying(!isPlaying);
                  }}
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-700"
                  onClick={() => { if (videoRef.current) videoRef.current.currentTime = videoRef.current.duration; }}>
                  <SkipForward className="w-4 h-4 fill-current" />
                </Button>
              </div>
            </div>
          </div>
          <div className="h-10 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between px-4 text-xs font-mono text-zinc-400 shrink-0">
            <span><span ref={bottomTimeDisplayRef}>{formatTime(currentTime)}</span> / {formatTime(duration)}</span>
            <span className="flex items-center gap-1 cursor-pointer hover:text-zinc-200" onClick={handleFullscreen}>
              {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
              {isFullscreen ? '退出全屏' : '全屏'}
            </span>
          </div>
        </div>

        {/* 右侧属性面板（移动端占满一行宽度并限高内部滚动，lg 及以上恢复固定列宽） */}
        <div className="w-full lg:w-72 max-lg:max-h-[36%] border-l border-zinc-800 bg-zinc-900 flex flex-col shrink-0">
          <div className="h-10 border-b border-zinc-800 flex items-center justify-between px-4 text-xs font-medium text-zinc-200 shrink-0">
            <div className="flex items-center">
              <Settings2 className="w-3.5 h-3.5 mr-2 text-zinc-400" />
              <span>属性设置</span>
            </div>
            {selectedTrackObj && (
              <span className="text-[10px] text-indigo-400 bg-indigo-950/60 border border-indigo-500/30 px-2 py-0.5 rounded max-w-[120px] truncate">
                {selectedTrackObj.type === 'video' ? '主视频轨道' : selectedTrackObj.name}
              </span>
            )}
          </div>
          <ScrollArea className="flex-1">
            {selectedTrackObj ? (
              <div className="p-3 space-y-4">
                {/* 顶部标题与轨道类型卡片 */}
                <div className={`rounded-lg p-2.5 border flex items-center justify-between transition-colors ${
                  selectedTrackObj.type === 'video' ? 'bg-indigo-950/40 border-indigo-500/40' :
                  selectedTrackObj.type === 'audio' ? 'bg-emerald-950/40 border-emerald-500/40' :
                  selectedTrackObj.type === 'text' ? 'bg-amber-950/40 border-amber-500/40' :
                  'bg-purple-950/40 border-purple-500/40'
                }`}>
                  <div className="flex items-center gap-2 overflow-hidden">
                    {selectedTrackObj.type === 'video' ? <Film className="w-4 h-4 text-indigo-400 shrink-0" /> :
                     selectedTrackObj.type === 'audio' ? <Music2 className="w-4 h-4 text-emerald-400 shrink-0" /> :
                     selectedTrackObj.type === 'text' ? <Type className="w-4 h-4 text-amber-400 shrink-0" /> :
                     <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />}
                    <div className="truncate">
                      <p className="text-xs font-semibold text-zinc-100 truncate">{selectedTrackObj.name}</p>
                      <p className="text-[10px] text-zinc-400">
                        {selectedTrackObj.type === 'video' ? `主视频 · ${selectedTrackObj.duration}秒` :
                         selectedTrackObj.type === 'audio' ? `音频声轨 · ${selectedTrackObj.duration}秒` :
                         selectedTrackObj.type === 'text' ? `文案字幕 · ${selectedTrackObj.duration}秒` :
                         `特效画面 · ${selectedTrackObj.duration}秒`}
                      </p>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium border shrink-0 ${
                    selectedTrackObj.type === 'video' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' :
                    selectedTrackObj.type === 'audio' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                    selectedTrackObj.type === 'text' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                    'bg-purple-500/20 text-purple-300 border-purple-500/30'
                  }`}>
                    {selectedTrackObj.type === 'video' ? '主视频轨' :
                     selectedTrackObj.type === 'audio' ? '音频轨' :
                     selectedTrackObj.type === 'text' ? '文案轨' : '特效轨'}
                  </span>
                </div>

                {/* ══════════════════════════════════════════════════════════
                    1. 主视频轨道 (Video) 专业设置面板
                    ══════════════════════════════════════════════════════════ */}
                {selectedTrackObj.type === 'video' && (
                  <div className="space-y-4">
                    {/* 画面变换 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3 h-3" />画面变换与缩放
                        </p>
                        <button
                          className="text-[9px] text-zinc-500 hover:text-zinc-300 underline"
                          onClick={() => {
                            handleScaleChange([100]);
                            handleOpacityChange([100]);
                            updateTrackItem(selectedTrackObj.id, { x: 0, y: 0, rotation: 0, flipH: false, flipV: false });
                          }}
                        >
                          重置变换
                        </button>
                      </div>
                      <div className="space-y-2.5">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">画面缩放</span>
                            <span className="text-[10px] text-indigo-400 font-mono font-medium">{scale[0]}%</span>
                          </div>
                          <Slider value={scale} onValueChange={handleScaleChange} min={10} max={300} className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">不透明度</span>
                            <span className="text-[10px] text-indigo-400 font-mono font-medium">{opacity[0]}%</span>
                          </div>
                          <Slider value={opacity} onValueChange={handleOpacityChange} max={100} className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
                        </div>
                        <div className="pt-1 border-t border-zinc-800/60">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] text-zinc-400">旋转与翻转</span>
                            <span className="text-[10px] text-zinc-500 font-mono">{selectedTrackObj.rotation ?? 0}°</span>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] bg-zinc-850 border-zinc-700 hover:bg-zinc-700 text-zinc-300"
                              onClick={() => {
                                const cur = selectedTrackObj.rotation ?? 0;
                                updateTrackItem(selectedTrackObj.id, { rotation: (cur + 90) % 360 });
                              }}
                              title="顺时针旋转90°"
                            >
                              <RotateCw className="w-3 h-3 mr-1" />+90°
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] bg-zinc-850 border-zinc-700 hover:bg-zinc-700 text-zinc-300"
                              onClick={() => {
                                const cur = selectedTrackObj.rotation ?? 0;
                                updateTrackItem(selectedTrackObj.id, { rotation: (cur - 90 + 360) % 360 });
                              }}
                              title="逆时针旋转90°"
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />-90°
                            </Button>
                            <Button
                              size="sm"
                              variant={selectedTrackObj.flipH ? "default" : "outline"}
                              className={`h-7 text-[10px] ${selectedTrackObj.flipH ? 'bg-indigo-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
                              onClick={() => updateTrackItem(selectedTrackObj.id, { flipH: !selectedTrackObj.flipH })}
                              title="水平镜像翻转"
                            >
                              <FlipHorizontal className="w-3 h-3 mr-1" />水平
                            </Button>
                            <Button
                              size="sm"
                              variant={selectedTrackObj.flipV ? "default" : "outline"}
                              className={`h-7 text-[10px] ${selectedTrackObj.flipV ? 'bg-indigo-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
                              onClick={() => updateTrackItem(selectedTrackObj.id, { flipV: !selectedTrackObj.flipV })}
                              title="垂直镜像翻转"
                            >
                              <FlipVertical className="w-3 h-3 mr-1" />垂直
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 调色与风格滤镜 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/80">
                      <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Palette className="w-3 h-3" />调色与电影感滤镜
                      </p>
                      <div className="grid grid-cols-3 gap-1">
                        {['无', '电影质感', '温暖午后', '日系清新', '复古胶片', '清爽胶片'].map(f => {
                          const curFilter = selectedTrackObj.filter || appliedFilter;
                          const isSel = curFilter === f;
                          return (
                            <button
                              key={f}
                              className={`h-7 text-[10px] rounded border transition-all ${
                                isSel
                                  ? 'bg-indigo-600 text-white border-indigo-500 font-medium shadow-sm'
                                  : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                              }`}
                              onClick={() => {
                                setAppliedFilter(f);
                                updateTrackItem(selectedTrackObj.id, { filter: f });
                              }}
                            >
                              {f}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 原声音频 */}
                    <div className="space-y-2.5 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Volume2 className="w-3 h-3" />视频原声音量
                        </p>
                        <button
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                            selectedTrackObj.mute
                              ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                          }`}
                          onClick={() => {
                            const newMute = !selectedTrackObj.mute;
                            updateTrackItem(selectedTrackObj.id, { mute: newMute });
                            handleVolumeChange(newMute ? [0] : [100]);
                          }}
                        >
                          {selectedTrackObj.mute ? '已静音' : '开启原声'}
                        </button>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-zinc-400">音量增益</span>
                          <span className="text-[10px] text-zinc-400 font-mono">{volume[0]}%</span>
                        </div>
                        <Slider
                          value={volume}
                          onValueChange={(val) => {
                            handleVolumeChange(val);
                            if (selectedTrackObj.mute && val[0] > 0) {
                              updateTrackItem(selectedTrackObj.id, { mute: false });
                            }
                          }}
                          max={200}
                          className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                    </div>

                    {/* 视频变速 */}
                    <div className="space-y-2 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap className="w-3 h-3" />视频变速调节
                        </p>
                        <span className="text-[10px] text-indigo-400 font-mono font-medium">{speed}x</span>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map(numSpeed => {
                          const isSel = speed === numSpeed;
                          return (
                            <Button
                              key={numSpeed}
                              variant={isSel ? "default" : "outline"}
                              size="sm"
                              className={`h-7 px-0 text-[10px] ${
                                isSel
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                  : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                              }`}
                              onClick={() => handleSpeedChange(numSpeed)}
                            >
                              {numSpeed}x
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ══════════════════════════════════════════════════════════
                    2. 音频轨道 (Audio) 专业设置面板 (绝不显示缩放/不透明度)
                    ══════════════════════════════════════════════════════════ */}
                {selectedTrackObj.type === 'audio' && (
                  <div className="space-y-4">
                    {/* 音量与左右声道控制 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-emerald-500/20">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Music2 className="w-3 h-3" />音频音量与声学控制
                        </p>
                        <button
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                            selectedTrackObj.mute
                              ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                              : 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/60'
                          }`}
                          onClick={() => {
                            const newMute = !selectedTrackObj.mute;
                            updateTrackItem(selectedTrackObj.id, { mute: newMute });
                            handleVolumeChange(newMute ? [0] : [100]);
                          }}
                        >
                          {selectedTrackObj.mute ? <VolumeX className="w-2.5 h-2.5" /> : <Volume2 className="w-2.5 h-2.5" />}
                          {selectedTrackObj.mute ? '已静音' : '正常发声'}
                        </button>
                      </div>
                      <div className="space-y-2.5">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">主音频音量</span>
                            <span className="text-[10px] text-emerald-400 font-mono font-medium">{volume[0]}%</span>
                          </div>
                          <Slider
                            value={volume}
                            onValueChange={(val) => {
                              handleVolumeChange(val);
                              if (selectedTrackObj.mute && val[0] > 0) {
                                updateTrackItem(selectedTrackObj.id, { mute: false });
                              }
                            }}
                            max={200}
                            className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">左右声道平衡 (Pan)</span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {(selectedTrackObj.pan ?? 0) === 0 ? '居中 0' : (selectedTrackObj.pan ?? 0) < 0 ? `左 ${Math.abs(selectedTrackObj.pan ?? 0)}%` : `右 ${selectedTrackObj.pan}%`}
                            </span>
                          </div>
                          <Slider
                            value={[selectedTrackObj.pan ?? 0]}
                            onValueChange={(val) => updateTrackItem(selectedTrackObj.id, { pan: val[0] })}
                            min={-100}
                            max={100}
                            step={5}
                            className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 淡入淡出曲线控制 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-emerald-500/20">
                      <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Waypoints className="w-3 h-3" />专业淡入淡出曲线 (防爆音)
                      </p>
                      <div className="space-y-2.5">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">音频开头淡入 (Fade-In)</span>
                            <span className="text-[10px] text-emerald-400 font-mono">{(selectedTrackObj.fadeIn ?? 1.0).toFixed(1)}s</span>
                          </div>
                          <Slider
                            value={[(selectedTrackObj.fadeIn ?? 1.0) * 10]}
                            onValueChange={(val) => updateTrackItem(selectedTrackObj.id, { fadeIn: val[0] / 10 })}
                            min={0}
                            max={50}
                            step={1}
                            className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">音频结尾淡出 (Fade-Out)</span>
                            <span className="text-[10px] text-emerald-400 font-mono">{(selectedTrackObj.fadeOut ?? 1.5).toFixed(1)}s</span>
                          </div>
                          <Slider
                            value={[(selectedTrackObj.fadeOut ?? 1.5) * 10]}
                            onValueChange={(val) => updateTrackItem(selectedTrackObj.id, { fadeOut: val[0] / 10 })}
                            min={0}
                            max={50}
                            step={1}
                            className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                          />
                        </div>
                      </div>
                    </div>

                    {/* AI 降噪与空间混响 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-emerald-500/20">
                      <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Wand2 className="w-3 h-3" />智能降噪与混响声场
                      </p>
                      <div>
                        <span className="text-[10px] text-zinc-400 block mb-1.5">AI 智能降噪模式</span>
                        <div className="grid grid-cols-3 gap-1">
                          {['无降噪', '轻度去噪', '深度纯音'].map(d => {
                            const cur = selectedTrackObj.denoise || '轻度去噪';
                            const isSel = cur === d;
                            return (
                              <button
                                key={d}
                                className={`h-6 text-[10px] rounded border transition-all ${
                                  isSel
                                    ? 'bg-emerald-600 text-white border-emerald-500 font-medium'
                                    : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:text-zinc-200'
                                }`}
                                onClick={() => updateTrackItem(selectedTrackObj.id, { denoise: d })}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-400 block mb-1.5">空间混响与音效</span>
                        <div className="grid grid-cols-3 gap-1">
                          {['原声纯净', '录音棚', 'KTV沉浸', '大厅空间', '广播电台', '温暖剧场'].map(r => {
                            const cur = selectedTrackObj.reverb || '原声纯净';
                            const isSel = cur === r;
                            return (
                              <button
                                key={r}
                                className={`h-6 text-[10px] rounded border transition-all ${
                                  isSel
                                    ? 'bg-emerald-600 text-white border-emerald-500 font-medium'
                                    : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:text-zinc-200'
                                }`}
                                onClick={() => updateTrackItem(selectedTrackObj.id, { reverb: r })}
                              >
                                {r}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* 音频变速 */}
                    <div className="space-y-2 bg-zinc-950/40 p-2.5 rounded-lg border border-emerald-500/20">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap className="w-3 h-3" />音频变速播放
                        </p>
                        <span className="text-[10px] text-emerald-400 font-mono font-medium">{speed}x</span>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {[0.5, 0.8, 1, 1.2, 1.5, 2].map(numSpeed => {
                          const isSel = speed === numSpeed;
                          return (
                            <Button
                              key={numSpeed}
                              variant={isSel ? "default" : "outline"}
                              size="sm"
                              className={`h-7 px-0 text-[10px] ${
                                isSel
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                  : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                              }`}
                              onClick={() => handleSpeedChange(numSpeed)}
                            >
                              {numSpeed}x
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ══════════════════════════════════════════════════════════
                    3. 文案/字幕轨道 (Text) 专业设置面板 (绝不显示缩放/音频音量)
                    ══════════════════════════════════════════════════════════ */}
                {selectedTrackObj.type === 'text' && (
                  <div className="space-y-4">
                    {/* 文案内容编辑 */}
                    <div className="space-y-2.5 bg-zinc-950/40 p-2.5 rounded-lg border border-amber-500/20">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Type className="w-3 h-3" />文案内容与编辑
                        </p>
                        <span className="text-[9px] text-zinc-500 font-mono">{(selectedTrackObj.text || selectedTrackObj.name).length}字</span>
                      </div>
                      <textarea
                        className="w-full bg-zinc-900 border border-zinc-700/80 rounded-md p-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none h-20 leading-relaxed font-sans"
                        placeholder="输入字幕或口播带货文案..."
                        value={selectedTrackObj.text ?? selectedTrackObj.name}
                        onChange={(e) => {
                          const newText = e.target.value;
                          updateTrackItem(selectedTrackObj.id, { text: newText, name: newText.slice(0, 30) || '无标题文案' });
                        }}
                      />
                      <div className="flex flex-wrap gap-1">
                        {['🔥爆款热卖中', '限时特惠手慢无', '点击左下角下单', '拍1发3立省百元', '官方正品包邮'].map(tag => (
                          <button
                            key={tag}
                            className="text-[9px] bg-zinc-850 hover:bg-amber-950/60 hover:text-amber-300 text-zinc-400 border border-zinc-700/60 px-1.5 py-0.5 rounded transition-colors"
                            onClick={() => {
                              const cur = selectedTrackObj.text ?? selectedTrackObj.name;
                              const updated = cur ? `${cur} · ${tag}` : tag;
                              updateTrackItem(selectedTrackObj.id, { text: updated, name: updated.slice(0, 30) });
                            }}
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 字体与排版 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-amber-500/20">
                      <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Captions className="w-3 h-3" />字体排版与样式
                      </p>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] text-zinc-400">选择字体</span>
                          <span className="text-[10px] text-amber-400">{selectedTrackObj.fontFamily || '默认黑体'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {['默认黑体', '思源宋体', '快乐体', '抖音美好体', '手写体', '综艺体'].map(font => {
                            const curFont = selectedTrackObj.fontFamily || '默认黑体';
                            const isSel = curFont === font;
                            return (
                              <button
                                key={font}
                                className={`h-6 text-[10px] rounded border transition-all ${
                                  isSel
                                    ? 'bg-amber-600 text-white border-amber-500 font-medium'
                                    : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:text-zinc-200'
                                }`}
                                onClick={() => updateTrackItem(selectedTrackObj.id, { fontFamily: font })}
                              >
                                {font}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-zinc-400">文字字号</span>
                          <span className="text-[10px] text-amber-400 font-mono">{selectedTrackObj.fontSize ?? 18}px</span>
                        </div>
                        <Slider
                          value={[selectedTrackObj.fontSize ?? 18]}
                          onValueChange={(val) => updateTrackItem(selectedTrackObj.id, { fontSize: val[0] })}
                          min={12}
                          max={64}
                          className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
                        <span className="text-[11px] text-zinc-400">字重与对齐</span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant={selectedTrackObj.isBold ? "default" : "outline"}
                            className={`h-7 w-7 p-0 ${selectedTrackObj.isBold ? 'bg-amber-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300'}`}
                            onClick={() => updateTrackItem(selectedTrackObj.id, { isBold: !selectedTrackObj.isBold })}
                            title="加粗"
                          >
                            <Bold className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={selectedTrackObj.isItalic ? "default" : "outline"}
                            className={`h-7 w-7 p-0 ${selectedTrackObj.isItalic ? 'bg-amber-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300'}`}
                            onClick={() => updateTrackItem(selectedTrackObj.id, { isItalic: !selectedTrackObj.isItalic })}
                            title="斜体"
                          >
                            <Italic className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={(selectedTrackObj.textAlign || 'center') === 'left' ? "default" : "outline"}
                            className={`h-7 w-7 p-0 ${(selectedTrackObj.textAlign || 'center') === 'left' ? 'bg-amber-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300'}`}
                            onClick={() => updateTrackItem(selectedTrackObj.id, { textAlign: 'left' })}
                            title="居左对齐"
                          >
                            <AlignLeft className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={(selectedTrackObj.textAlign || 'center') === 'center' ? "default" : "outline"}
                            className={`h-7 w-7 p-0 ${(selectedTrackObj.textAlign || 'center') === 'center' ? 'bg-amber-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300'}`}
                            onClick={() => updateTrackItem(selectedTrackObj.id, { textAlign: 'center' })}
                            title="居中对齐"
                          >
                            <AlignCenter className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={(selectedTrackObj.textAlign || 'center') === 'right' ? "default" : "outline"}
                            className={`h-7 w-7 p-0 ${(selectedTrackObj.textAlign || 'center') === 'right' ? 'bg-amber-600 text-white' : 'bg-zinc-850 border-zinc-700 text-zinc-300'}`}
                            onClick={() => updateTrackItem(selectedTrackObj.id, { textAlign: 'right' })}
                            title="居右对齐"
                          >
                            <AlignRight className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* 字色与描边样式 */}
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-amber-500/20">
                      <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Palette className="w-3 h-3" />字色、描边与底框
                      </p>
                      <div>
                        <span className="text-[10px] text-zinc-400 block mb-1.5">文字颜色</span>
                        <div className="flex items-center gap-1.5">
                          {[
                            { name: '纯白', color: '#ffffff' },
                            { name: '爆款金黄', color: '#ffea00' },
                            { name: '活力橙', color: '#ff7700' },
                            { name: '醒目红', color: '#ff2d55' },
                            { name: '科技青', color: '#00f0ff' },
                            { name: '荧光绿', color: '#22c55e' },
                            { name: '暗夜黑', color: '#18181b' },
                          ].map(item => {
                            const curColor = selectedTrackObj.fontColor || '#ffffff';
                            const isSel = curColor === item.color;
                            return (
                              <button
                                key={item.color}
                                className={`w-6 h-6 rounded-full border-2 transition-transform ${isSel ? 'border-amber-400 scale-110 shadow-md ring-2 ring-amber-400/50' : 'border-zinc-700 hover:scale-105'}`}
                                style={{ backgroundColor: item.color }}
                                onClick={() => updateTrackItem(selectedTrackObj.id, { fontColor: item.color })}
                                title={item.name}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-zinc-400">描边粗细</span>
                          <span className="text-[10px] text-zinc-400 font-mono">{selectedTrackObj.strokeWidth ?? 3}px</span>
                        </div>
                        <Slider
                          value={[selectedTrackObj.strokeWidth ?? 3]}
                          onValueChange={(val) => updateTrackItem(selectedTrackObj.id, { strokeWidth: val[0] })}
                          min={0}
                          max={8}
                          className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-400 block mb-1.5">字幕背景底框</span>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { name: '半透黑', bg: 'rgba(0, 0, 0, 0.75)' },
                            { name: '醒目红', bg: 'rgba(239, 68, 68, 0.85)' },
                            { name: '渐变黄', bg: 'rgba(234, 179, 8, 0.85)' },
                            { name: '纯透明', bg: 'transparent' },
                          ].map(b => {
                            const curBg = selectedTrackObj.bgColor || 'rgba(0, 0, 0, 0.75)';
                            const isSel = curBg === b.bg;
                            return (
                              <button
                                key={b.name}
                                className={`h-6 text-[10px] rounded border transition-all ${
                                  isSel
                                    ? 'bg-amber-600 text-white border-amber-500 font-medium'
                                    : 'bg-zinc-850 border-zinc-700/80 text-zinc-400 hover:text-zinc-200'
                                }`}
                                onClick={() => updateTrackItem(selectedTrackObj.id, { bgColor: b.bg })}
                              >
                                {b.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ══════════════════════════════════════════════════════════
                    4. 特效 / 画中画 / 贴纸轨道专业设置面板
                    ══════════════════════════════════════════════════════════ */}
                {selectedTrackObj.type === 'image' && (
                  <div className="space-y-4">
                    <div className="space-y-3 bg-zinc-950/40 p-2.5 rounded-lg border border-purple-500/20">
                      <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />特效画面与画中画参数
                      </p>
                      <div className="space-y-2.5">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">图层缩放</span>
                            <span className="text-[10px] text-purple-400 font-mono font-medium">{scale[0]}%</span>
                          </div>
                          <Slider value={scale} onValueChange={handleScaleChange} min={10} max={300} className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-400">不透明度</span>
                            <span className="text-[10px] text-purple-400 font-mono font-medium">{opacity[0]}%</span>
                          </div>
                          <Slider value={opacity} onValueChange={handleOpacityChange} max={100} className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 底部通用片段操作栏 */}
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">片段操作</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button size="sm" variant="ghost" className="h-8 text-zinc-400 hover:text-white border border-zinc-700 text-[10px]" onClick={handleSplit}>
                      <ScissorsIcon className="w-3 h-3 mr-1" />分割
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-zinc-400 hover:text-white border border-zinc-700 text-[10px]" onClick={handleCopy}>
                      <Copy className="w-3 h-3 mr-1" />复制
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-zinc-400 hover:text-red-400 border border-zinc-700 text-[10px]" onClick={handleDeleteSelected}>
                      <Trash2 className="w-3 h-3 mr-1" />删除
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-zinc-600 space-y-2 mt-4">
                <Settings2 className="w-8 h-8 opacity-20" />
                <p className="text-[11px]">选中轨道片段后调整属性</p>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* ─── 底部时间轴 ──────────────────────────────────────────── */}
      {/* 移动端降低时间轴高度，给中部预览留出更多空间；lg 及以上恢复 235px */}
      <div className="h-[200px] lg:h-[235px] border-t border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
        <div className="h-10 border-b border-zinc-800 flex items-center justify-between px-2 sm:px-4 bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400 hover:text-white hover:bg-zinc-800" title="分割 S" onClick={handleSplit}>
              <Scissors className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400 hover:text-white hover:bg-zinc-800" title="复制" onClick={handleCopy}>
              <Copy className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400 hover:text-red-400 hover:bg-zinc-800" title="删除 Del" onClick={handleDeleteSelected}>
              <Trash2 className="w-4 h-4" />
            </Button>
            <div className="w-px h-4 bg-zinc-700 mx-1" />
            <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400 hover:text-white hover:bg-zinc-800" title="添加轨道" onClick={() => toast.info('添加轨道')}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="font-mono text-[11px] text-zinc-400 select-none bg-zinc-950/80 px-2.5 py-1 rounded border border-zinc-800/80 flex items-center gap-1.5 shadow-sm">
            <span ref={timeDisplayRef} className="text-zinc-200 font-medium">{formatTime(currentTime)}</span>
            <span className="text-zinc-650">/</span>
            <span className="text-zinc-500">{formatTime(duration)}</span>
          </div>

          {/* 缩放条：小屏隐藏避免时间轴头部溢出，时间显示在预览底栏仍有 */}
          <div className="hidden sm:flex items-center gap-1.5 w-36 shrink-0">
            <button
              className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white"
              onClick={() => setZoom(prev => Math.max(0, prev - 10))}
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5 shrink-0" />
            </button>
            <Slider value={[zoom]} onValueChange={([v]) => setZoom(v)} max={100} className="flex-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3" />
            <button
              className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white"
              onClick={() => setZoom(prev => Math.min(100, prev + 10))}
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>

        {/* 时间刻度 — 固定在滚动区域顶部，独立不受scroll影响 */}
        <div
          ref={rulerRef}
          className="h-7 border-b border-zinc-800 bg-zinc-900 z-10 text-[10px] text-zinc-500 font-mono flex items-end cursor-ew-resize select-none shrink-0 overflow-hidden"
          onClick={handleRulerClick}
          onMouseDown={handleRulerMouseDown}
        >
          <div className="shrink-0 h-full bg-zinc-900" style={{ width: TRACK_CONTENT_OFFSET }} />
          <div className="relative h-full overflow-hidden ruler-ticks-container" style={{ flex: 1 }}>
            <div className="absolute top-0 left-0 h-full" style={{ width: duration * pxPerSec, transform: `translateX(-${timelineScrollOffset}px)` }}>
              {(() => {
                const ticks: number[] = [];
                const step = pxPerSec < 15 ? 10 : pxPerSec < 40 ? 5 : 1;
                for (let i = 0; i <= duration; i += step) {
                  ticks.push(i);
                }
                return ticks.map(sec => (
                  <div key={sec} className="absolute bottom-0" style={{ left: `${sec * pxPerSec}px` }}>
                    <div className="h-1.5 w-px bg-zinc-600 mb-0.5" />
                    {sec % (step * 2) === 0 && (
                      <span className="absolute -left-3 bottom-2 whitespace-nowrap">
                        {Math.floor(sec / 60)}:{(sec % 60).toString().padStart(2, '0')}
                      </span>
                    )}
                  </div>
                ));
              })()}
              {/* 标尺上的播放指针游标 */}
              <div
                ref={rulerPlayheadRef}
                className="absolute top-0 bottom-0 pointer-events-none z-30"
                style={{ left: `${currentTime * pxPerSec}px` }}
              >
                <div className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[7px] border-t-red-500 -translate-x-[5px]" />
                <div className="w-px h-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-auto relative bg-zinc-950" ref={timelineScrollRef}>
          <div
            style={{ width: Math.max(timelinePxWidth, timelineMinWidth), minWidth: '100%' }}
            className="min-h-full flex flex-col relative"
          >
            {/* 轨道时间线刻度网格线背景 */}
            {(() => {
              const ticks: number[] = [];
              const step = duration > 120 ? 20 : duration > 60 ? 10 : 5;
              for (let i = 0; i <= duration; i += step) {
                ticks.push(i);
              }
              return ticks.map(sec => (
                <div
                  key={`grid-${sec}`}
                  className="absolute top-0 bottom-0 w-px border-l border-zinc-800/40 border-dashed pointer-events-none z-0"
                  style={{ left: `${TRACK_CONTENT_OFFSET + sec * pxPerSec}px` }}
                />
              ));
            })()}

            <div className="p-1.5 space-y-1 relative z-10">
              {/* 主视频轨道 */}
              <div className="flex gap-1.5">
                <div
                  className={`shrink-0 h-10 border rounded flex flex-col items-center justify-center cursor-pointer transition-all sticky left-0 z-10 select-none ${
                    selectedTrackObj?.type === 'video'
                      ? 'border-indigo-500 bg-indigo-950/70 text-indigo-300 ring-1 ring-indigo-500/50'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  style={{ width: TRACK_LABEL_W }}
                  title="点击选中主轨道"
                  onClick={() => {
                    const track = tracks.find(t => t.type === 'video');
                    if (track) setSelectedTrackItem(track.id);
                  }}
                >
                  <Film className="w-3.5 h-3.5 mb-0.5" />
                  <span className="text-[8px] font-medium">主轨道</span>
                </div>
                <div className="relative h-10 bg-zinc-900/30 rounded border border-zinc-800/50" style={{ width: duration * pxPerSec }}>
                  {tracks.filter(item => item.type === 'video').map(item => (
                    <div
                      key={item.id}
                      className={`absolute top-1 bottom-1 bg-indigo-600/50 border border-indigo-400/60 rounded flex items-center px-2 cursor-pointer hover:bg-indigo-600/70 select-none ${(selectedTrackItem === item.id || (!selectedTrackItem && item.id === selectedTrackObj?.id)) ? 'ring-2 ring-indigo-400' : ''}`}
                      style={{
                        left: item.start * pxPerSec,
                        width: item.duration * pxPerSec,
                        transform: dragInfo?.id === item.id ? `translate(${dragInfo.offsetX}px, ${dragInfo.offsetY}px)` : undefined,
                        zIndex: dragInfo?.id === item.id ? 50 : undefined,
                        opacity: dragInfo?.id === item.id ? 0.8 : undefined,
                      }}
                      onClick={() => setSelectedTrackItem(item.id)}
                      onMouseDown={(e) => handleTrackItemMouseDown(e, item)}
                    >
                      <span className="text-[11px] text-indigo-100 truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 音频轨道 */}
              <div className="flex gap-1.5">
                <div
                  className={`shrink-0 h-8 border rounded flex flex-col items-center justify-center cursor-pointer transition-all sticky left-0 z-10 select-none ${
                    selectedTrackObj?.type === 'audio'
                      ? 'border-emerald-500 bg-emerald-950/70 text-emerald-300 ring-1 ring-emerald-500/50'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  style={{ width: TRACK_LABEL_W }}
                  title="点击选中音频轨道"
                  onClick={() => {
                    const track = tracks.find(t => t.type === 'audio');
                    if (track) setSelectedTrackItem(track.id);
                  }}
                >
                  <Music2 className="w-3.5 h-3.5 mb-0.5" />
                  <span className="text-[8px] font-medium">音频</span>
                </div>
                <div className="relative h-8 bg-zinc-900/30 rounded border border-zinc-800/50" style={{ width: duration * pxPerSec }}>
                  {tracks.filter(item => item.type === 'audio').map(item => (
                    <div
                      key={item.id}
                      className={`absolute top-0.5 bottom-0.5 bg-emerald-600/50 border border-emerald-400/60 rounded flex items-center px-2 cursor-pointer hover:bg-emerald-600/70 select-none ${selectedTrackItem === item.id ? 'ring-2 ring-emerald-400' : ''}`}
                      style={{
                        left: item.start * pxPerSec,
                        width: item.duration * pxPerSec,
                        transform: dragInfo?.id === item.id ? `translate(${dragInfo.offsetX}px, ${dragInfo.offsetY}px)` : undefined,
                        zIndex: dragInfo?.id === item.id ? 50 : undefined,
                        opacity: dragInfo?.id === item.id ? 0.8 : undefined,
                      }}
                      onClick={() => setSelectedTrackItem(item.id)}
                      onMouseDown={(e) => handleTrackItemMouseDown(e, item)}
                    >
                      <span className="text-[10px] text-emerald-100 truncate font-mono">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 字幕文案轨道 */}
              <div className="flex gap-1.5">
                <div
                  className={`shrink-0 h-7 border rounded flex items-center justify-center cursor-pointer transition-all sticky left-0 z-10 select-none gap-1 ${
                    selectedTrackObj?.type === 'text'
                      ? 'border-amber-500 bg-amber-950/70 text-amber-300 ring-1 ring-amber-500/50'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  style={{ width: TRACK_LABEL_W }}
                  title="点击选中文案轨道"
                  onClick={() => {
                    const track = tracks.find(t => t.type === 'text');
                    if (track) setSelectedTrackItem(track.id);
                  }}
                >
                  <Type className="w-3 h-3" />
                  <span className="text-[8px] font-medium">文案</span>
                </div>
                <div className="relative h-7 bg-zinc-900/30 rounded border border-zinc-800/50" style={{ width: duration * pxPerSec }}>
                  {tracks.filter(item => item.type === 'text').map(item => (
                    <div
                      key={item.id}
                      className={`absolute top-0.5 bottom-0.5 bg-amber-600/50 border border-amber-400/60 rounded flex items-center justify-center cursor-pointer hover:bg-amber-600/70 select-none ${selectedTrackItem === item.id ? 'ring-2 ring-amber-400' : ''}`}
                      style={{
                        left: item.start * pxPerSec,
                        width: item.duration * pxPerSec,
                        transform: dragInfo?.id === item.id ? `translate(${dragInfo.offsetX}px, ${dragInfo.offsetY}px)` : undefined,
                        zIndex: dragInfo?.id === item.id ? 50 : undefined,
                        opacity: dragInfo?.id === item.id ? 0.8 : undefined,
                      }}
                      onClick={() => setSelectedTrackItem(item.id)}
                      onMouseDown={(e) => handleTrackItemMouseDown(e, item)}
                    >
                      <span className="text-[9px] text-amber-100 truncate px-1">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 特效轨道 */}
              <div className="flex gap-1.5">
                <div
                  className={`shrink-0 h-7 border rounded flex items-center justify-center cursor-pointer transition-all sticky left-0 z-10 select-none gap-1 ${
                    selectedTrackObj?.type === 'image' || selectedTrackObj?.trackId === 'effects'
                      ? 'border-purple-500 bg-purple-950/70 text-purple-300 ring-1 ring-purple-500/50'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  style={{ width: TRACK_LABEL_W }}
                  title="点击选中特效轨道"
                  onClick={() => {
                    const track = tracks.find(t => t.type === 'image' || t.trackId === 'effects');
                    if (track) setSelectedTrackItem(track.id);
                  }}
                >
                  <Sparkles className="w-3 h-3" />
                  <span className="text-[8px] font-medium">特效</span>
                </div>
                <div className="relative h-7 bg-zinc-900/30 rounded border border-zinc-800/50" style={{ width: duration * pxPerSec }}>
                  {tracks.filter(item => item.type === 'image').map(item => (
                    <div
                      key={item.id}
                      className={`absolute top-0.5 bottom-0.5 bg-purple-600/50 border border-purple-400/60 rounded flex items-center justify-center cursor-pointer hover:bg-purple-600/70 select-none ${selectedTrackItem === item.id ? 'ring-2 ring-purple-400' : ''}`}
                      style={{
                        left: item.start * pxPerSec,
                        width: item.duration * pxPerSec,
                        transform: dragInfo?.id === item.id ? `translate(${dragInfo.offsetX}px, ${dragInfo.offsetY}px)` : undefined,
                        zIndex: dragInfo?.id === item.id ? 50 : undefined,
                        opacity: dragInfo?.id === item.id ? 0.8 : undefined,
                      }}
                      onClick={() => setSelectedTrackItem(item.id)}
                      onMouseDown={(e) => handleTrackItemMouseDown(e, item)}
                    >
                      <span className="text-[9px] text-purple-100 px-1 truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 播放指针竖线 */}
            <div
              ref={playheadLineRef}
              className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              style={{ left: `${TRACK_CONTENT_OFFSET + currentTime * pxPerSec}px` }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)]" />
            </div>
          </div>
        </div>
      </div>

      {/* 保存弹窗 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700 text-zinc-200">
          <DialogHeader>
            <DialogTitle className="text-zinc-200">保存剪辑项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <span className="text-xs text-zinc-400">项目名称</span>
              <Input
                value={projectTitle}
                onChange={e => setProjectTitle(e.target.value)}
                placeholder="输入项目名称"
                className="bg-zinc-800 border-zinc-700 text-zinc-200"
              />
            </div>
            <div className="text-xs text-zinc-500">轨道数：{tracks.length} · 时长：{duration}s</div>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1 h-9 text-zinc-400 hover:text-zinc-200" onClick={() => setSaveDialogOpen(false)}>取消</Button>
              <Button className="flex-1 h-9 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
                保存草稿
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 导出视频与渲染全流程进度弹窗 */}
      <Dialog open={exportDialogOpen} onOpenChange={(open) => {
        setExportDialogOpen(open);
      }}>
        {/* 移动端限高：标头固定，内容区滚动 */}
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-xl max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] bg-zinc-900 border-zinc-700 text-zinc-200 p-0 overflow-hidden shadow-2xl">
          {/* 弹窗顶部标头 */}
          <div className="px-3 sm:px-6 py-4 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center border",
                exportStage === 'rendering' ? "bg-indigo-950/70 border-indigo-500/40 text-indigo-400" :
                exportStage === 'completed' ? "bg-emerald-950/70 border-emerald-500/40 text-emerald-400" :
                exportStage === 'failed' ? "bg-rose-950/70 border-rose-500/40 text-rose-400" :
                "bg-zinc-800 border-zinc-700 text-zinc-300"
              )}>
                {exportStage === 'rendering' ? <Loader2 className="w-5 h-5 animate-spin" /> :
                 exportStage === 'completed' ? <CheckCircle2 className="w-5 h-5" /> :
                 exportStage === 'failed' ? <AlertCircle className="w-5 h-5" /> :
                 <Download className="w-5 h-5 text-indigo-400" />}
              </div>
              <div>
                <DialogTitle className="text-zinc-100 text-base font-semibold">
                  {exportStage === 'idle' && '导出并渲染带货视频'}
                  {exportStage === 'rendering' && '正在执行视频多轨渲染合成...'}
                  {exportStage === 'completed' && '视频导出渲染成功'}
                  {exportStage === 'failed' && '视频渲染导出失败'}
                </DialogTitle>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {exportStage === 'idle' && '配置导出分辨率与参数，渲染完成后将自动同步至作品库与素材库'}
                  {exportStage === 'rendering' && (exportStatusText || '云端 AI 与本地引擎并行处理中')}
                  {exportStage === 'completed' && '成片已入库并生成真实高清首帧，可直接预览或下载'}
                  {exportStage === 'failed' && '导出过程中发生异常，您可以检查原因后重试'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 sm:p-6 space-y-5 overflow-y-auto min-h-0">
            {/* 1. 参数配置阶段 (idle) */}
            {exportStage === 'idle' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                    <span>成片作品标题</span>
                    <span className="text-[11px] text-zinc-500 font-normal">用于作品库与素材库展示</span>
                  </label>
                  <Input
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="输入导出视频名称"
                    className="bg-zinc-800/80 border-zinc-700 text-zinc-100 text-sm focus-visible:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">导出画质 / 分辨率</label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-950 rounded-lg border border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setExportResolution('1080p')}
                        className={cn(
                          "py-1.5 px-2 rounded text-xs font-medium transition-all text-center",
                          exportResolution === '1080p'
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                        )}
                      >
                        1080P 高清
                      </button>
                      <button
                        type="button"
                        onClick={() => setExportResolution('720p')}
                        className={cn(
                          "py-1.5 px-2 rounded text-xs font-medium transition-all text-center",
                          exportResolution === '720p'
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                        )}
                      >
                        720P 标清
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">帧率设置 (FPS)</label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-950 rounded-lg border border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setExportFps('30')}
                        className={cn(
                          "py-1.5 px-2 rounded text-xs font-medium transition-all text-center",
                          exportFps === '30'
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                        )}
                      >
                        30 FPS 推荐
                      </button>
                      <button
                        type="button"
                        onClick={() => setExportFps('60')}
                        className={cn(
                          "py-1.5 px-2 rounded text-xs font-medium transition-all text-center",
                          exportFps === '60'
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                        )}
                      >
                        60 FPS 流畅
                      </button>
                    </div>
                  </div>
                </div>

                {/* 剪辑工程摘要卡片 */}
                <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 p-3.5 space-y-2.5">
                  <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <Film className="w-3.5 h-3.5 text-indigo-400" />
                      当前剪辑工程参数
                    </span>
                    <span className="text-[11px] text-indigo-400 font-mono">
                      预计体积 ~{(Math.round(duration * (exportResolution === '1080p' ? 0.45 : 0.28) * 10) / 10).toFixed(1)} MB
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] text-zinc-500 block">成片时长</span>
                      <span className="text-xs font-semibold text-zinc-200 mt-0.5 block">{Math.round(duration)} 秒</span>
                    </div>
                    <div className="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] text-zinc-500 block">有效轨道</span>
                      <span className="text-xs font-semibold text-zinc-200 mt-0.5 block">{tracks.length} 个元素</span>
                    </div>
                    <div className="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] text-zinc-500 block">画幅构图</span>
                      <span className="text-xs font-semibold text-zinc-200 mt-0.5 block">
                        {editorAspect === 'aspect-[9/16]' ? '9:16 竖屏' : '16:9 横屏'}
                      </span>
                    </div>
                    <div className="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800/60">
                      <span className="text-[10px] text-zinc-500 block">编码格式</span>
                      <span className="text-xs font-semibold text-zinc-200 mt-0.5 block">MP4 (H.264)</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    variant="ghost"
                    className="flex-1 h-10 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    onClick={() => setExportDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 text-white gap-2 font-medium shadow-md shadow-indigo-600/20"
                    onClick={executeExportTask}
                  >
                    <Sparkles className="w-4 h-4" />
                    开始渲染导出并入库
                  </Button>
                </div>
              </div>
            )}

            {/* 2. 渲染中阶段 (rendering) */}
            {exportStage === 'rendering' && (
              <div className="space-y-4">
                {/* 大进度条与百分比 */}
                <div className="rounded-xl bg-zinc-950 p-4 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
                      </span>
                      <span className="text-sm font-medium text-zinc-200">{exportStatusText}</span>
                    </div>
                    <span className="text-lg font-bold font-mono text-indigo-400">{exportProgress}%</span>
                  </div>
                  <Progress value={exportProgress} className="h-2.5 bg-zinc-800" />
                </div>

                {/* 阶段状态指示器 */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { label: '解析轨道', target: 28 },
                    { label: '抽帧校准', target: 48 },
                    { label: '滤镜合成', target: 84 },
                    { label: '双库联动', target: 100 },
                  ].map((step, idx) => (
                    <div
                      key={step.label}
                      className={cn(
                        "p-2 rounded-lg border text-[11px] transition-all",
                        exportProgress >= step.target
                          ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300 font-medium"
                          : exportProgress >= (step.target - 20)
                          ? "bg-indigo-950/40 border-indigo-500/40 text-indigo-300 font-medium animate-pulse"
                          : "bg-zinc-950/40 border-zinc-800/60 text-zinc-500"
                      )}
                    >
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        {exportProgress >= step.target ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <span className="w-3 h-3 rounded-full border border-current text-[9px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                        )}
                        <span>{step.label}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 终端实时日志 */}
                <div className="rounded-xl bg-[#090d14] border border-zinc-800 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-950/80 text-[11px] text-zinc-400 font-mono">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Render Engine Pipeline Log
                    </span>
                    <span className="text-zinc-600">H.264/AAC</span>
                  </div>
                  <div className="p-3 font-mono text-[11px] space-y-1.5 max-h-36 overflow-y-auto">
                    {exportLogs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-zinc-600 shrink-0">[{log.time}]</span>
                        <span className={cn(
                          "shrink-0 px-1 rounded text-[10px]",
                          log.percent === 100 ? "bg-emerald-500/20 text-emerald-400" : "bg-indigo-500/20 text-indigo-300"
                        )}>
                          {log.percent}%
                        </span>
                        <span className="text-zinc-300">{log.stage}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-[11px] text-zinc-500 text-center">
                  * 渲染合成将在后台持续写入 Supabase，成片导出后将同步出现在「作品库」与「素材库」中
                </p>
              </div>
            )}

            {/* 3. 渲染成功阶段 (completed) */}
            {exportStage === 'completed' && exportResult && (
              <div className="space-y-4">
                {/* 视频内嵌播放与信息预览 */}
                <div className="rounded-xl overflow-hidden bg-black border border-zinc-800 relative group">
                  <video
                    src={exportResult.video_url}
                    poster={exportResult.thumbnail_url}
                    controls
                    autoPlay
                    playsInline
                    className="w-full max-h-64 object-contain mx-auto bg-black"
                  />
                  <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-emerald-400 font-medium border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    渲染完成 · 真实首帧
                  </div>
                </div>

                {/* 成片信息卡片 */}
                <div className="grid grid-cols-4 gap-2 bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-center">
                  <div>
                    <span className="text-[10px] text-zinc-500 block">视频名称</span>
                    <span className="text-xs font-semibold text-zinc-200 truncate block mt-0.5" title={exportResult.title}>
                      {exportResult.title}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 block">成片画质</span>
                    <span className="text-xs font-semibold text-indigo-400 block mt-0.5">{exportResult.resolution}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 block">成片时长</span>
                    <span className="text-xs font-semibold text-zinc-200 block mt-0.5">{exportResult.duration} 秒</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 block">文件大小</span>
                    <span className="text-xs font-semibold text-zinc-200 block mt-0.5">{exportResult.size}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                  <span className="flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-emerald-400" />
                    数据已成功写入 video_projects 和 materials 表
                  </span>
                  <span className="text-[11px] text-emerald-400 font-medium">双库已同步</span>
                </div>

                {/* 操作按钮组（移动端纵向堆叠，sm 及以上恢复三列） */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <Button
                    variant="outline"
                    className="h-10 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 gap-1.5 text-xs"
                    onClick={handleDownloadExported}
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" />
                    下载视频文件
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 gap-1.5 text-xs"
                    onClick={() => {
                      setExportDialogOpen(false);
                      navigate('/works');
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                    查看作品库
                  </Button>
                  <Button
                    className="h-10 bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 text-xs font-medium"
                    onClick={() => setExportDialogOpen(false)}
                  >
                    <Check className="w-3.5 h-3.5" />
                    完成并继续编辑
                  </Button>
                </div>
              </div>
            )}

            {/* 4. 渲染失败阶段 (failed) */}
            {exportStage === 'failed' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2">
                  <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>导出失败原因</span>
                  </div>
                  <p className="text-xs text-rose-200/90 leading-relaxed font-mono bg-black/40 p-2.5 rounded border border-rose-900/50">
                    {exportError || '未知网络错误或渲染任务超时'}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    variant="ghost"
                    className="flex-1 h-10 text-zinc-400 hover:text-zinc-200"
                    onClick={() => setExportDialogOpen(false)}
                  >
                    关闭
                  </Button>
                  <Button
                    className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 text-white gap-2 font-medium"
                    onClick={executeExportTask}
                  >
                    <RefreshCw className="w-4 h-4" />
                    重试导出渲染
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
