import { supabase } from '@/db/supabase';
import { canonicalMediaTree, hydrateMediaTree } from '@/lib/privateMedia';
import { backendAnonKey } from '@/lib/backendConfig';
import type { Product } from '@/types/types';
import type { ProductionJob } from './productionJobs';
import { handleApiRequest } from './client';
export { PRODUCT_CATEGORIES, productDraft, productImportInput } from '../../supabase/functions/_shared/product-contract';
export type ProductItem = Product;
export type ProductDraft = ReturnType<typeof import('../../supabase/functions/_shared/product-contract').productDraft>;
export type ProductImportResult = { draft: ProductDraft; warnings: string[]; source: NonNullable<Product['source']> };
export type ProductImportJob = Omit<ProductionJob, 'result'> & { result: ProductImportResult & { expired?: boolean } | null };
export const PRODUCT_LANGUAGES: Record<string, string> = { 'zh-CN': '简体中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语',
  de: '德语', es: '西班牙语', pt: '葡萄牙语', ar: '阿拉伯语', th: '泰语', vi: '越南语', id: '印度尼西亚语' };
export type ProductTranslationInput = { product_id: string; expected_updated_at: string; target_language: string;
  include_image: boolean; confirmed_credit_cost: number };
export type ProductTranslationResult = { product_id: string; source_updated_at: string; source_hash: string; target_language: string;
  version_id: string; image_hash: string | null; created_at: string; image_note: string;
  translation: Pick<ProductDraft, 'name' | 'description' | 'selling_points' | 'specs'>;
  image_text: { original: string; translated: string }[]; expired?: boolean };
export type ProductTranslationJob = Omit<ProductionJob, 'result'> & { result: ProductTranslationResult | null };
export type ProductMutation = { action: 'save' | 'delete'; request_key: string;
  items: { id?: string; expected_updated_at?: string; import_job_id?: string; draft?: ProductDraft }[] };
export class ProductRequestError extends Error {
  constructor(message: string, readonly status: number, readonly outcome: string) { super(message); }
}
export async function productRequest(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('product-management', { body: canonicalMediaTree(body) });
  if (error) {
    const response = error.context instanceof Response ? error.context : null;
    const details = await response?.json().catch(() => null);
    throw new ProductRequestError(details?.error || error.message, response?.status || 0, details?.outcome || 'unknown');
  }
  if (data?.error) throw new ProductRequestError(data.error, 400, data.outcome || 'unknown');
  if (!data) throw new ProductRequestError('商品服务未返回回执', 0, 'unknown');
  return data;
}
export async function listProducts(options: { search?: string; category?: string; status?: string; sort?: string; offset?: number; limit?: number } = {})
  : Promise<{ products: Product[]; total: number; offset: number }> {
  return productRequest({ action: 'list', ...options });
}
export async function fetchProducts(options: { userId?: string; category?: string; search?: string } = {}) {
  return handleApiRequest(async () => {
    const listed = await listProducts({ category: options.category === '全部' ? 'all' : options.category, search: options.search });
    return { data: listed.products, error: null };
  });
}
export function pendingProductKey(uid: string) { return `shopro-product-mutation-${uid}`; }
export function storeProductMutation(uid: string, request: ProductMutation) {
  localStorage.setItem(pendingProductKey(uid), JSON.stringify(canonicalMediaTree(request)));
}
export function readProductMutation(uid: string): ProductMutation | null {
  try {
    const raw = localStorage.getItem(pendingProductKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export async function uploadProductImage(file: File, uid: string): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
    throw new Error('请上传5MB以内的 JPG、PNG 或 WebP 商品图片');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) throw new Error('图片文件内容与格式不匹配');
  const path = `${uid}/products/uploads/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
  const uploaded = await supabase.storage.from('materials').upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) throw new Error('商品图片上传失败，请重试');
  const { data } = supabase.storage.from('materials').getPublicUrl(path);
  const canonical = canonicalMediaTree(data.publicUrl);
  const session = await supabase.auth.getSession();
  return hydrateMediaTree(canonical, new Headers({ Authorization: `Bearer ${session.data.session?.access_token || ''}`, apikey: backendAnonKey }));
}
