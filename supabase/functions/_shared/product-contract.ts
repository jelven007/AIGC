export const PRODUCT_CATEGORIES = ['服装配饰', '美妆护肤', '家居用品', '数码电器', '食品饮料', '母婴用品', '运动户外', '其他', '待分类'];
export class ProductError extends Error {}
export const productUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function productText(value: unknown, max: number, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    || required && !value.trim()) throw new ProductError('商品文本为空、过长或包含非法字符');
  return value.trim();
}
export function productNumber(value: unknown, quantity = false): number | null {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !(quantity ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(value))) {
    throw new ProductError(quantity ? '库存和销量须为非负整数' : '价格须为非负金额，最多两位小数');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > (quantity ? 2147483647 : 99999999.99)
    || quantity && !Number.isInteger(number) || !quantity && Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) {
    throw new ProductError('商品数值超出范围');
  }
  return number;
}
export function productUrl(value: unknown): string {
  const raw = productText(value, 2048, true);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProductError('请提供有效的 HTTPS 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || url.hostname === 'localhost' || !url.hostname.includes('.') || /^[\d.:[\]]+$/.test(url.hostname)
    || /\.(localhost|local|internal|lan|home|test)$/.test(url.hostname)
    || [...url.searchParams.keys()].some(key => /token|secret|api.?key|signature|authorization/i.test(key))) {
    throw new ProductError('请提供不含凭据的公网 HTTPS 地址');
  }
  url.hash = '';
  return url.href;
}
export function productDraft(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductError('商品参数非法');
  const input = raw as Record<string, unknown>;
  const name = productText(input.name, 200, true);
  const category = productText(input.category, 50, true);
  if (!PRODUCT_CATEGORIES.includes(category)) throw new ProductError('请选择商品分类');
  const original_price = productNumber(input.original_price), sale_price = productNumber(input.sale_price);
  if (original_price != null && sale_price != null && sale_price > original_price) throw new ProductError('促销价不能高于原价');
  const currency = productText(input.currency, 3) || null;
  if (currency && !/^[A-Z]{3}$/.test(currency) || (original_price != null || sale_price != null) && !currency) {
    throw new ProductError('设置价格时须填写三位币种代码，如 CNY 或 USD');
  }
  const selling_points = input.selling_points ?? [], specs = input.specs ?? [], images = input.images ?? [];
  if (!Array.isArray(selling_points) || selling_points.length > 6 || !Array.isArray(specs) || specs.length > 20
    || !Array.isArray(images) || images.length > 8) throw new ProductError('最多6个卖点、20个规格、8张图片');
  const normalizedImages = images.map(productUrl);
  if (new Set(normalizedImages).size !== normalizedImages.length) throw new ProductError('图片不可重复');
  const cover_image = input.cover_image ? productUrl(input.cover_image) : normalizedImages[0] || null;
  if (cover_image && !normalizedImages.includes(cover_image)) throw new ProductError('封面必须来自商品图片');
  const status = input.status ?? 'draft';
  if (!['active', 'inactive', 'draft'].includes(String(status))) throw new ProductError('商品状态非法');
  return { name, category, sub_category: productText(input.sub_category, 100) || null,
    description: productText(input.description, 8000) || null, original_price, sale_price, currency,
    stock: productNumber(input.stock, true), sales_count: productNumber(input.sales_count, true),
    selling_points: selling_points.map(value => productText(value, 300)).filter(Boolean),
    specs: specs.map(value => {
      if (!value || typeof value !== 'object') throw new ProductError('商品规格非法');
      return { name: productText(value.name, 100, true), value: productText(value.value, 500, true) };
    }), images: normalizedImages, cover_image, status: String(status) };
}
export function productImportInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductError('导入参数非法');
  const input = raw as Record<string, unknown>;
  if (!['url', 'text'].includes(String(input.mode))) throw new ProductError('请选择链接或文本提取');
  return { mode: String(input.mode), content: input.mode === 'url' ? productUrl(input.content)
    : productText(input.content, 8000, true) };
}
