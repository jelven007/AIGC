import type { Product } from '@/types/types';
export function productPrice(product: Pick<Product, 'sale_price' | 'original_price' | 'currency'>): string {
  const price = product.sale_price ?? product.original_price;
  return price == null ? '未设置价格' : `${product.currency || '币种未提供'} ${Number(price).toFixed(2)}`;
}
