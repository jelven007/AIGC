/** 历史存储值仅用于兼容；模板分类统一显示为创作用途。 */
export function videoTemplateIndustry(industry: string): string {
  return industry === String.fromCodePoint(0x7535, 0x5546) ? '产品展示' : industry;
}
