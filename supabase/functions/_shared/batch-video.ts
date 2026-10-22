import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { validateMediaTree } from './private-media.ts';
import { validateVideoInput, type VideoInput } from './video-providers.ts';
import { RENDER_TRANSITIONS } from './render-effects.ts';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export interface BatchRequest {
  name: string;
  provider: string;
  product_ids: string[];
  settings: { duration: number; ratio: string; resolution: string; style: string; language: string };
  overrides: Record<string, { prompt?: string; narration?: string }>;
  pipeline?: { shots: string[]; voice: string; subtitles: boolean; transition: string; delivery: 'render' | 'publish' };
  expected_unit_cost: number;
  budget: number;
}
export function validateBatchRequest(raw: Record<string, any>): BatchRequest {
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 80
    || typeof raw.provider !== 'string' || !Array.isArray(raw.product_ids)
    || raw.product_ids.length < 1 || raw.product_ids.length > 50 || !raw.product_ids.every(uuid)
    || new Set(raw.product_ids).size !== raw.product_ids.length) throw new Error('批次名称必填，每批选择 1–50 个不同商品');
  const settings = raw.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || typeof settings.style !== 'string' || !settings.style.trim() || settings.style.length > 200
    || !['zh', 'en', 'ja', 'ko', 'th', 'vi'].includes(settings.language)) throw new Error('请填写风格和目标语言');
  const base = validateVideoInput(raw.provider, { ...settings, prompt: '批次参数校验' });
  if (!Number.isInteger(raw.expected_unit_cost) || raw.expected_unit_cost < 1
    || !Number.isInteger(raw.budget) || raw.budget < 1 || raw.budget > 100000) throw new Error('请先读取价格并确认积分预算');
  let pipeline: BatchRequest['pipeline'];
  if (raw.pipeline !== undefined) {
    const value = raw.pipeline;
    if (!value || !Array.isArray(value.shots) || value.shots.length < 2 || value.shots.length > 6
      || value.shots.some((shot: unknown) => typeof shot !== 'string' || !shot.trim() || shot.length > 500)
      || typeof value.voice !== 'string' || !value.voice.trim() || value.voice.length > 200
      || typeof value.subtitles !== 'boolean' || !['render', 'publish'].includes(value.delivery)
      || value.transition !== 'none' && !RENDER_TRANSITIONS.some(effect => effect.id === value.transition)
      || base.resolution === '480P') throw new Error('多镜头需2–6个镜头、音色ID和720P以上输出规格');
    pipeline = { shots: value.shots.map((shot: string) => shot.trim()), voice: value.voice.trim(),
      subtitles: value.subtitles, transition: value.transition, delivery: value.delivery };
  }
  const overrides: BatchRequest['overrides'] = {};
  if (raw.overrides !== undefined) {
    if (!raw.overrides || typeof raw.overrides !== 'object' || Array.isArray(raw.overrides)) throw new Error('独立配置格式非法');
    for (const [id, value] of Object.entries(raw.overrides) as [string, any][]) {
      if (!raw.product_ids.includes(id) || !value || typeof value !== 'object'
        || value.prompt !== undefined && (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 7000)
        || value.narration !== undefined && (typeof value.narration !== 'string' || !value.narration.trim() || value.narration.length > 2000)
        || value.prompt === undefined && value.narration === undefined) throw new Error('单品描述或配音正文非法');
      overrides[id] = { ...(value.prompt ? { prompt: value.prompt.trim() } : {}),
        ...(value.narration ? { narration: value.narration.trim() } : {}) };
    }
  }
  if (pipeline && raw.product_ids.some((id: string) => !overrides[id]?.narration)) throw new Error('请逐商品填写目标语言配音正文');
  return { name: raw.name.trim(), provider: raw.provider, product_ids: raw.product_ids,
    settings: { duration: base.duration, ratio: base.ratio, resolution: base.resolution,
      style: settings.style.trim(), language: settings.language },
    overrides, ...(pipeline ? { pipeline } : {}), expected_unit_cost: raw.expected_unit_cost, budget: raw.budget };
}
const languages: Record<string, string> = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', th: '泰语', vi: '越南语' };
export async function prepareBatchItems(db: SupabaseClient, userId: string, request: BatchRequest) {
  const { data, error } = await db.from('products').select('id,name,category,price,selling_points,image_url')
    .eq('user_id', userId).in('id', request.product_ids);
  if (error) throw new Error('商品读取失败，请使用相同请求标识重试');
  if (!data || data.length !== request.product_ids.length) throw new Error('商品不存在或无权使用');
  const items: { product_id: string; input: VideoInput; shots?: VideoInput[]; narration?: string }[] = [];
  for (const id of request.product_ids) {
    const product = data.find(item => item.id === id)!;
    const facts = `商品：${product.name}\n分类：${product.category || '未填写'}\n`
      + `价格：${product.price == null ? '未填写' : product.price}\n`
      + `已登记卖点：${Array.isArray(product.selling_points) ? product.selling_points.join('；') : '未填写'}`;
    const prompt = `${facts}\n制作${request.settings.duration}秒商品展示视频，风格：${request.settings.style}，`
      + `目标语言：${languages[request.settings.language]}。保持商品外观与事实一致，不编造认证、销量或功效。`
      + (request.overrides[id]?.prompt ? `\n补充要求：${request.overrides[id].prompt}` : '');
    const input = validateVideoInput(request.provider, await validateMediaTree(db, {
      prompt, title: `${product.name} · ${request.settings.style}`, ...request.settings,
      ...(product.image_url ? { first_frame: product.image_url } : {}),
    }, userId));
    items.push({ product_id: id, input, ...(request.pipeline ? {
      shots: request.pipeline.shots.map((shot, index) => validateVideoInput(request.provider, {
        ...input, prompt: `${input.prompt}\n镜头${index + 1}：${shot}。不要生成配音或叠加文字，后期将统一处理。`,
      })), narration: request.overrides[id].narration,
    } : {}) });
  }
  return items;
}
