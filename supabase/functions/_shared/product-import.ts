import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { validateEndpoint } from './model-registry.ts';
import { responseBytes } from './audio-provider.ts';
import { mediaReference } from './private-media.ts';
import { jobEvent, type ProductionJob } from './production-jobs.ts';
import { ProductError, productText, productNumber, productUrl } from './product-contract.ts';

export async function fetchProductResource(raw: string, limit: number, accept: string) {
  let url = new URL(productUrl(raw));
  for (let redirects = 0; redirects <= 3; redirects++) {
    // 校验每跳DNS，不把用户Cookie/认证头带往商品站点。
    await validateEndpoint(`${url.origin}${url.pathname}`);
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit',
      headers: { Accept: accept }, signal: AbortSignal.timeout(15000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new ProductError('商品链接重定向超过上限');
      url = new URL(productUrl(new URL(location, url).href));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403, 404, 410, 422].includes(response.status)) throw new ProductError(`商品站点返回 HTTP ${response.status}，请粘贴可核对的商品资料`);
      throw new Error(`商品站点返回 HTTP ${response.status}`);
    }
    const bytes = await responseBytes(response, limit);
    return { bytes, url: url.href, type: response.headers.get('content-type') || '' };
  }
  throw new ProductError('商品链接无法读取');
}
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  .map(value => value.toString(16).padStart(2, '0')).join('');
function plain(value: unknown, max: number) {
  return productText(typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '', max);
}
export function extractProductHtml(html: string, url: string) {
  const products: Record<string, any>[] = [];
  const walk = (value: any, depth = 0) => {
    if (depth > 12 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    if ([value['@type']].flat().some(type => type === 'Product' || type === 'https://schema.org/Product')) products.push(value);
    if (value['@graph']) walk(value['@graph'], depth + 1);
    if (value.mainEntity) walk(value.mainEntity, depth + 1);
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) continue;
    try { walk(JSON.parse(match[2])); } catch { /* 非商品或损坏的结构化块不作为证据。 */ }
  }
  if (products.length !== 1) throw new ProductError(products.length ? '页面包含多个商品，请使用单个商品详情链接'
    : '页面未提供可核对的商品结构化数据，请改用商品资料文本');
  const product = products[0], offers = [product.offers || []].flat();
  const offer = offers.length === 1 && offers[0]['@type'] !== 'AggregateOffer' ? offers[0] : null;
  let price: number | null = null, currency: string | null = null;
  const warnings = ['标题、价格与库存来自页面声明，导入前请核对商家资料。'];
  if (offer?.price != null) {
    try { price = productNumber(offer.price); } catch { warnings.push('页面价格不符合金额格式，已留空。'); }
    if (typeof offer.priceCurrency === 'string' && /^[A-Z]{3}$/.test(offer.priceCurrency)) currency = offer.priceCurrency;
    if (!currency) { price = null; warnings.push('页面未提供币种，价格已留空。'); }
  }
  const images: string[] = [];
  for (const image of [product.image || []].flat().slice(0, 8)) {
    try { images.push(productUrl(new URL(typeof image === 'string' ? image : image.url || image.contentUrl, url).href)); } catch { /* 不可信图片不导入。 */ }
  }
  const name = plain(product.name, 200);
  if (!name) throw new ProductError('页面缺少商品标题');
  // InStock只表示可售，不能推断具体库存；单个Offer价格不能推断原价/促销。
  return { draft: { name, category: '其他', description: plain(product.description, 8000),
    original_price: price, sale_price: null, currency, stock: null, sales_count: null,
    selling_points: [], specs: [], images: [], cover_image: null, status: 'draft' },
    image_urls: [...new Set(images)], warnings,
    facts: { name, description: plain(product.description, 8000), price, currency, availability: plain(offer?.availability, 200) } };
}
export function extractProductText(content: string) {
  const name = content.match(/(?:^|\n)\s*(?:商品名称|名称|标题)\s*[:：]\s*([^\n]+)/)?.[1]
    || content.match(/【([^】]+)】/)?.[1];
  if (!name) throw new ProductError('请在商品资料中填写“商品名称：…”或包含【商品标题】');
  return { draft: { name: productText(name, 200, true), category: '其他', description: content,
    original_price: null, sale_price: null, currency: null, stock: null, sales_count: null,
    selling_points: [], specs: [], images: [], cover_image: null, status: 'draft' },
    image_urls: [], warnings: ['分享文案仅保留标题和原文。请手动核对价格、币种、库存和卖点。'],
    facts: { name: name.trim(), description: content } };
}
function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
export async function processProductImport(db: SupabaseClient): Promise<boolean> {
  const claim = await db.rpc('claim_production_job', { p_kind: 'product_import', p_job_id: null });
  if (claim.error) throw new Error('商品提取任务领取失败');
  if (!claim.data) return false;
  const job = claim.data as ProductionJob & { attempts: number };
  let lost = false, saved = !!job.evidence;
  const timer = setInterval(() => { void jobEvent(db, job, 'heartbeat').catch(() => { lost = true; }); }, 30000);
  try {
    if (job.resolution) { await jobEvent(db, job, job.resolution.event, job.resolution.data); return true; }
    if (!saved) {
      if (job.attempts > 3) throw new ProductError('商品读取超过三次上限，请检查来源后重新创建');
      const input = job.payload;
      const fetched = input.mode === 'url' ? await fetchProductResource(input.content, 1024 * 1024, 'text/html,application/xhtml+xml')
        : { bytes: new TextEncoder().encode(input.content), url: '', type: 'text/plain' };
      if (input.mode === 'url' && !/text\/html|application\/xhtml\+xml/i.test(fetched.type)) throw new ProductError('商品链接返回的内容不是网页');
      const extracted = input.mode === 'url' ? extractProductHtml(new TextDecoder().decode(fetched.bytes), fetched.url)
        : extractProductText(input.content);
      const images: string[] = [];
      for (const raw of extracted.image_urls) {
        if (lost) throw new Error('商品提取租约已失效');
        try {
          const image = await fetchProductResource(raw, 5 * 1024 * 1024, 'image/jpeg,image/png,image/webp');
          const type = imageType(image.bytes);
          if (!type) throw new ProductError('商品图片格式不支持');
          const path = `${job.user_id}/products/imports/${job.id}/${await hash(image.bytes)}.${type.split('/')[1]}`;
          const uploaded = await db.storage.from('materials').upload(path, image.bytes, { contentType: type, upsert: true });
          if (uploaded.error) throw new Error('商品图片保存失败');
          images.push(mediaReference(Deno.env.get('SUPABASE_URL')!, 'materials', path));
        } catch {
          extracted.warnings.push('一张来源图片未能读取或保存，请上传商品实拍图。');
        }
      }
      const result = { draft: { ...extracted.draft, images, cover_image: images[0] || null }, warnings: extracted.warnings,
        source: { mode: input.mode, url: fetched.url || null, content_hash: await hash(fetched.bytes),
          observed_at: new Date().toISOString(), facts: extracted.facts } };
      if (lost) throw new Error('商品提取租约已失效');
      await jobEvent(db, job, 'checkpoint', result); job.evidence = result; saved = true;
    }
    await jobEvent(db, job, 'completed', job.evidence);
  } catch (cause) {
    if (cause instanceof ProductError && !saved) await jobEvent(db, job, 'failed', { error: cause.message });
    else await jobEvent(db, job, 'retry', { error: '商品来源读取或归档暂时失败，后台按原任务恢复' });
  } finally { clearInterval(timer); }
  return true;
}
