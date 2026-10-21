import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { validateMediaTree } from './private-media.ts';
import { validateVideoInput, type VideoInput } from './video-providers.ts';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export interface BatchRequest {
  name: string;
  provider: string;
  product_ids: string[];
  settings: { duration: number; ratio: string; resolution: string; style: string; language: string };
  overrides: Record<string, { prompt: string }>;
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
  const overrides: BatchRequest['overrides'] = {};
  if (raw.overrides !== undefined) {
    if (!raw.overrides || typeof raw.overrides !== 'object' || Array.isArray(raw.overrides)) throw new Error('独立配置格式非法');
    for (const [id, value] of Object.entries(raw.overrides) as [string, any][]) {
      if (!raw.product_ids.includes(id) || !value || typeof value.prompt !== 'string'
        || !value.prompt.trim() || value.prompt.length > 7000) throw new Error('单品描述应为 1–7000 字且属于所选商品');
      overrides[id] = { prompt: value.prompt.trim() };
    }
  }
  return { name: raw.name.trim(), provider: raw.provider, product_ids: raw.product_ids,
    settings: { duration: base.duration, ratio: base.ratio, resolution: base.resolution,
      style: settings.style.trim(), language: settings.language },
    overrides, expected_unit_cost: raw.expected_unit_cost, budget: raw.budget };
}
const languages: Record<string, string> = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', th: '泰语', vi: '越南语' };
export async function prepareBatchItems(db: SupabaseClient, userId: string, request: BatchRequest) {
  const { data, error } = await db.from('products').select('id,name,category,price,selling_points,image_url')
    .eq('user_id', userId).in('id', request.product_ids);
  if (error) throw new Error('商品读取失败，请使用相同请求标识重试');
  if (!data || data.length !== request.product_ids.length) throw new Error('商品不存在或无权使用');
  const items: { product_id: string; input: VideoInput }[] = [];
  for (const id of request.product_ids) {
    const product = data.find(item => item.id === id)!;
    const facts = `商品：${product.name}\n分类：${product.category || '未填写'}\n`
      + `价格：${product.price == null ? '未填写' : product.price}\n`
      + `已登记卖点：${Array.isArray(product.selling_points) ? product.selling_points.join('；') : '未填写'}`;
    const prompt = `${facts}\n制作${request.settings.duration}秒商品展示视频，风格：${request.settings.style}，`
      + `目标语言：${languages[request.settings.language]}。保持商品外观与事实一致，不编造认证、销量或功效。`
      + (request.overrides[id] ? `\n补充要求：${request.overrides[id].prompt}` : '');
    const input = validateVideoInput(request.provider, await validateMediaTree(db, {
      prompt, title: `${product.name} · ${request.settings.style}`, ...request.settings,
      ...(product.image_url ? { first_frame: product.image_url } : {}),
    }, userId));
    items.push({ product_id: id, input });
  }
  return items;
}
