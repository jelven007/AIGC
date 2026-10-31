import type { ScriptScene } from '@/types/types';

export interface ScriptDraft {
  productName: string; category: string; priceRange: string; sellingPoints: string[];
  audience: string; platform: string; videoLength: number; knowledgeJobId?: string;
  scenes?: ScriptScene[]; promptText?: string; generated?: boolean;
}
export const EMPTY_SCRIPT_DRAFT: ScriptDraft = {
  productName: '', category: '美妆护肤', priceRange: '', sellingPoints: [], audience: '',
  platform: 'douyin', videoLength: 25, knowledgeJobId: '', scenes: [], promptText: '', generated: false,
};

/** 兼容旧草稿的缺省字段；空表单和无效缓存不作为可恢复内容。 */
export function readScriptDraft(value: unknown): ScriptDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (['productName', 'category', 'priceRange', 'audience', 'platform', 'knowledgeJobId', 'promptText']
    .some(key => raw[key] !== undefined && typeof raw[key] !== 'string')) return null;
  if (raw.sellingPoints !== undefined && (!Array.isArray(raw.sellingPoints)
    || raw.sellingPoints.some(point => typeof point !== 'string'))) return null;
  if (raw.videoLength !== undefined && (typeof raw.videoLength !== 'number'
    || !Number.isFinite(raw.videoLength) || raw.videoLength <= 0)) return null;
  if (raw.generated !== undefined && typeof raw.generated !== 'boolean') return null;
  if (raw.scenes !== undefined && (!Array.isArray(raw.scenes) || raw.scenes.some(scene =>
    !scene || !Number.isInteger(scene.order) || !Number.isFinite(scene.duration) || scene.duration <= 0
    || ['scene', 'visual', 'dialogue', 'prompt'].some(key => typeof scene[key] !== 'string')))) return null;
  const draft = { ...EMPTY_SCRIPT_DRAFT, ...raw } as ScriptDraft;
  const meaningful = [draft.productName, draft.priceRange, draft.audience, draft.knowledgeJobId, draft.promptText]
    .some(text => text?.trim()) || draft.sellingPoints.some(point => point.trim()) || !!draft.scenes?.length
    || !!draft.category && draft.category !== EMPTY_SCRIPT_DRAFT.category
    || !!draft.platform && draft.platform !== EMPTY_SCRIPT_DRAFT.platform
    || draft.videoLength !== EMPTY_SCRIPT_DRAFT.videoLength;
  return meaningful ? draft : null;
}
