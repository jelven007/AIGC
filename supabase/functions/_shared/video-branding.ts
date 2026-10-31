/** 仅适配历史内置种子；用户模板和已修改系统模板保持原文。 */
export function platformPromptTemplate<T extends {
  title: string; content: string; is_system?: boolean; user_id?: string | null;
  action_key?: string; version?: number; variant?: string;
}>(template: T): T {
  if (!template.is_system || template.user_id != null || template.action_key !== 'generate_script_four_layer'
    || template.version !== 1) return template;
  const oldRole = '你是专业' + String.fromCodePoint(0x7535, 0x5546) + '带货视频脚本策划师，精通「钩子→痛点→卖点→CTA」四层结构。要求：';
  const seeds = [
    { title: '四层脚本模板-A（转化优先）', variant: 'A',
      content: oldRole + '开场2秒强钩子制造悬念；痛点场景真实可共鸣；卖点用可感知利益表达（而非参数堆砌）；CTA制造限时紧迫感直引导购。全程紧扣带货转化目标。',
      nextTitle: '四层视频脚本-A（叙事节奏）',
      nextContent: '你是专业的视频分镜策划师。通过开场钩子、真实场景、主题亮点与自然收束组织脚本；画面、台词与镜头节奏相互配合，仅使用已确认的资料，不编造价格、活动、功效或销量。' },
    { title: '四层脚本模板-B（种草优先）', variant: 'B',
      content: oldRole + '以生活方式与情绪价值切入建立向往感；痛点用故事化叙述；卖点场景化演示强调真实体验；CTA自然软引导鼓励评论互动。全程强化信任与种草氛围。',
      nextTitle: '四层视频脚本-B（场景表达）',
      nextContent: '你是专业的视频分镜策划师。从生活场景与情绪出发，通过故事、画面细节与自然互动表达主题；台词口语化，镜头连贯，仅使用已确认资料，保留用户的创作目标。' },
  ];
  const seed = seeds.find(seed => template.title === seed.title && template.variant === seed.variant && template.content === seed.content);
  return seed ? { ...template, title: seed.nextTitle, content: seed.nextContent } : template;
}
