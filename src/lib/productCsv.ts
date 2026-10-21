import { productDraft } from '../../supabase/functions/_shared/product-contract';
import type { Product } from '@/types/types';
export const PRODUCT_CSV_HEADERS = ['商品名称', '分类', '子分类', '描述', '原价', '售价', '库存', '状态', '销量', '卖点', '币种'];
export function parseProductCsv(raw: string) {
  if (new TextEncoder().encode(raw).length > 1024 * 1024) throw new Error('CSV文件不能超过1MB');
  const rows: string[][] = [], row: string[] = [];
  let cell = '', quoted = false;
  const text = raw.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else if (!quoted && cell) throw new Error('CSV引号位置不正确');
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell); if (row.some(value => value !== '')) rows.push([...row]); row.length = 0; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV引号未闭合');
  row.push(cell); if (row.some(value => value !== '')) rows.push([...row]);
  const header = rows.shift();
  if (!header || !PRODUCT_CSV_HEADERS.every((value, index) => header[index]?.trim() === value)) throw new Error('请使用当前导入模板，表头或币种列缺失');
  if (!rows.length || rows.length > 100) throw new Error('一次导入1–100个商品');
  const errors: string[] = [], drafts: ReturnType<typeof productDraft>[] = [];
  rows.forEach((columns, index) => {
    try {
      if (columns.length !== header.length) throw new Error('列数与表头不一致');
      drafts.push(productDraft({ name: columns[0], category: columns[1], sub_category: columns[2], description: columns[3],
        original_price: columns[4], sale_price: columns[5], stock: columns[6], status: columns[7] || 'draft',
        sales_count: columns[8], selling_points: columns[9].split('|').filter(Boolean), currency: columns[10], images: [], specs: [] }));
    } catch (cause) { errors.push(`第${index + 2}条记录：${cause instanceof Error ? cause.message : '内容非法'}`); }
  });
  if (errors.length) throw new Error(errors.join('\n'));
  return drafts;
}
const cell = (value: unknown) => {
  const raw = value == null ? '' : String(value);
  const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
export function productCsv(products: Partial<Product>[]) {
  return '\uFEFF' + [PRODUCT_CSV_HEADERS, ...products.map(product => [product.name, product.category, product.sub_category,
    product.description, product.original_price, product.sale_price, product.stock, product.status, product.sales_count,
    product.selling_points?.join('|'), product.currency])].map(row => row.map(cell).join(',')).join('\r\n');
}
