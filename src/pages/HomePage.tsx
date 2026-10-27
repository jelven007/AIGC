import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Sparkles, ChevronDown, ImageIcon, Video, Wand2,
  BarChart2, Droplets, ArrowUpCircle, Mic, Globe, RefreshCcw,
  MoreHorizontal, Maximize2, Copy, Plus, ChevronRight, Loader2, X, Download, Image as ImageIcon2, Layers, Play, User, Users2, Pencil,
  ShoppingBag, Package, Search, Check, Tag
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useVideoGeneration } from '@/hooks/useVideoGeneration';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ProductVideoWizard from './VideoCreatePage';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UrlProductImportDialog } from '@/components/UrlProductImportDialog';
import { usePromptAssistant } from '@/hooks/usePromptAssistant';
import { useWorkspaceEntry } from '@/hooks/useWorkspaceEntry';
import { makeWorkTitle } from '@/lib/utils';
import { useReferenceMaterials } from '@/hooks/useReferenceMaterials';
import { useWorkspaceModels } from '@/hooks/useWorkspaceModels';
import { useProductionJob } from '@/hooks/useProductionJob';
import { Product } from '@/types/types';
import { ProductImage } from '@/components/ProductFields';
import { productPrice } from '@/lib/productDisplay';
import { listProducts } from '@/api/products';
import { useRecentWorks } from '@/hooks/useRecentWorks';
import ImageEditCanvas, { type PreparedImageEdit } from '@/components/ImageEditCanvas';
import type { ImageMode } from '../../supabase/functions/_shared/image-contract';
import { useCredits } from '@/hooks/useCredits';




// ── 工具卡片数据 ────────────────────────────────────────────────────────
const QUICK_TOOLS = [
  {
    id: 'script', label: 'AI智能脚本', sub: '生成分镜后确认台词与商品事实',
    gradient: 'from-rose-800/80 to-pink-900/80',
    path: '/script',
  },
  {
    id: 'style-copy', label: '爆款风格复刻', sub: '分析授权视频并提取风格建议',
    gradient: 'from-violet-800/80 to-indigo-900/80',
    path: '/style-copy',
  },
  {
    id: 'competitor', label: '竞品爆款分析', sub: '采集已授权样本并分析内容策略',
    gradient: 'from-sky-800/80 to-blue-900/80',
    path: '/competitor',
  },
  {
    id: 'analytics', label: '作品表现', sub: '查看官方指标和授权交易观测',
    gradient: 'from-amber-800/80 to-orange-900/80',
    path: '/analytics',
  },
  {
    id: 'live-highlight', label: '直播高光切片', sub: '分析实际画面与台词，确认候选片段',
    gradient: 'from-teal-800/80 to-emerald-900/80',
    path: '/live-highlight',
  },
  {
    id: 'knowledge', label: '知识库', sub: '沉淀带货话术，AI语义检索',
    gradient: 'from-fuchsia-800/80 to-purple-900/80',
    path: '/knowledge',
  },
];



// 模型与对应后端标识
type ModelId = 'ArkSeedance' | 'Kling' | 'MiniMax' | 'Wan3' | 'SeedanceMini' | 'HappyHorse';
const MODELS: { label: string; id: ModelId; vendor: string; iconSymbol: string; active?: boolean }[] = [
  { label: '火山方舟 Seedance', id: 'ArkSeedance', vendor: '火山引擎', iconSymbol: '⚡', active: true },
  { label: 'MiniMax H3', id: 'MiniMax', vendor: 'MiniMax', iconSymbol: '🚀', active: true },
  { label: 'Seedance 2.0', id: 'SeedanceMini', vendor: 'ByteDance Ark', iconSymbol: '⚡', active: true },
  { label: 'Wan3.0 Prime', id: 'Wan3', vendor: 'Qwen · Alibaba', iconSymbol: '🌀', active: true },
  { label: 'HappyHorse 1.1', id: 'HappyHorse', vendor: 'Alibaba', iconSymbol: '🐎', active: true },
  { label: 'Kling-V3', id: 'Kling', vendor: 'Kuaishou AI', iconSymbol: '🎬', active: true },
];
// 默认规格与工作台初始选中项一致：720P · 16:9 横版 · 5s
const RESOLUTIONS = ['720P · 16:9 · 5s', '1080P · 9:16 · 10s', '4K · 1:1 · 8s'];

const FILTER_CONFIG = [
  { key: 'model', label: '生成来源' },
  { key: 'ratio', label: '比例' },
  { key: 'refImage', label: '参考图' },
  { key: 'firstLast', label: '首尾帧' },
  { key: 'category', label: '商品分类' },
  { key: 'language', label: '语言' },
];

const MAIN_TABS = ['视频生成', '分镜编辑', '图片生成'];
const INPUT_TABS = ['参考', '商品', '数字人', '首尾帧'];

export interface CategoryVideoItem {
  id: string;
  name: string;
  category: string;
  url: string;
  cover: string;
  prompt: string;
  model: string;
  ratio: string;
  duration?: string;
}


// ── 主页组件 ───────────────────────────────────────────────────────────
export default function HomePage() {
  const { user } = useAuth();
  const entry = useWorkspaceEntry(user?.id);
  return <HomeWorkspace key={user?.id || 'signed-out'} entry={entry} />;
}

function HomeWorkspace({ entry }: { entry: any }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const route = useLocation();
  const location = { ...route, state: entry };
  const { user, profile } = useAuth();
  const references = useReferenceMaterials(user?.id);
  const { rights: referenceRights, setRights: setReferenceRights, busy: referenceBusy,
    pending: pendingReferences, recover: recoverReferences, upload: importReference } = references;
  const workspaceActive = useRef(true);
  useEffect(() => { workspaceActive.current = true; return () => { workspaceActive.current = false; }; }, []);

  const [mainTab, setMainTab] = useState(projectId ? '分镜编辑' : new URLSearchParams(location.search).get('tab') === 'image' ? '图片生成' : '视频生成');
  const [inputTab, setInputTab] = useState(location.state?.inputTab || '参考');
  const [selectedAvatar, setSelectedAvatar] = useState<{ id?: string; name: string; preview_image?: string } | null>(
    location.state?.selectedAvatar ?? null
  );

  const [prompt, setPrompt] = useState('');

  // ── 输入框仅在输入文字的那一刻环绕跑马光效状态 ─────────────────────
  const [isTypingVideo, setIsTypingVideo] = useState(false);
  const typingVideoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerVideoTypingGlow = useCallback(() => {
    setIsTypingVideo(true);
    if (typingVideoTimeoutRef.current) {
      clearTimeout(typingVideoTimeoutRef.current);
    }
    typingVideoTimeoutRef.current = setTimeout(() => {
      setIsTypingVideo(false);
    }, 1800);
  }, []);

  const [isTypingImg, setIsTypingImg] = useState(false);
  const typingImgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerImgTypingGlow = useCallback(() => {
    setIsTypingImg(true);
    if (typingImgTimeoutRef.current) {
      clearTimeout(typingImgTimeoutRef.current);
    }
    typingImgTimeoutRef.current = setTimeout(() => {
      setIsTypingImg(false);
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (typingVideoTimeoutRef.current) clearTimeout(typingVideoTimeoutRef.current);
      if (typingImgTimeoutRef.current) clearTimeout(typingImgTimeoutRef.current);
    };
  }, []);

  // ── 商品选择弹窗及提取提示词相关状态 ──────────────────────────
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('全部');
  const [urlParseOpen, setUrlParseOpen] = useState(false);
  const [modalViewTab, setModalViewTab] = useState<'products' | 'videos'>('products');
  const recentWorks = useRecentWorks(user?.id);
  const categoryVideos = recentWorks.items, inspireVideos = recentWorks.items;
  const workFilters = FILTER_CONFIG.map(filter => ({ ...filter, options: ['全部',
    ...Array.from(new Set(inspireVideos.map(video => video[filter.key as keyof typeof video]))).filter(value => value !== '未记录')] }));

  // 接收真实商品回执，视频通过创作流程生成。
  const handleImportProductSuccess = (newProd: Product) => {
    // 1. 存入商品列表顶部
    setProductsList(prev => [newProd, ...prev.filter(p => p.id !== newProd.id)]);

    // 自动激活该商品对应的分类
    if (['服装配饰', '美妆护肤', '数码电器', '食品饮料', '家居用品'].includes(newProd.category)) {
      setSelectedCategoryFilter(newProd.category);
    }

    setSelectedProduct(newProd);
  };

  const loadProductsForSelector = useCallback(async () => {
    setLoadingProducts(true);
    try {
      if (!user) { setProductsList([]); return; }
      const { products } = await listProducts({ limit: 100 }, user.id);
      if (workspaceActive.current) setProductsList(products);
    } catch (err) {
      if (workspaceActive.current) toast.error(err instanceof Error ? err.message : '商品库读取失败，请重试');
    } finally {
      if (workspaceActive.current) setLoadingProducts(false);
    }
  }, [user]);

  const handleSelectProduct = useCallback((prod: Product) => {
    setSelectedProduct(prod);
    setIsProductModalOpen(false);

    const points = (prod.selling_points || []).filter(Boolean);
    const aiPoints = (prod.ai_selling_points || []).filter(Boolean);
    const allPoints = Array.from(new Set([...points, ...aiPoints]));
    const priceText = prod.sale_price != null || prod.original_price != null ? productPrice(prod) : '';

    let generatedPrompt = `【爆款电商带货视频】${prod.name}`;
    if (prod.category) generatedPrompt += `（${prod.category}）`;
    if (priceText) generatedPrompt += ` | 商品标价：${priceText}`;

    if (allPoints.length > 0) {
      generatedPrompt += `\n✨ 核心卖点：${allPoints.join('；')}`;
    }

    if (prod.description) {
      generatedPrompt += `\n📝 商品详情描述：${prod.description.trim()}`;
    }

    generatedPrompt += `\n🎥 视频分镜与视角要求：镜头首先前3秒高清特写展示${prod.name}的高保真实物细节与质感，痛点引发共鸣，接着自然过渡至使用场景演示，配合柔和高光与动态转场，突出${allPoints[0] || '核心优势'}，最后高能促成买家下单。`;

    setPrompt(generatedPrompt);
    triggerVideoTypingGlow();

    toast.success(`已成功选择商品「${prod.name}」，关键卖点与描述信息已自动生成并填充至提示词脚本！`, {
      duration: 4000,
      style: {
        background: '#1c1929',
        color: '#ffffff',
        border: '1.5px solid #10b981',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.7)',
        borderRadius: '14px',
        padding: '12px 16px',
        fontSize: '13px',
        fontWeight: '600',
      },
    });
  }, []);

  useEffect(() => {
    if (location.state?.selectedProduct) {
      setMainTab('视频生成');
      setInputTab('商品');
      handleSelectProduct(location.state.selectedProduct);
    } else if (location.state?.prefillProductName) {
      setMainTab('视频生成');
      setInputTab('商品');
      const existing = productsList.find(p => p.name === location.state.prefillProductName);
      if (existing) {
        handleSelectProduct(existing);
      }
    } else if (location.state?.inputTab === '商品') {
      setMainTab('视频生成');
      setInputTab('商品');
    } else if (location.state?.selectedAvatar) {
      setMainTab('视频生成');
      setSelectedAvatar(location.state.selectedAvatar);
      setInputTab(location.state?.inputTab || '数字人');
      if (!prompt.trim()) {
        const avName = location.state.selectedAvatar.name;
        setPrompt(`【${avName} · AI数字人出镜带货】\n🎥 视频分镜：由${avName}亲切面向镜头做开场痛点唤醒，随后高清特写展示产品实物细节与核心优势，搭配丝滑运镜与高光物理渲染，最后高能引导用户下单。`);
        triggerVideoTypingGlow();
      }
    } else if (location.state?.prompt) {
      // 从 Prompt 知识库 / 口播台词优化带入：完整 Prompt 自动填入视频生成输入框
      setMainTab('视频生成');
      setPrompt(location.state.prompt);
      triggerVideoTypingGlow();
      toast.info('已将所选完整 Prompt 自动填入工作台输入框！');
    } else if (location.state?.from === 'script' && location.state?.promptText) {
      setMainTab('视频生成');
      setPrompt(location.state.promptText);
      triggerVideoTypingGlow();
    }
  }, [location.state, handleSelectProduct, productsList]);

  const filteredSelectorProducts = productsList.filter(prod => {
    if (selectedCategoryFilter !== '全部' && prod.category !== selectedCategoryFilter) return false;
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      const matchName = (prod.name || '').toLowerCase().includes(q);
      const matchCategory = (prod.category || '').toLowerCase().includes(q);
      const matchPoints = [...(prod.selling_points || []), ...(prod.ai_selling_points || [])].some(pt => pt.toLowerCase().includes(q));
      const matchDesc = (prod.description || '').toLowerCase().includes(q);
      return matchName || matchCategory || matchPoints || matchDesc;
    }
    return true;
  });

  const filteredCategoryVideos = categoryVideos.filter(vid => {
    if (selectedCategoryFilter !== '全部' && vid.category !== selectedCategoryFilter) return false;
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      const matchName = (vid.name || '').toLowerCase().includes(q);
      const matchPrompt = (vid.prompt || '').toLowerCase().includes(q);
      const matchCategory = (vid.category || '').toLowerCase().includes(q);
      return matchName || matchPrompt || matchCategory;
    }
    return true;
  });
  const [model, setModel] = useState<{ label: string; id: string }>({ label: '火山方舟 Seedance', id: 'ArkSeedance' });
  const [resolution, setResolution] = useState('720P · 16:9 · 5s');
  const [modelOpen, setModelOpen] = useState(false);
  const workspaceModels = useWorkspaceModels(user?.id);
  const { models: modelCatalog, error: modelCatalogError, price: imageCost, refreshing: imageSettingsBusy } = workspaceModels;
  useEffect(() => {
    setModel(previous => {
      const video = modelCatalog.find(item => item.provider === previous.id && item.category === 'video' && item.enabled)
        || modelCatalog.find(item => item.category === 'video' && item.enabled && item.provider);
      return !video || previous.label === video.name && previous.id === video.provider
        ? previous : { label: video.name, id: video.provider! };
    });
  }, [modelCatalog]);
  useEffect(() => {
    // 清除旧版本遗留的浏览器模型密钥。
    try { localStorage.removeItem('custom_models_video'); localStorage.removeItem('custom_models_image'); } catch {}
  }, []);
  const [resOpen, setResOpen] = useState(false);

  // 灵感广场筛选状态
  const [filterModel, setFilterModel] = useState('全部');
  const [filterRatio, setFilterRatio] = useState('全部');
  const [filterRefImage, setFilterRefImage] = useState('全部');
  const [filterFirstLast, setFilterFirstLast] = useState('全部');
  const [filterCategory, setFilterCategory] = useState('全部');
  const [filterLanguage, setFilterLanguage] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const filteredInspireVideos = inspireVideos.filter(video => {
    if (filterModel !== '全部' && video.model !== filterModel) return false;
    if (filterRatio !== '全部' && video.ratio !== filterRatio) return false;
    if (filterRefImage !== '全部' && video.refImage !== filterRefImage) return false;
    if (filterFirstLast !== '全部' && video.firstLast !== filterFirstLast) return false;
    if (filterCategory !== '全部' && video.category !== filterCategory) return false;
    if (filterLanguage !== '全部' && video.language !== filterLanguage) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchPrompt = video.prompt.toLowerCase().includes(q);
      const matchModel = video.model.toLowerCase().includes(q);
      const matchCategory = video.category.toLowerCase().includes(q);
      return matchPrompt || matchModel || matchCategory;
    }
    return true;
  });

  // 新增的高级分辨率/宽高比/时长/扩展设置状态（默认与 RESOLUTIONS[0] 完全一致：720P · 16:9 横版 · 5s）
  const [activeResolution, setActiveResolution] = useState('720P');
  const [activeRatio, setActiveRatio] = useState('16:9');
  const [activeDuration, setActiveDuration] = useState(5);
  const [autoOptimize, setAutoOptimize] = useState(false);

  // 新增参考图片、视频、首尾帧的图片上传状态
  const [refImage, setRefImage] = useState<string | null>(null);
  const [refVideo, setRefVideo] = useState<string | null>(null);
  const [firstFrame, setFirstFrame] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);

  // 图片生成相关新状态与 ref
  const [imgRefImage, setImgRefImage] = useState<string | null>(null);
  const [imgMode, setImgMode] = useState<ImageMode>('generate');
  const [preparedImageEdit, setPreparedImageEdit] = useState<PreparedImageEdit | null>(null);
  const { refresh: refreshImageCredits } = useCredits();
  const imgUploadInputRef = useRef<HTMLInputElement>(null);

  // 上传文件的 ref
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const firstFrameInputRef = useRef<HTMLInputElement>(null);
  const lastFrameInputRef = useRef<HTMLInputElement>(null);

  const updateResolution = (res: string, ratio: string, dur: number) => {
    setActiveResolution(res);
    setActiveRatio(ratio);
    setActiveDuration(dur);
    setResolution(`${res} · ${ratio} · ${dur}s`);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; void importReference(file, 'image', setRefImage); };
  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; void importReference(file, 'video', setRefVideo); };
  const handleFirstFrameUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; void importReference(file, 'image', setFirstFrame); };
  const handleLastFrameUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; void importReference(file, 'image', setLastFrame); };

  // 生成任务在服务端持久化，浏览器只显示状态和成片。
  const { generating, taskId, genProgress, resultVideo, statusText, generate, hideProgress, clearResult } = useVideoGeneration(user?.id);

  // 图片生成状态
  const [imgPrompt, setImgPrompt] = useState('');
  const imgModel = { label: modelCatalog.find(item => item.slot === 'image.primary')?.name || '图片模型', id: 'image.primary' };
  const [imgResolution, setImgResolution] = useState('1024x1024 · 低');
  const [imgModelOpen, setImgModelOpen] = useState(false);
  const [imgResOpen, setImgResOpen] = useState(false);

  // 图片生成高级配置状态
  const [imgResolutionType, setImgResolutionType] = useState('1024x1024');
  const [imgQuality, setImgQuality] = useState('低');
  const [imgAspect, setImgAspect] = useState('1:1');

  const updateImgResolution = (resType: string, qual: string, aspect: string) => {
    setImgResolutionType(resType);
    setImgQuality(qual);
    setImgAspect(aspect);
    setImgResolution(`${resType} · ${qual}`);
  };

  const [activePlayVideo, setActivePlayVideo] = useState<any>(null);

  const promptAssistant = usePromptAssistant(user?.id, {
    video: prompt, image: imgPrompt, updateVideo: value => { setPrompt(value); triggerVideoTypingGlow(); },
    updateImage: value => { setImgPrompt(value); triggerImgTypingGlow(); },
  });
  const recording = promptAssistant.recordingKind === 'video', imgRecording = promptAssistant.recordingKind === 'image';
  const enhancing = promptAssistant.enhancingKind === 'video', enhancingImg = promptAssistant.enhancingKind === 'image';
  const enhanceProgress = enhancing ? promptAssistant.progress : 0, imgEnhanceProgress = enhancingImg ? promptAssistant.progress : 0;
  const enhanceError = promptAssistant.error;
  const handleVoiceInput = () => promptAssistant.toggleVoice('video');
  const handleImgVoiceInput = () => promptAssistant.toggleVoice('image');

  const handleImgRefImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; void importReference(file, 'image', setImgRefImage);
  };
  const imageTask = useProductionJob('image', user?.id);
  const imgGenerating = imageTask.generating;
  const imgProgress = imageTask.job?.progress || 0;
  const [resultImage, setResultImage] = useState<string | null>(null);
  useEffect(() => {
    if (imageTask.job?.status === 'completed' && imageTask.job.result?.url) setResultImage(imageTask.job.result.url);
  }, [imageTask.job?.id, imageTask.job?.status, imageTask.job?.result?.url]);

  const handleImageGenerate = async () => {
    if (!imgPrompt.trim()) { toast.error('请输入图片描述'); return; }
    if (!modelCatalog.some(item => item.slot === 'image.primary' && item.enabled)) { toast.error(modelCatalogError || '请先在模型设置中启用图片接口'); return; }
    const masked = imgMode === 'inpaint' || imgMode === 'outpaint';
    if (masked && (!preparedImageEdit || imageCost === null || !imgConfig?.image_capabilities?.mask || !imgConfig.version_id)) {
      toast.error('请先准备编辑素材并确认价格与模型'); return;
    }
    const balance = await refreshImageCredits();
    if (!workspaceActive.current) return;
    if (balance.error || !balance.data) { toast.error('积分读取失败，请重试'); return; }
    if (imageCost !== null && balance.data.left < imageCost) { toast.error('积分不足'); return; }
    const started = await imageTask.start({ prompt: imgPrompt, size: imgResolutionType,
      quality: imgQuality === '低' ? 'low' : imgQuality === '高' ? 'high' : 'medium',
      ...(masked ? { mode: imgMode, ...preparedImageEdit, confirmed_model_version: imgConfig?.version_id,
        confirmed_credit_cost: imageCost } : { reference_image: imgRefImage }) });
    if (started && workspaceActive.current) setResultImage(null);
  };
  const imgConfig = modelCatalog.find(item => item.slot === 'image.primary');
  const refreshImageSettings = async () => {
    try {
      await workspaceModels.refresh();
    } catch (cause) { if (workspaceActive.current) toast.error(cause instanceof Error ? cause.message : '图片配置读取失败'); }
  };

  // 视频生成统一使用持久化服务端任务。
  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error('请输入视频描述'); return; }
    if (!modelCatalog.some(item => item.provider === model.id && item.enabled)) { toast.error(modelCatalogError || '请先在模型设置中启用视频接口'); return; }
    const finalPrompt = autoOptimize
      ? prompt.trim() + '\n【自动扩展】优化构图与运镜节奏，强化光影质感与商品细节表现，突出前3秒吸引力与下单引导，保持主体一致。'
      : prompt.trim();
    await generate(model.id, {
      prompt: finalPrompt, title: makeWorkTitle(prompt),
      duration: Number(activeDuration) || 5, resolution: activeResolution, ratio: activeRatio,
      first_frame: firstFrame || undefined, last_frame: lastFrame || undefined,
      reference_images: refImage ? [refImage] : [], reference_videos: refVideo ? [refVideo] : [],
    });
  };

  const handleEnhancePrompt = () => promptAssistant.enhance('video');
  const handleEnhanceImgPrompt = () => promptAssistant.enhance('image');

  return (
    <div
      className="min-h-screen w-full text-white overflow-x-hidden"
      style={{ background: 'linear-gradient(160deg,#0e0e12 0%,#14111a 40%,#0c0e14 100%)' }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes textWaveRipple {
          0% { text-shadow: 0 0 0px rgba(236, 72, 153, 0); color: rgba(255, 255, 255, 0.8); }
          50% { text-shadow: 0 0 10px rgba(236, 72, 153, 0.8), 0 0 20px rgba(168, 85, 247, 0.5); color: #f472b6; }
          100% { text-shadow: 0 0 0px rgba(236, 72, 153, 0); color: rgba(255, 255, 255, 0.8); }
        }
        .enhancing-text-wave { animation: textWaveRipple 1.6s ease-in-out infinite; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
      {/* 移动端收紧外边距与区块间距，保证紧凑屏幕下排版合理 */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-8 py-5 md:py-10 space-y-6 md:space-y-10">

        {/* ── 大标题 ────────────────────────────────────────────────── */}
        <div className="text-center space-y-3.5 md:space-y-5">
          <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-balance leading-tight">
            生成、编辑或复刻电商带货视频
          </h1>
          {/* 主 Tab */}
          <div className="inline-flex items-center gap-1 p-1 rounded-full border border-white/10 bg-white/5 backdrop-blur">
            {MAIN_TABS.map(t => (
              <button key={t} aria-pressed={mainTab === t} onClick={() => setMainTab(t)}
                className={cn('px-3 sm:px-5 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-200',
                  mainTab === t ? 'bg-white text-black shadow' : 'text-white/60 hover:text-white/90')}
              >{t}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-white/70">
          <label className="flex gap-2 items-center"><input type="checkbox" checked={referenceRights} disabled={referenceBusy}
            onChange={event => setReferenceRights(event.target.checked)} />我拥有参考素材的使用权</label>
          {referenceBusy && <span role="status">正在核对素材登记…</span>}
          {pendingReferences > 0 && <button disabled={referenceBusy} onClick={() => void recoverReferences()} className="text-orange-300 underline">恢复原参考素材上传（{pendingReferences}）</button>}
        </div>
        {enhanceError && <p role="alert" className="rounded-lg border border-rose-500/30 p-3 text-sm text-rose-300">{enhanceError} · 原输入已保留</p>}

        {/* ── 视频生成输入区 ───────────────────────────────────────────────── */}
        {mainTab === '视频生成' && (
          <div className={cn(
            "relative rounded-2xl p-[1.5px] group/input transition-all duration-300",
            (modelOpen || resOpen) ? "z-40" : "z-20",
            // 默认情况下的其它边框色：低调高级的微透科技边框；输入文字时增强光晕（紫粉主题）
            isTypingVideo
              ? "bg-[#8b5cf6]/40 shadow-[0_0_35px_rgba(139,92,246,0.28)]"
              : "bg-gradient-to-b from-white/15 via-white/[0.08] to-white/5 hover:from-white/20 hover:to-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)]"
          )}>
            {/* 点击空白处自动关闭弹窗的透明遮罩 */}
            {(modelOpen || resOpen) && (
              <div
                className="fixed inset-0 z-[5] bg-transparent"
                onClick={() => {
                  setModelOpen(false);
                  setResOpen(false);
                }}
              />
            )}
            {/* 环绕流光光效容器：仅在输入文字的那一刻激活显示并环绕 */}
            <div className={cn(
              "absolute inset-0 rounded-2xl overflow-hidden pointer-events-none transition-opacity duration-500",
              isTypingVideo ? "opacity-100" : "opacity-0"
            )}>
              {/* 底层柔光光晕 (Ambient Glow) */}
              <div
                className="workspace-input-stream-glow"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, transparent 220deg, rgba(139,92,246,0.3) 270deg, #8b5cf6 315deg, #ec4899 350deg, #ffffff 360deg)',
                }}
              />

              {/* 前景清晰单道顺时针跑马流光 (Sharp Laser Stream) */}
              <div
                className="workspace-input-stream-single"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, transparent 220deg, rgba(139,92,246,0.4) 270deg, #8b5cf6 315deg, #ec4899 350deg, #ffffff 360deg)',
                }}
              />
            </div>

            <div className="relative z-10 rounded-[14.5px] bg-[#16151f] border border-white/5 transition-all duration-300">
              {/* 顶部 Tab + 展开按钮（移动端缩小字号与内边距） */}
              <div className="flex items-center justify-between px-2.5 md:px-4 pt-2.5 md:pt-3 pb-1">
                <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
                  {INPUT_TABS.map(t => (
                    <button key={t} onClick={() => {
                      setInputTab(t);
                      if (t === '商品') {
                        setIsProductModalOpen(true);
                        loadProductsForSelector();
                      }
                    }}
                      className={cn('flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs md:text-sm transition-colors whitespace-nowrap shrink-0',
                        inputTab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70')}
                    >
                      {t === '参考' && <ImageIcon className="w-3.5 h-3.5" />}
                      {t === '商品' && <Package className="w-3.5 h-3.5 text-violet-400" />}
                      {t === '首尾帧' && <Copy className="w-3.5 h-3.5" />}
                      {t === '数字人' && <Users2 className="w-3.5 h-3.5 text-primary" />}
                      {t === '编辑' && <Wand2 className="w-3.5 h-3.5" />}
                      {t}
                    </button>
                  ))}
                </div>
                <button className="text-white/30 hover:text-white/70 transition-colors shrink-0 ml-2">
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>

              {/* 隐藏的文件输入框 */}
              <input
                type="file"
                ref={imageInputRef}
                aria-label="上传视频参考图片"
                disabled={!referenceRights || referenceBusy}
                onChange={handleImageUpload}
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={videoInputRef}
                aria-label="上传视频参考视频"
                disabled={!referenceRights || referenceBusy}
                onChange={handleVideoUpload}
                accept="video/*"
                className="hidden"
              />
              <input
                type="file"
                ref={firstFrameInputRef}
                aria-label="上传首帧图片"
                disabled={!referenceRights || referenceBusy}
                onChange={handleFirstFrameUpload}
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={lastFrameInputRef}
                aria-label="上传尾帧图片"
                disabled={!referenceRights || referenceBusy}
                onChange={handleLastFrameUpload}
                accept="image/*"
                className="hidden"
              />

              {/* AI 提示词增强动态打字机进度条 */}
              {enhancing && (
                <div className="px-4 py-2 border-b border-rose-500/20 bg-gradient-to-r from-rose-950/40 via-purple-950/30 to-amber-950/20 rounded-t-xl transition-all duration-300 space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-semibold text-rose-300">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-rose-400 animate-spin" />
                      AI 正在深度智能扩展视频画面视角与光影细节...
                    </span>
                    <span className="text-[11px] font-mono text-rose-400 font-bold">已接收 {enhanceProgress} 字符</span>
                  </div>
                  <div className="w-full bg-zinc-900/80 rounded-full h-1.5 overflow-hidden border border-rose-500/30">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 via-pink-500 to-amber-400 rounded-full transition-all duration-150 shadow-[0_0_12px_rgba(244,63,94,0.6)]"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}

              {/* 文本输入 */}
              <div className="px-3 md:px-4 pb-2 pt-2 flex flex-col gap-2">
                <div className="flex items-start gap-2 md:gap-3">
                  <div className="flex gap-1.5 pt-1 shrink-0 items-center">
                    {inputTab === '首尾帧' ? (
                      <div className="flex items-center gap-1 shrink-0 mr-1 select-none">
                        {/* 首帧 */}
                        <div
                          onClick={() => firstFrameInputRef.current?.click()}
                          className={cn(
                            "w-11 h-[72px] rounded-lg border border-dashed border-white/20 hover:border-white/40 bg-white/4 flex flex-col items-center justify-center transition-all duration-200 relative overflow-hidden transform rotate-[-6deg] cursor-pointer",
                            firstFrame && "border-solid border-emerald-500/50"
                          )}
                        >
                          {firstFrame ? (
                            <>
                              <img src={firstFrame} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setFirstFrame(null); }}
                                className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-black/70 hover:bg-black flex items-center justify-center text-white"
                              >
                                <X className="w-2 h-2" />
                              </button>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5 text-white/40 mb-0.5" />
                              <span className="text-[9px] text-white/40 font-medium leading-none">首帧</span>
                            </>
                          )}
                        </div>

                        {/* 双向箭头 */}
                        <span className="text-white/20 text-[9px] font-bold mx-0.5">↔</span>

                        {/* 尾帧 */}
                        <div
                          onClick={() => lastFrameInputRef.current?.click()}
                          className={cn(
                            "w-11 h-[72px] rounded-lg border border-dashed border-white/20 hover:border-white/40 bg-white/4 flex flex-col items-center justify-center transition-all duration-200 relative overflow-hidden transform rotate-[6deg] cursor-pointer",
                            lastFrame && "border-solid border-emerald-500/50"
                          )}
                        >
                          {lastFrame ? (
                            <>
                              <img src={lastFrame} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setLastFrame(null); }}
                                className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-black/70 hover:bg-black flex items-center justify-center text-white"
                              >
                                <X className="w-2 h-2" />
                              </button>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5 text-white/40 mb-0.5" />
                              <span className="text-[9px] text-white/40 font-medium leading-none">尾帧</span>
                            </>
                          )}
                        </div>
                      </div>
                    ) : inputTab === '商品' ? (
                      <div className="flex items-center gap-1.5 shrink-0 mr-1 select-none">
                        {selectedProduct ? (
                          <div className="flex items-center gap-2 bg-violet-950/60 border border-violet-500/40 rounded-xl px-2.5 py-1.5 text-xs text-white relative shadow-md">
                            <ProductImage src={selectedProduct.cover_image} name={selectedProduct.name}
                              className="w-10 h-10 rounded-lg border border-violet-400/40 shrink-0" />
                            <div className="flex flex-col min-w-0 max-w-[160px]">
                              <span className="font-bold text-white text-xs truncate" title={selectedProduct.name}>
                                {selectedProduct.name}
                              </span>
                              <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
                                <span className="bg-violet-500/20 text-violet-300 px-1 rounded">{selectedProduct.category}</span>
                                {(selectedProduct.sale_price ?? selectedProduct.original_price) != null && (
                                  <span className="font-bold text-rose-400">{productPrice(selectedProduct)}</span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setIsProductModalOpen(true);
                                loadProductsForSelector();
                              }}
                              className="text-[10px] text-violet-300 underline hover:text-white ml-1 font-medium"
                            >
                              更换
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedProduct(null)}
                              className="w-4 h-4 rounded-full bg-black/60 hover:bg-black flex items-center justify-center text-white ml-1"
                              title="清除商品"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setIsProductModalOpen(true);
                              loadProductsForSelector();
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600/20 border border-violet-500/30 hover:border-violet-400/60 hover:bg-violet-600/30 transition-all text-xs font-semibold text-violet-200 shadow-sm group"
                          >
                            <ShoppingBag className="w-4 h-4 text-violet-400 group-hover:scale-110 transition-transform" />
                            <span>选择商品管理中的商品</span>
                            <ChevronRight className="w-3.5 h-3.5 text-violet-400/70" />
                          </button>
                        )}
                      </div>
                    ) : inputTab === '数字人' ? (
                      <div className="flex flex-col gap-1.5 shrink-0 mr-1 select-none">
                        <button type="button" onClick={() => navigate('/avatars#media-jobs')}
                          className="px-3 py-2 rounded-lg border border-primary/50 text-primary hover:bg-primary/10 text-xs flex items-center gap-2">
                          <Users2 className="w-4 h-4" />打开数字人工作台
                        </button>
                        <p className="text-xs text-white/60 max-w-xs">上传人物照片或视频与口播音频，创建照片口播或口型同步任务。</p>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="w-8 h-8 rounded-lg bg-white/6 hover:bg-white/10 flex items-center justify-center transition-colors"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-white/60" />
                        </button>
                        <button
                          type="button"
                          onClick={() => videoInputRef.current?.click()}
                          className="w-8 h-8 rounded-lg bg-white/6 hover:bg-white/10 flex items-center justify-center transition-colors"
                        >
                          <Video className="w-3.5 h-3.5 text-white/60" />
                        </button>
                      </>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={prompt}
                    onChange={e => {
                      setPrompt(e.target.value);
                      triggerVideoTypingGlow();
                    }}
                    onKeyDown={() => triggerVideoTypingGlow()}
                    onCompositionUpdate={() => triggerVideoTypingGlow()}
                    placeholder="描述视频画面内容和动态过程，使用 @ 指定参考图或参考视频"
                    className={cn(
                      "flex-1 min-w-0 bg-transparent resize-none text-sm text-white/80 placeholder:text-white/25 outline-none min-h-[56px] sm:min-h-[72px] leading-relaxed transition-all duration-300",
                      enhancing && "enhancing-text-wave"
                    )}
                    disabled={generating || enhancing}
                  />
                </div>

                {/* 上传的参考图片或视频预览 */}
                {(refImage || refVideo) && (
                  <div className="flex gap-3 px-12 pb-2">
                    {refImage && (
                      <div className="relative w-16 h-16 rounded-xl border border-white/10 overflow-hidden group">
                        <img src={refImage} alt="Ref Image" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setRefImage(null)}
                          className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                    {refVideo && (
                      <div className="relative w-16 h-16 rounded-xl border border-white/10 overflow-hidden group bg-black/40 flex items-center justify-center">
                        <Video className="w-6 h-6 text-white/40" />
                        <button
                          type="button"
                          onClick={() => setRefVideo(null)}
                          className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 萌系高颜值可爱进度条与离页无忧提示 */}
              {generating && (
                <div className="px-3 md:px-4 pb-3 pt-1 animate-in fade-in zoom-in-95 duration-300">
                  <div className="p-3.5 md:p-4 rounded-2xl bg-gradient-to-br from-[#1d1633]/90 via-[#1c192e]/90 to-[#12162a]/95 border border-pink-500/25 shadow-[0_8px_32px_rgba(236,72,153,0.15)] relative overflow-hidden backdrop-blur-xl">
                    {/* 背景柔和光晕装饰 */}
                    <div className="absolute -top-12 -right-12 w-36 h-36 bg-pink-500/15 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

                    {/* 头部：可爱吉祥物 + 阶段描述 + 百分比徽章 */}
                    <div className="flex items-center justify-between mb-2.5 relative z-10">
                      <div className="flex items-center gap-2.5">
                        {/* 萌系动态吉祥物表情 */}
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-lg animate-bounce-gentle shadow-[0_0_12px_rgba(236,72,153,0.25)] shrink-0">
                          {genProgress < 25 ? '🌱' : genProgress < 55 ? '🎨' : genProgress < 85 ? '🎬' : genProgress < 100 ? '✨' : '🎉'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs md:text-sm font-bold bg-gradient-to-r from-pink-300 via-purple-200 to-cyan-300 bg-clip-text text-transparent">
                              {statusText}
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-pink-500/15 text-pink-300 border border-pink-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 mr-1 animate-pulse" />
                              处理中
                            </span>
                          </div>
                          <p className="text-[11px] text-white/45 mt-0.5">
                            任务进度由生成服务返回
                          </p>
                        </div>
                      </div>

                      {/* 萌系果冻百分比药丸 */}
                      <div className="flex flex-col items-end shrink-0">
                        <div className="px-2.5 py-1 rounded-full bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-indigo-500/20 border border-pink-400/30 text-xs font-black tracking-wider text-pink-300 font-mono shadow-[0_0_10px_rgba(236,72,153,0.2)]">
                          {genProgress}%
                        </div>
                        {taskId && <span className="text-[10px] text-white/25 font-mono mt-1">#{taskId.slice(0, 6)}</span>}
                      </div>
                    </div>

                    {/* 可爱糖果动态进度条 */}
                    <div className="relative w-full h-3 rounded-full bg-white/[0.06] border border-white/10 p-[1.5px] overflow-hidden shadow-inner mb-2.5">
                      {/* 进度主体 */}
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 via-pink-500 via-amber-400 to-emerald-400 transition-all duration-700 relative overflow-hidden shadow-[0_0_16px_rgba(236,72,153,0.5)]"
                        style={{ width: `${Math.max(6, genProgress)}%` }}
                      >
                        {/* 流动糖果斜纹 */}
                        <div className="absolute inset-0 candy-stripe-pattern animate-progress-stripes opacity-40" />
                        {/* 高光波纹扫过 */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer-wave" />
                        {/* 进度前沿发光小圆点 */}
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_8px_#ffffff,0_0_14px_#ec4899]" />
                      </div>
                    </div>

                    {/* 底部暖心提示与离页保障小胶囊 */}
                    <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-pink-200/80">
                      <div className="flex items-center gap-1.5">
                        <span className="text-pink-400">💖</span>
                        <span>任务已保存，刷新后可恢复；成功后保存至作品库，确定失败自动退积分</span>
                      </div>
                      <span className="hidden sm:inline-block text-[10px] text-white/35 bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                        无需等待守候
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 底部工具栏（移动端缩小胶囊尺寸，保证单行不拥挤） */}
              <div className="flex items-center justify-between px-2.5 md:px-4 pb-2.5 md:pb-3 pt-2 border-t border-white/5 gap-1.5 md:gap-2 w-full">
                <div className="flex items-center gap-1 md:gap-1.5 py-0.5 md:pr-2 min-w-0">
                  {/* 模型选择 */}
                  <div className="relative">
                    <button onClick={() => { setModelOpen(o => !o); setResOpen(false); }}
                      className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 text-[11px] md:text-xs text-emerald-400 transition-colors border border-emerald-500/20">
                      {(() => {
                        const currentModelObj = MODELS.find(m => m.id === model.id);
                        return <span className="text-sm leading-none">{currentModelObj?.iconSymbol || '⚡'}</span>;
                      })()}
                      <span className="hidden sm:inline font-semibold">{model.label}</span>
                      <span className="sm:hidden">模型</span>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                    {modelOpen && (
                      <div className="absolute top-full mt-2 left-0 z-50 bg-[#161522] border border-white/15 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] py-1.5 min-w-[170px] backdrop-blur-2xl">
                        {MODELS.filter(m => modelCatalog.some(item => item.provider === m.id && item.enabled))
                          .map(m => ({ ...m, label: modelCatalog.find(item => item.provider === m.id && item.enabled)!.name })).map(m => (
                          <button key={m.id} onClick={() => {
                            setModel({ label: m.label, id: m.id });
                            setModelOpen(false);
                          }}
                            className={cn('w-full text-left px-3.5 py-2 text-xs flex items-center justify-between gap-2 hover:bg-white/10 transition-colors', m.id === model.id ? 'text-emerald-400 bg-emerald-500/10 font-semibold' : 'text-white/80')}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm leading-none shrink-0">{m.iconSymbol}</span>
                              <span className="font-semibold">{m.label}</span>
                            </div>
                          </button>
                        ))}
                        {!modelCatalog.some(item => item.category === 'video' && item.enabled) && <p className="px-3 py-2 text-xs text-white/60">{modelCatalogError || '尚无已启用视频模型'}</p>}
                        <button onClick={() => navigate('/settings/models')}
                          className="w-full text-left px-3.5 py-2 mt-1 pt-2 border-t border-white/10 text-xs flex items-center gap-2 text-white/55 hover:bg-white/10 hover:text-white/90 transition-colors">
                          <Plus className="w-3 h-3" />模型接口设置
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 分辨率与高级参数弹窗 */}
                  <div className="relative">
                    <button onClick={() => { setResOpen(o => !o); setModelOpen(false); }}
                      className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/15 text-[11px] md:text-xs text-blue-400 transition-colors border border-blue-500/20">
                      <BarChart2 className="w-3 h-3" />
                      <span className="hidden sm:inline">{resolution}</span>
                      <span className="sm:hidden">尺寸</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {/* 移动端：下拉面板预留右侧空间避免超出视口被裁切；桌面端由 max-w 封顶不变 */}
                    {resOpen && (
                      <div className="absolute top-full mt-2 left-0 z-50 bg-[#161522] border border-white/15 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-3 md:p-4 w-[calc(100vw-7rem)] max-w-[320px] space-y-3 md:space-y-4 text-white backdrop-blur-2xl">
                        {/* 分辨率 */}
                        <div className="space-y-2">
                          <label className="text-[11px] text-white/40 block font-medium">分辨率</label>
                          <div className="grid grid-cols-2 gap-2">
                            {['720P', '1080P'].map(r => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => updateResolution(r, activeRatio, activeDuration)}
                                className={cn(
                                  "py-2 rounded-xl text-xs font-semibold transition-all duration-200",
                                  activeResolution === r
                                    ? "bg-white/15 text-white border border-white/20"
                                    : "bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white"
                                )}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 宽高比 */}
                        <div className="space-y-2">
                          <label className="text-[11px] text-white/40 block font-medium">宽高比</label>
                          <div className="grid grid-cols-5 gap-2">
                            {[
                              // 图形宽高必须与比例数值一致（Tailwind 默认刻度无 4.5，用任意值避免图形反向）
                              { label: '9:16', style: 'w-[10px] h-[18px]' },
                              { label: '16:9', style: 'w-[18px] h-[10px]' },
                              { label: '1:1', style: 'w-[14px] h-[14px]' },
                              { label: '3:4', style: 'w-[12px] h-[16px]' },
                              { label: '4:3', style: 'w-[16px] h-[12px]' },
                            ].map(item => (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() => updateResolution(activeResolution, item.label, activeDuration)}
                                className={cn(
                                  "flex flex-col items-center justify-center p-2 rounded-xl border transition-all duration-200 h-16",
                                  activeRatio === item.label
                                    ? "bg-white/15 text-white border-white/20"
                                    : "bg-white/5 text-white/40 border-transparent hover:bg-white/10 hover:text-white/70"
                                )}
                              >
                                <div className={cn("border-2 border-current rounded-sm mb-1.5 shrink-0", item.style)} />
                                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 时长 */}
                        <div className="space-y-2">
                          <label className="text-[11px] text-white/40 block font-medium">时长</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min={2}
                              max={15}
                              value={activeDuration}
                              onChange={(e) => updateResolution(activeResolution, activeRatio, parseInt(e.target.value))}
                              className="flex-1 accent-white bg-white/10 h-1 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex items-center gap-1 bg-white/5 border border-white/8 rounded-lg px-2.5 py-1 text-xs shrink-0 min-w-[50px] justify-center">
                              <span className="font-semibold">{activeDuration}</span>
                              <span className="text-white/40">s</span>
                            </div>
                          </div>
                        </div>

                        {/* 扩展 */}
                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                          <span className="text-xs text-white/70 font-medium">扩展 (自动优化提示词)</span>
                          <button
                            type="button"
                            onClick={() => setAutoOptimize(!autoOptimize)}
                            className={cn(
                              "w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none",
                              autoOptimize ? "bg-emerald-500" : "bg-white/10"
                            )}
                          >
                            <div
                              className={cn(
                                "w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-200",
                                autoOptimize ? "translate-x-4" : "translate-x-0"
                              )}
                            />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <button aria-label="提示词增强" onClick={handleEnhancePrompt} disabled={enhancing || enhancingImg || generating}
                    className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-pink-500/10 hover:bg-pink-500/15 text-[11px] md:text-xs text-pink-400 transition-colors border border-pink-500/20 disabled:opacity-40 shrink-0">
                    {enhancing ? <Loader2 className="w-3 h-3 animate-spin text-pink-400" /> : <Sparkles className="w-3 h-3 text-pink-400" />}
                    <span className="hidden sm:inline">提示词增强</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0 ml-auto">
                  <span className="text-xs text-white/25 hidden sm:block">{prompt.length}/8000</span>
                  {generating ? (
                    <button onClick={hideProgress}
                      className="flex items-center justify-center gap-1.5 w-8 h-8 md:w-9 md:h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl text-sm font-semibold transition-all shrink-0"
                      style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}>
                      <X className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">收起</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleVoiceInput}
                        aria-label={recording ? '停止视频语音输入' : '开始视频语音输入'}
                        aria-pressed={recording}
                        className={cn(
                          "w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center transition-all border shrink-0",
                          recording
                            ? "animate-pulse border-red-500/50 text-red-500 bg-red-500/10"
                            : "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300"
                        )}
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                      <button onClick={handleGenerate}
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 md:px-4 md:py-2 rounded-xl text-[11px] sm:text-sm font-semibold transition-all duration-200 hover:scale-105 active:scale-95 shrink-0"
                        style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', boxShadow: '0 0 20px rgba(34,197,94,0.35)' }}>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span className="sm:hidden">生成</span>
                        <span className="hidden sm:inline">AI视频生成</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 图片生成输入区 ────────────────────────────────────────────── */}
        {mainTab === '图片生成' && (
          <div className={cn(
            "relative rounded-2xl p-[1.5px] group/input transition-all duration-300",
            (imgModelOpen || imgResOpen) ? "z-40" : "z-20",
            // 默认情况下的其它边框色：低调高级的微透科技边框；输入文字时增强光晕（橙绿主题）
            isTypingImg
              ? "bg-[#FF6B00]/40 shadow-[0_0_35px_rgba(255,107,0,0.28)]"
              : "bg-gradient-to-b from-white/15 via-white/[0.08] to-white/5 hover:from-white/20 hover:to-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)]"
          )}>
            {/* 点击空白处自动关闭弹窗的透明遮罩 */}
            {(imgModelOpen || imgResOpen) && (
              <div
                className="fixed inset-0 z-[5] bg-transparent"
                onClick={() => {
                  setImgModelOpen(false);
                  setImgResOpen(false);
                }}
              />
            )}
            {/* 环绕流光光效容器：仅在输入文字的那一刻激活显示并环绕 */}
            <div className={cn(
              "absolute inset-0 rounded-2xl overflow-hidden pointer-events-none transition-opacity duration-500",
              isTypingImg ? "opacity-100" : "opacity-0"
            )}>
              {/* 底层柔光光晕 (Ambient Glow) */}
              <div
                className="workspace-input-stream-glow"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, transparent 220deg, rgba(255,107,0,0.3) 270deg, #FF6B00 315deg, #00E599 350deg, #ffffff 360deg)',
                }}
              />

              {/* 前景清晰单道顺时针跑马流光 (Sharp Laser Stream) */}
              <div
                className="workspace-input-stream-single"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, transparent 220deg, rgba(255,107,0,0.4) 270deg, #FF6B00 315deg, #00E599 350deg, #ffffff 360deg)',
                }}
              />
            </div>

            <div className="relative z-10 rounded-[14.5px] bg-[#16151f] border border-white/5 transition-all duration-300">
              {/* 顶部 Tab（移动端缩小字号与内边距） */}
              <div className="flex items-center justify-between px-2.5 md:px-4 pt-2.5 md:pt-3 pb-1">
                <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
                  {([{ id: 'generate', label: '智能绘图' }, { id: 'outpaint', label: '扩图' }, { id: 'inpaint', label: '局部重绘' }] as const).map(item =>
                    <button key={item.id} type="button" aria-pressed={imgMode === item.id}
                      disabled={imgGenerating || referenceBusy || item.id !== 'generate' && !imgConfig?.image_capabilities?.mask}
                      onClick={() => { setImgMode(item.id); setPreparedImageEdit(null); setImgRefImage(null); }}
                      className={cn('px-3 py-2 rounded-lg text-sm whitespace-nowrap disabled:opacity-40',
                        imgMode === item.id ? 'bg-white/10 text-white' : 'text-white/60')}>{item.label}</button>)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 px-4 py-2 text-xs text-white/60">
                {!imgConfig?.image_capabilities?.mask && <p>扩图与局部重绘需配置支持编辑的GPT Image模型。</p>}
                <button type="button" disabled={imgGenerating || imageSettingsBusy} onClick={() => void refreshImageSettings()} className="underline disabled:opacity-40">
                  {imageSettingsBusy ? '正在读取图片配置…' : '刷新图片配置与价格'}
                </button>
              </div>
              {(imgMode === 'inpaint' || imgMode === 'outpaint') && user && <>
                <ImageEditCanvas mode={imgMode} size={imgResolutionType} userId={user.id} rights={referenceRights}
                  disabled={imgGenerating || referenceBusy} onPrepared={setPreparedImageEdit} />
                <p className="px-4 pb-2 text-xs text-white/60">每次编辑：{imageCost === null ? '价格读取中，请刷新页面重试' : `${imageCost} 积分`} · {imgModel.label}。提交时按已确认价格创建任务。</p>
              </>}

              {/* 隐藏的图片生成参考图输入 */}
              <input
                type="file"
                ref={imgUploadInputRef}
                aria-label="上传绘图参考图片"
                disabled={!referenceRights || referenceBusy || !imgConfig?.image_capabilities?.reference}
                onChange={handleImgRefImageUpload}
                accept="image/*"
                className="hidden"
              />

              {/* 文本输入 */}
              <div className="px-3 md:px-4 pb-2 flex items-start gap-2 md:gap-3">
                <div className="flex gap-1.5 pt-1 shrink-0">
                  <button
                    type="button"
                    aria-label="选择绘图参考图"
                    disabled={imgMode !== 'generate' || !imgConfig?.image_capabilities?.reference || imgGenerating}
                    onClick={() => imgUploadInputRef.current?.click()}
                    className="w-8 h-8 rounded-lg bg-white/6 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-white/60" />
                  </button>
                </div>
                <textarea
                  rows={2}
                  aria-label="图片描述"
                  maxLength={8000}
                  value={imgPrompt}
                  onChange={e => {
                    setImgPrompt(e.target.value);
                    triggerImgTypingGlow();
                  }}
                  onKeyDown={() => triggerImgTypingGlow()}
                  onCompositionUpdate={() => triggerImgTypingGlow()}
                  placeholder="描述商品图片的主体、背景与构图。参考图需平台图片模型支持。"
                  className={cn(
                    "flex-1 min-w-0 bg-transparent resize-none text-sm text-white/80 placeholder:text-white/25 outline-none min-h-[56px] sm:min-h-[72px] leading-relaxed transition-all duration-300",
                    enhancingImg && "enhancing-text-wave"
                  )}
                  disabled={imgGenerating || enhancingImg}
                />
              </div>

              {/* 图片提示词增强进度条动效 */}
              {(enhancingImg || imgEnhanceProgress > 0) && (
                <div className="px-4 pb-2.5 animate-in fade-in duration-300">
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden relative border border-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-rose-500 transition-all duration-300 rounded-full"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-pink-400 mt-1 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 animate-spin text-pink-400" />
                      AI 多模态画质与画面提示词智能增强中...
                    </span>
                    <span className="font-mono font-bold text-pink-300">已接收 {imgEnhanceProgress} 字符</span>
                  </div>
                </div>
              )}

              {(imageTask.error || imageTask.job?.error_message) && <p role="alert" className="px-4 py-2 text-sm text-rose-300">{imageTask.error || imageTask.job?.error_message}</p>}
              {/* 上传的参考图预览 */}
              {imgRefImage && (
                <div className="flex gap-3 px-12 pb-2">
                  <div className="relative w-16 h-16 rounded-xl border border-white/10 overflow-hidden group">
                    <img src={imgRefImage} alt="Ref Image" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImgRefImage(null)}
                      className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* 萌系高颜值图片生成进度条 */}
              {imgGenerating && (
                <div className="px-3 md:px-4 pb-3 pt-1 animate-in fade-in zoom-in-95 duration-300">
                  <div className="p-3.5 md:p-4 rounded-2xl bg-gradient-to-br from-[#26172e]/90 via-[#20152b]/90 to-[#181428]/95 border border-pink-500/25 shadow-[0_8px_32px_rgba(236,72,153,0.15)] relative overflow-hidden backdrop-blur-xl">
                    {/* 背景柔和光晕装饰 */}
                    <div className="absolute -top-12 -right-12 w-36 h-36 bg-pink-500/15 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

                    <div className="flex items-center justify-between mb-2.5 relative z-10">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-lg animate-bounce-gentle shadow-[0_0_12px_rgba(236,72,153,0.25)] shrink-0">
                          {imgProgress < 30 ? '🖌️' : imgProgress < 75 ? '🎨' : '✨'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs md:text-sm font-bold bg-gradient-to-r from-pink-300 via-purple-200 to-amber-200 bg-clip-text text-transparent">
                              正在生成并保存图片…
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-pink-500/15 text-pink-300 border border-pink-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 mr-1 animate-pulse" />
                              绘制中
                            </span>
                          </div>
                          <p className="text-[11px] text-white/45 mt-0.5">
                            当前模型：{imgModel.label} · 规格：{imgResolution}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <div className="px-2.5 py-1 rounded-full bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-indigo-500/20 border border-pink-400/30 text-xs font-black tracking-wider text-pink-300 font-mono shadow-[0_0_10px_rgba(236,72,153,0.2)]">
                          处理中
                        </div>
                      </div>
                    </div>

                    {/* 可爱糖果动态进度条 */}
                    <div className="relative w-full h-3 rounded-full bg-white/[0.06] border border-white/10 p-[1.5px] overflow-hidden shadow-inner mb-2.5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-pink-500 via-purple-500 via-amber-400 to-emerald-400 transition-all duration-700 relative overflow-hidden shadow-[0_0_16px_rgba(236,72,153,0.5)]"
                        style={{ width: `${Math.max(6, imgProgress)}%` }}
                      >
                        <div className="absolute inset-0 candy-stripe-pattern animate-progress-stripes opacity-40" />
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer-wave" />
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_8px_#ffffff,0_0_14px_#ec4899]" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-pink-200/80">
                      <div className="flex items-center gap-1.5">
                        <span className="text-pink-400">💖</span>
                        <span>后台任务已保存，完成后自动归档至您的「素材库」</span>
                      </div>
                      <span className="hidden sm:inline-block text-[10px] text-white/35 bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                        关闭页面后继续处理
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 底部工具栏（移动端缩小胶囊尺寸） */}
              <div className="flex items-center justify-between px-2.5 md:px-4 pb-2.5 md:pb-3 pt-2 border-t border-white/5 gap-1.5 md:gap-2 w-full">
                <div className="flex items-center gap-1 md:gap-1.5 py-0.5 md:pr-2 min-w-0">
                  {/* 模型选择 */}
                  <div className="relative">
                    <button onClick={() => { setImgModelOpen(o => !o); setImgResOpen(false); }}
                      className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-pink-500/10 hover:bg-pink-500/15 text-[11px] md:text-xs text-pink-400 transition-colors border border-pink-500/20">
                      <Sparkles className="w-3 h-3 text-pink-400" />
                      <span className="hidden sm:inline">{imgModel.label}</span>
                      <span className="sm:hidden">模型</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {imgModelOpen && (
                      <div className="absolute top-full mt-2 left-0 z-50 bg-[#161522] border border-white/15 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] py-1.5 min-w-[160px] backdrop-blur-2xl">
                        <p className="px-3.5 py-2 text-xs text-white/80">{imgModel.label} · {modelCatalog.some(item => item.slot === 'image.primary' && item.enabled) ? '已启用' : '未启用'}</p>
                        <button onClick={() => navigate('/settings/models')}
                          className="w-full text-left px-3.5 py-2 mt-1 pt-2 border-t border-white/10 text-xs flex items-center gap-2 text-white/55 hover:bg-white/10 hover:text-white/90 transition-colors">
                          <Plus className="w-3 h-3" />模型接口设置
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 尺寸/比例 */}
                  <div className="relative">
                    <button onClick={() => { setImgResOpen(o => !o); setImgModelOpen(false); }}
                      className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/15 text-[11px] md:text-xs text-purple-400 transition-colors border border-purple-500/20">
                      <BarChart2 className="w-3 h-3 text-purple-400" />
                      <span className="hidden sm:inline">{imgResolution}</span>
                      <span className="sm:hidden">尺寸</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {/* 移动端：下拉面板预留右侧空间避免超出视口被裁切；桌面端由 max-w 封顶不变 */}
                    {imgResOpen && (
                      <div className="absolute top-full mt-2 left-0 z-50 bg-[#161522] border border-white/15 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-3 md:p-4 w-[calc(100vw-7rem)] max-w-[340px] space-y-3 md:space-y-4 text-white backdrop-blur-2xl">
                        {/* 分辨率 */}
                        <div className="space-y-2">
                          <label className="text-[11px] text-white/40 block font-medium">分辨率</label>
                          <div className="grid grid-cols-3 gap-2">
                            {['1024x1024', '1024x1536', '1536x1024'].map(r => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => updateImgResolution(r, imgQuality, r === '1024x1024' ? '1:1' : r === '1024x1536' ? '2:3' : '3:2')}
                                className={cn(
                                  "py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
                                  imgResolutionType === r
                                    ? "bg-white/15 text-white border border-white/20"
                                    : "bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white"
                                )}
                              >
                                {r === '1024x1024' ? '方形 1:1' : r === '1024x1536' ? '竖图 2:3' : '横图 3:2'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 质量 */}
                        <div className="space-y-2">
                          <label className="text-[11px] text-white/40 block font-medium">质量</label>
                          <div className="grid grid-cols-3 gap-2">
                            {['低', '中', '高'].map(q => (
                              <button
                                key={q}
                                type="button"
                                onClick={() => updateImgResolution(imgResolutionType, q, imgAspect)}
                                className={cn(
                                  "py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
                                  imgQuality === q
                                    ? "bg-white/15 text-white border border-white/20"
                                    : "bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white"
                                )}
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 比例 */}
                        <div className="space-y-2">
                          <label className="text-[11px] text-white/40 block font-medium">比例</label>
                          <div className="grid grid-cols-4 gap-2 max-h-[220px] overflow-y-auto pr-1">
                            {[
                              // 同上：图形宽高一律用任意像素值，保证与比例数值一致
                              { label: '1:1', style: 'w-[12px] h-[12px]' },
                              { label: '3:2', style: 'w-[18px] h-[12px]' },
                              { label: '2:3', style: 'w-[12px] h-[18px]' },
                            ].map(item => (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() => updateImgResolution(item.label === '1:1' ? '1024x1024' : item.label === '2:3' ? '1024x1536' : '1536x1024', imgQuality, item.label)}
                                className={cn(
                                  "flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all duration-200 h-14",
                                  imgAspect === item.label
                                    ? "bg-white/15 text-white border-white/20"
                                    : "bg-white/5 text-white/40 border-transparent hover:bg-white/10 hover:text-white/70"
                                )}
                              >
                                {item.style === 'Auto' ? (
                                  <Sparkles className="w-3.5 h-3.5 text-pink-400 mb-1 shrink-0" />
                                ) : (
                                  <div className={cn("border-2 border-current rounded-sm mb-1 shrink-0", item.style)} />
                                )}
                                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 提示词增强 */}
                  <button aria-label="图片提示词增强" onClick={handleEnhanceImgPrompt} disabled={enhancing || enhancingImg || imgGenerating}
                    className="flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-pink-500/10 hover:bg-pink-500/15 text-[11px] md:text-xs text-pink-400 transition-colors border border-pink-500/20 disabled:opacity-40 shrink-0">
                    {enhancingImg ? <Loader2 className="w-3 h-3 animate-spin text-pink-400" /> : <Sparkles className="w-3.5 h-3.5 text-pink-400" />}
                    <span className="hidden sm:inline">提示词增强</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 md:gap-3 ml-auto">
                  {!imgGenerating && (
                    <button
                      type="button"
                      onClick={handleImgVoiceInput}
                      aria-label={imgRecording ? '停止图片语音输入' : '开始图片语音输入'}
                      aria-pressed={imgRecording}
                      className={cn(
                        "w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center transition-all border shrink-0",
                        imgRecording
                          ? "animate-pulse border-red-500/50 text-red-500 bg-red-500/10"
                          : "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300"
                      )}
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  )}
                  {imgGenerating ? (
                    <button aria-label="刷新进度" onClick={() => void imageTask.refresh()}
                      className="flex items-center justify-center gap-1.5 w-8 h-8 md:w-9 md:h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl text-sm font-semibold transition-all shrink-0"
                      style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}>
                      <RefreshCcw className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">刷新进度</span>
                    </button>
                  ) : (
                    <button aria-label="生成图片" onClick={handleImageGenerate}
                      disabled={referenceBusy || !imgPrompt.trim() || !referenceRights && imgMode !== 'generate'
                        || imageSettingsBusy || imgMode !== 'generate' && (!preparedImageEdit || imageCost === null
                          || !imgConfig?.image_capabilities?.mask || !imgConfig?.version_id)}
                      className="flex items-center justify-center gap-1 px-2.5 py-1.5 md:px-4 md:py-2 rounded-xl text-[11px] sm:text-sm font-semibold transition-all duration-200 enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      style={{ background: 'linear-gradient(135deg,#ec4899,#8b5cf6)', color: '#fff', boxShadow: '0 0 20px rgba(236,72,153,0.35)' }}>
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span className="sm:hidden">生成</span>
                      <span className="hidden sm:inline">生成图片</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 生成结果视频 */}
        {resultVideo && mainTab === '视频生成' && (
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#13121b] mb-6">
            <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2.5 md:py-3 border-b border-white/8">
              <div className="flex items-center gap-2 md:gap-3 flex-wrap min-w-0">
                <span className="text-sm font-medium text-white/80">生成结果</span>
                {selectedAvatar && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-500/15 border border-pink-500/30 text-xs text-pink-300">
                    {selectedAvatar.preview_image && <img src={selectedAvatar.preview_image} alt={selectedAvatar.name} className="w-4 h-4 rounded-full object-cover shrink-0" />}
                    <span>当前所选数字人：<strong>{selectedAvatar.name}</strong></span>
                  </div>
                )}
                <button
                  onClick={() => navigate('/works')}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md bg-primary/20 hover:bg-primary/30 text-primary transition-colors border border-primary/20 flex items-center gap-1"
                >
                  <Video className="w-3 h-3" /> 作品素材
                </button>
              </div>
              <button onClick={clearResult} className="text-white/30 hover:text-white/70 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <video src={resultVideo} controls autoPlay className="w-full max-h-[60vh] object-contain bg-black" />
          </div>
        )}

        {/* 生成结果图片 */}
        {resultImage && mainTab === '图片生成' && (
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#13121b] max-w-lg mx-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <span className="text-sm font-medium text-white/80">生成结果</span>
              <div className="flex items-center gap-2">
                <a href={resultImage} download="ai_image.png" target="_blank" rel="noreferrer" className="text-white/60 hover:text-white/90 transition-colors">
                  <Download className="w-4 h-4" />
                </a>
                <button onClick={() => setResultImage(null)} className="text-white/30 hover:text-white/70 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <img src={resultImage} alt="AI Generated" className="w-full object-contain bg-black" />
          </div>
        )}

        {/* ── 功能区、工具条、灵感广场（在生成及绘图选项下显示） ─────────────────── */}
        {mainTab !== '分镜编辑' && (
          <>
            {/* ── 功能区（移动端缩小卡片内边距与字号） ────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 md:gap-4">
              {/* 左侧大卡：作品素材 */}
              <div className="lg:col-span-2 rounded-2xl p-4 sm:p-6 flex flex-col justify-between min-h-[170px] sm:min-h-[220px] relative overflow-hidden cursor-pointer group"
                style={{ background: 'linear-gradient(135deg,#1a1230 0%,#251840 100%)', border: '1px solid rgba(139,92,246,0.25)' }}
                onClick={() => navigate('/works')}>
                <Video aria-hidden="true" className="absolute right-5 top-5 w-20 h-20 text-violet-300/15" />
                <div className="relative z-10 space-y-1.5 md:space-y-2">
                  <h3 className="text-base sm:text-xl font-bold">作品素材</h3>
                  <p className="text-xs sm:text-sm text-white/50">管理已生成的视频与上传的素材库</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5 md:pt-1">
                    {['视频作品', '素材管理', '智能剪辑'].map(m => (
                      <span key={m} className="text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">{m}</span>
                    ))}
                  </div>
                </div>
                <button className="relative z-10 w-fit mt-3 md:mt-4 px-4 py-1.5 md:px-5 md:py-2 rounded-full text-xs md:text-sm font-semibold text-white transition-all hover:scale-105"
                  style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}
                  onClick={e => { e.stopPropagation(); navigate('/works'); }}>
                  进入管理 →
                </button>
              </div>

              {/* 右侧工具卡片（移动端缩小高度与字体） */}
              <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                {QUICK_TOOLS.map(tool => (
                  <button key={tool.id} onClick={() => navigate(tool.path)}
                    className="relative rounded-xl overflow-hidden group h-[74px] sm:h-[90px] flex items-end p-2.5 sm:p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
                    style={{ background: '#1a1830', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className={cn('absolute inset-0 bg-gradient-to-r opacity-60', tool.gradient)} />
                    <div className="relative z-10">
                      <p className="text-xs sm:text-sm font-semibold text-white">{tool.label}</p>
                      <p className="text-[9px] sm:text-[10px] text-white/50 leading-tight truncate">{tool.sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>



            {/* ── 灵感广场 ──────────────────────────────────────────────── */}
            <div className="space-y-3.5 md:space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base md:text-lg font-bold">我的创作参考</h2>
                <button onClick={() => navigate('/works')} className="text-xs text-white/60 hover:text-white transition-colors flex items-center gap-1">
                  全部作品 <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <p className="text-xs text-white/60">来自当前账号最近40个已完成作品，可预览并复用原提示词。未保存的生成信息显示「未记录」。</p>
              {recentWorks.error && <p role="alert" className="text-sm text-rose-300">{recentWorks.error}</p>}
              <button disabled={recentWorks.loading} onClick={() => void recentWorks.reload()} className="text-xs text-white/70 hover:text-white">
                {recentWorks.loading ? '正在读取最近作品…' : '刷新最近作品'}
              </button>

              {/* 筛选栏 */}
              <div className="flex items-center gap-2 flex-wrap relative">
                {activeDropdown && (
                  <div className="fixed inset-0 z-40" onClick={() => setActiveDropdown(null)} />
                )}
                {workFilters.map(f => (
                  <div key={f.key} className="relative z-50">
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === f.key ? null : f.key)}
                      className={cn(
                        "flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[11px] md:text-xs transition-colors border",
                        (f.key === 'model' && filterModel !== '全部') ||
                        (f.key === 'ratio' && filterRatio !== '全部') ||
                        (f.key === 'refImage' && filterRefImage !== '全部') ||
                        (f.key === 'firstLast' && filterFirstLast !== '全部') ||
                        (f.key === 'category' && filterCategory !== '全部') ||
                        (f.key === 'language' && filterLanguage !== '全部')
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium"
                          : "text-white/60 hover:text-white/90 hover:bg-white/8 border-white/8"
                      )}
                    >
                      {f.label}：{
                        f.key === 'model' ? filterModel :
                        f.key === 'ratio' ? filterRatio :
                        f.key === 'refImage' ? filterRefImage :
                        f.key === 'firstLast' ? filterFirstLast :
                        f.key === 'category' ? filterCategory :
                        filterLanguage
                      }
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {activeDropdown === f.key && (
                      <div className="absolute top-full mt-1.5 left-0 z-50 bg-[#1e1d2a] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[120px] max-h-60 overflow-y-auto">
                        {f.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => {
                              if (f.key === 'model') setFilterModel(opt);
                              else if (f.key === 'ratio') setFilterRatio(opt);
                              else if (f.key === 'refImage') setFilterRefImage(opt);
                              else if (f.key === 'firstLast') setFilterFirstLast(opt);
                              else if (f.key === 'category') setFilterCategory(opt);
                              else if (f.key === 'language') setFilterLanguage(opt);
                              setActiveDropdown(null);
                            }}
                            className={cn(
                              'w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors',
                              (f.key === 'model' && filterModel === opt) ||
                              (f.key === 'ratio' && filterRatio === opt) ||
                              (f.key === 'refImage' && filterRefImage === opt) ||
                              (f.key === 'firstLast' && filterFirstLast === opt) ||
                              (f.key === 'category' && filterCategory === opt) ||
                              (f.key === 'language' && filterLanguage === opt)
                                ? 'text-emerald-400 font-medium'
                                : 'text-white/70'
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* 🔍 搜索提示词或关键词 */}
                <div className="relative ml-auto flex items-center bg-white/4 border border-white/6 rounded-lg px-2.5 py-1 text-xs text-white/70 focus-within:border-white/20 z-50">
                  <span className="mr-1">🔍</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索提示词或关键词"
                    className="bg-transparent border-none outline-none text-white text-xs placeholder:text-white/20 w-28 sm:w-44"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="ml-1 text-white/30 hover:text-white/60">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* 瀑布流视频 4列 */}
              <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
                {filteredInspireVideos.map((video, i) => (
                  <div key={i} 
                    className="break-inside-avoid rounded-xl overflow-hidden group cursor-pointer relative bg-black/20"
                    style={{ border: '1px solid rgba(255,255,255,0.07)' }}
                    onMouseEnter={(e) => {
                      const v = e.currentTarget.querySelector('video');
                      if (v) v.play().catch(err => console.log('Autoplay blocked:', err));
                    }}
                    onMouseLeave={(e) => {
                      const v = e.currentTarget.querySelector('video');
                      if (v) {
                        v.pause();
                        v.currentTime = 0;
                      }
                    }}
                    onClick={() => setActivePlayVideo(video)}
                  >
                    <video
                      src={video.url}
                      poster={video.cover || undefined}
                      muted
                      loop
                      playsInline
                      preload="none"
                      className="w-full aspect-video object-contain transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    {/* 静止状态左下角播放提示小标 */}
                    <div className="absolute bottom-2 left-2 opacity-70 group-hover:opacity-0 transition-opacity flex items-center gap-1 text-[9px] text-white/80 bg-black/60 px-1.5 py-0.5 rounded backdrop-blur">
                      <Play className="w-2.5 h-2.5 fill-white/80" />
                      <span>预览</span>
                    </div>
                    <div className="absolute top-2 right-2 opacity-100 group-hover:opacity-0 transition-opacity">
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white/80 backdrop-blur">{video.model}</span>
                    </div>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white/80 backdrop-blur">{video.model}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/60 text-white/80 backdrop-blur">{video.ratio}</span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] text-white/90 line-clamp-2 leading-relaxed">{video.prompt}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-white/40">{video.category} · {video.language}</span>
                          <div className="flex gap-1.5">
                            <button className="w-7 h-7 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (mainTab === '视频生成') {
                                  setPrompt(video.prompt);
                                  toast.success('已应用该视频的提示词');
                                } else if (mainTab === '图片生成') {
                                  setImgPrompt(video.prompt);
                                  toast.success('已应用该视频的提示词');
                                }
                              }}
                              title="应用此提示词">
                              <Copy className="w-3.5 h-3.5 text-white" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {filteredInspireVideos.length === 0 && (
                <div className="text-center py-10 text-white/30 text-sm">
                  {recentWorks.loading ? '正在读取作品…' : recentWorks.error ? '作品暂时无法读取，点击刷新重试' : '暂无符合筛选条件的真实作品，生成完成后可在这里复用'}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 分镜编辑：复用脚本、素材与后台成片组件 ──────────────────────────────── */}
        {mainTab === '分镜编辑' && (
          <div className="w-full -mt-8">
            <ProductVideoWizard />
          </div>
        )}

        {/* 灵感广场视频带声音弹窗播放 */}
        {activePlayVideo && (() => {
          const isVertical = activePlayVideo.ratio === '9:16' || activePlayVideo.ratio === '3:4';
          const isSquare = activePlayVideo.ratio === '1:1';
          const aspectClass = activePlayVideo.ratio === '9:16' ? 'aspect-[9/16]' :
                              activePlayVideo.ratio === '3:4' ? 'aspect-[3/4]' :
                              activePlayVideo.ratio === '1:1' ? 'aspect-square' :
                              'aspect-video';
          return (
            <Dialog open={!!activePlayVideo} onOpenChange={() => setActivePlayVideo(null)}>
              {/* 移动端：宽度不超过视口（留边距），sm 及以上恢复原尺寸 */}
              <DialogContent className={cn(
                "bg-zinc-950 border-zinc-800 text-zinc-200 p-0 overflow-hidden max-w-[calc(100vw-1.5rem)]",
                isVertical ? "sm:max-w-[380px]" : isSquare ? "sm:max-w-md" : "sm:max-w-2xl"
              )}>
                <DialogHeader className="p-4 border-b border-zinc-800/80 flex flex-row items-center justify-between">
                  <DialogTitle className="text-sm font-semibold truncate pr-4 text-zinc-100">
                    {activePlayVideo.prompt}
                  </DialogTitle>
                </DialogHeader>
                <div className={cn("w-full bg-black relative flex items-center justify-center", aspectClass)}>
                  <video
                    src={activePlayVideo.url}
                    controls
                    autoPlay
                    className="w-full h-full object-contain"
                  />
                </div>
              </DialogContent>
            </Dialog>
          );
        })()}

        {/* 选择商品管理中的商品 弹窗 */}
        <Dialog open={isProductModalOpen} onOpenChange={setIsProductModalOpen}>
          {/* 移动端：宽度不超过视口（留边距），sm 及以上恢复原尺寸 */}
          <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[85vh] bg-[#16151f] border-white/10 text-white p-0 overflow-hidden flex flex-col rounded-2xl shadow-2xl">
            {/* 弹窗头部 */}
            <DialogHeader className="p-5 border-b border-white/10 bg-gradient-to-r from-violet-950/60 via-purple-950/40 to-[#16151f] flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0 shadow-inner">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                    选择商品管理中的商品
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-medium border border-violet-500/30 font-mono">
                      {modalViewTab === 'products' ? `${filteredSelectorProducts.length} 款商品` : `${filteredCategoryVideos.length} 条视频`}
                    </span>
                  </DialogTitle>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    选择商品可复用已保存的卖点和描述；选择本人的真实作品可复用原提示词
                  </p>
                </div>
              </div>
            </DialogHeader>

            {/* 搜索与分类筛选栏 */}
            <div className="p-4 border-b border-white/10 bg-white/[0.02] space-y-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="搜索商品名称、核心卖点、品牌或分类..."
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/60"
                  />
                  {productSearch && (
                    <button
                      type="button"
                      onClick={() => setProductSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 一键URL解析商品导入按钮 (样式与商品管理页面完全一致) */}
                <Button
                  onClick={() => setUrlParseOpen(true)}
                  className="h-9 bg-gradient-to-r from-rose-500 via-pink-500 to-purple-600 hover:from-rose-600 hover:via-pink-600 hover:to-purple-700 text-white font-semibold shadow-sm gap-1.5 transition-all rounded-xl text-xs px-3.5 shrink-0"
                >
                  <Sparkles className="w-4 h-4 animate-pulse text-amber-300" />
                  一键URL解析商品导入
                  <Badge className="bg-white/20 text-white border-none text-[10px] ml-0.5 font-normal">
                    AI 多模态
                  </Badge>
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setIsProductModalOpen(false);
                    navigate('/products');
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-200 hover:text-white transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  管理已有商品
                </button>
              </div>

              {/* 分类切换与列表模式切换 */}
              <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
                {/* 分类标签 */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 flex-1 min-w-0">
                  {['全部', '服装配饰', '美妆护肤', '数码电器', '食品饮料', '家居用品'].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategoryFilter(cat)}
                      className={cn(
                        'px-3.5 py-1.5 rounded-xl text-xs transition-all shrink-0 border',
                        selectedCategoryFilter === cat
                          ? 'bg-violet-600 border-violet-500 text-white font-semibold shadow-md'
                          : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10 font-medium'
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* 商品列表 / 视频列表 双视图切换 Tab */}
                <div className="flex items-center bg-black/40 border border-white/10 p-1 rounded-xl shrink-0">
                  <button
                    type="button"
                    onClick={() => setModalViewTab('products')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all',
                      modalViewTab === 'products'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    )}
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>商品列表</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                      {filteredSelectorProducts.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalViewTab('videos')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all',
                      modalViewTab === 'videos'
                        ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    )}
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>视频列表</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                      {filteredCategoryVideos.length}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* 列表内容区域：根据 modalViewTab 动态展示商品列表或视频列表 */}
            {modalViewTab === 'videos' ? (
              <div className="flex-1 overflow-y-auto p-4 max-h-[460px] space-y-3">
                {filteredCategoryVideos.length === 0 ? (
                  <div className="py-16 text-center text-zinc-400 space-y-3">
                    <Video className="w-10 h-10 text-zinc-600 mx-auto" />
                    <p className="text-sm">{recentWorks.loading ? '正在读取作品…' : recentWorks.error || '暂无匹配的真实作品'}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredCategoryVideos.map(vid => (
                      <div
                        key={vid.id}
                        className="p-3 rounded-xl border border-zinc-800 bg-[#1a1829] hover:border-violet-500/40 hover:bg-[#211e35] transition-all flex gap-3 group relative overflow-hidden shadow-sm"
                      >
                        {/* 视频缩略图及悬停/点击播放 */}
                        <div
                          className="w-24 h-32 rounded-lg overflow-hidden bg-black shrink-0 border border-white/10 relative cursor-pointer group/vid"
                          onClick={() => setActivePlayVideo(vid as any)}
                        >
                          <video src={vid.url} poster={vid.cover || undefined} preload="metadata" muted playsInline
                            aria-label={vid.name} className="w-full h-full object-contain" />
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover/vid:bg-black/10 transition-colors">
                            <div className="w-8 h-8 rounded-full bg-white/30 backdrop-blur-md flex items-center justify-center text-white shadow-lg group-hover/vid:scale-110 transition-transform">
                              <Play className="w-4 h-4 fill-white translate-x-0.5" />
                            </div>
                          </div>
                          <span className="absolute bottom-1 left-1 text-[9px] px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-zinc-300 border border-white/15 font-medium">
                            {vid.category}
                          </span>
                          <span className="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-amber-300 border border-white/15 font-medium">
                            {vid.model}
                          </span>
                        </div>

                        {/* 视频信息与操作 */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <h4 className="text-sm font-bold text-zinc-100 group-hover:text-white transition-colors line-clamp-1">
                              {vid.name}
                            </h4>
                            <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                              {vid.prompt}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-white/5">
                            <button
                              type="button"
                              onClick={() => setActivePlayVideo(vid as any)}
                              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-medium transition-colors"
                            >
                              <Play className="w-3 h-3" />
                              预览播放
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPrompt(vid.prompt);
                                triggerVideoTypingGlow();
                                setIsProductModalOpen(false);
                                toast.success(`已应用「${vid.name}」视频提示词到工作台！`);
                              }}
                              className="text-xs font-semibold px-3 py-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white flex items-center gap-1.5 shadow-sm transition-all border border-violet-400/30"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                              采用提示词生成
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* 商品列表 */
              <div className="flex-1 overflow-y-auto p-4 max-h-[460px] space-y-3">
                {loadingProducts ? (
                  <div className="py-16 text-center text-zinc-400 space-y-2">
                    <Loader2 className="w-7 h-7 animate-spin text-violet-400 mx-auto" />
                    <p className="text-xs">正在加载商品管理库中的数据...</p>
                  </div>
                ) : filteredSelectorProducts.length === 0 ? (
                  <div className="py-16 text-center text-zinc-400 space-y-3">
                    <Package className="w-10 h-10 text-zinc-600 mx-auto" />
                    <p className="text-sm">未搜索到相关商品</p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsProductModalOpen(false);
                        navigate('/products');
                      }}
                      className="px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold text-xs hover:bg-violet-500 transition-colors inline-flex items-center gap-1.5 shadow-md"
                    >
                      <Plus className="w-4 h-4" />
                      前往「商品管理」添加商品
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredSelectorProducts.map(prod => {
                      const isSelected = selectedProduct?.id === prod.id;
                      const points = [...(prod.selling_points || []), ...(prod.ai_selling_points || [])].filter(Boolean);
                      const price = prod.sale_price ?? prod.original_price;

                      return (
                        <div
                          key={prod.id}
                          onClick={() => handleSelectProduct(prod)}
                          className={cn(
                            'p-3.5 rounded-xl border transition-all cursor-pointer flex gap-3 group relative overflow-hidden shadow-sm',
                            isSelected
                              ? 'bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/40 shadow-lg'
                              : 'bg-[#1a1829] border-zinc-800 hover:border-violet-500/40 hover:bg-[#211e35]'
                          )}
                        >
                          {/* 封面图 */}
                          <div className="w-20 h-20 rounded-lg overflow-hidden bg-black/60 shrink-0 border border-white/10 relative">
                            <ProductImage src={prod.cover_image} name={prod.name} className="w-full h-full" />
                            <span className="absolute bottom-1 left-1 text-[9px] px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-zinc-300 border border-white/15 font-medium">
                              {prod.category}
                            </span>
                          </div>

                          {/* 描述信息 */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div>
                              <h4 className="text-sm font-bold text-zinc-100 group-hover:text-white transition-colors line-clamp-1">
                                {prod.name}
                              </h4>
                              {price != null && (
                                <div className="flex items-baseline gap-1.5 mt-0.5">
                                  <span className="text-base font-extrabold text-rose-400">{productPrice(prod)}</span>
                                  {prod.original_price && prod.sale_price && prod.original_price > prod.sale_price && (
                                    <span className="text-xs text-zinc-500 line-through">{prod.currency || '币种未提供'} {prod.original_price}</span>
                                  )}
                                </div>
                              )}
                              {points.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {points.slice(0, 2).map((pt, idx) => (
                                    <span
                                      key={idx}
                                      className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-medium max-w-[135px] truncate"
                                    >
                                      ⚡ {pt}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/5">
                              <span className="text-[11px] text-zinc-400">
                                累计销量: {prod.sales_count ?? '未提供'}
                              </span>
                              <button
                                type="button"
                                className={cn(
                                  'text-xs font-semibold px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 shadow-sm',
                                  isSelected
                                    ? 'bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold shadow-md'
                                    : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border border-violet-400/30'
                                )}
                              >
                                {isSelected ? <Check className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
                                {isSelected ? '已选此商品' : '提取视频脚本'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* 一键 URL / 口令解析商品导入弹窗 */}
        <UrlProductImportDialog
          open={urlParseOpen}
          onOpenChange={setUrlParseOpen}
          onSuccess={handleImportProductSuccess}
          zIndexClass="z-[70]"
        />

      </div>
    </div>
  );
}
