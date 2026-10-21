// 同一权限目录供业务接口、密钥签发和开放 API 页面使用。
export const API_PERMISSIONS = [
  ['video:create', '创建视频与素材分析'], ['video:read', '查看视频任务与批次报价'],
  ['image:create', '生成图片'], ['render:create', '渲染与多规格导出'],
  ['jobs:read', '查看生产任务、结果与媒体价格'], ['script:generate', '文本与脚本生成'],
  ['publish:create', '发布与取消待提交作品'], ['publish:read', '读取发布任务与已授权账号'],
  ['metrics:read', '读取平台指标'], ['metrics:sync', '同步平台指标'],
  ['audio:create', '配音、识别与声纹克隆'], ['avatar:create', '照片口播与口型同步'],
  ['knowledge:read', '读取知识库与检索引用'], ['knowledge:write', '知识索引与语义检索'],
  ['intelligence:read', '读取竞品与商品情报'], ['intelligence:write', '管理情报对象、采集与监控预算'],
  ['products:read', '读取商品库与提取任务'], ['products:write', '商品提取、保存与删除'],
] as const;
export const API_SCOPES: string[] = API_PERMISSIONS.map(([scope]) => scope);

export function productScope(action: string): string | undefined {
  return ['list', 'imports'].includes(action) ? 'products:read'
    : ['extract', 'save', 'delete'].includes(action) ? 'products:write' : undefined;
}
export function knowledgeScope(action: string): string | undefined {
  return ['catalog', 'jobs', 'context'].includes(action) ? 'knowledge:read'
    : action === 'create' ? 'knowledge:write' : undefined;
}
export function intelligenceScope(action: string): string | undefined {
  return action === 'catalog' ? 'intelligence:read'
    : ['save_target', 'collect', 'schedule', 'delete', 'import_product'].includes(action) ? 'intelligence:write' : undefined;
}
export function publishScope(action: string): string | undefined {
  return ['create', 'create_group', 'cancel'].includes(action) ? 'publish:create'
    : ['query', 'query_group', 'list'].includes(action) ? 'publish:read'
      : action === 'metrics' ? 'metrics:read' : action === 'sync' ? 'metrics:sync' : undefined;
}
export function accountScope(action: string): string | undefined {
  return ['list', 'creator'].includes(action) ? 'publish:read' : undefined;
}
