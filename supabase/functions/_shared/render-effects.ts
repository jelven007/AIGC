// 前端与 API 共用效果白名单。Worker 按相同标识执行真实像素公式。
export const RENDER_TRANSITIONS = [
  { id: 't1', name: '淡入淡出', category: '基础' },
  { id: 't2', name: '叠化溶解', category: '基础' },
  { id: 't3', name: '左侧推入', category: '基础' },
  { id: 't4', name: '右侧推入', category: '基础' },
  { id: 't5', name: '闪白', category: '创意' },
  { id: 't6', name: '圆形展开', category: '创意' },
  { id: 't7', name: '像素溶解', category: '创意' },
  { id: 't8', name: '横向展开', category: '创意' },
  { id: 't9', name: '快速叠化', category: '基础' },
  { id: 't10', name: '闪动叠化', category: '创意' },
  { id: 't11', name: '波纹擦除', category: '创意' },
  { id: 't12', name: '旋转擦除', category: '创意' },
] as const;
export const RENDER_BLENDS = [
  { id: 'normal', name: '正常', css: 'normal' },
  { id: 'multiply', name: '正片叠底', css: 'multiply' },
  { id: 'screen', name: '滤色', css: 'screen' },
  { id: 'overlay', name: '叠加', css: 'overlay' },
  { id: 'softlight', name: '柔光', css: 'soft-light' },
  { id: 'difference', name: '差值', css: 'difference' },
  { id: 'hue', name: '色相', css: 'hue' },
  { id: 'saturation', name: '饱和度', css: 'saturation' },
] as const;
export interface ChromaSettings { color: string; similarity: number; smoothness: number }
export const DEFAULT_CHROMA: ChromaSettings = { color: '#00ff00', similarity: .25, smoothness: .08 };
