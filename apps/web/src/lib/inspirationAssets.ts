import catalog from './inspirationAssets.json';

export type InspirationAsset = typeof catalog[number];
export const inspirationAssets = catalog;
export const inspirationCategories = ['功能灵感', '用户场景', '商品构图', '人物出镜', '创作界面'];
export const inspirationAsset = (id: string | null) => catalog.find(item => item.id === id);
export function marketingDestination(path: string, signedIn: boolean) {
  return signedIn ? path : `/login?mode=login&redirect=${encodeURIComponent(path)}`;
}
/** 只恢复明确的站内入口，参考内容来自公开目录而非URL中的任意文本。 */
export function loginDestination(value: string | null) {
  if (value === '/credits?tab=plans' || value === '/support') return value;
  const match = value?.match(/^\/video\/create\?inspiration=(ref-\d{2})$/);
  return match && inspirationAsset(match[1]) ? value! : '/';
}
