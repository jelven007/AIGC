import type { CanvasDocument, CanvasNode, CanvasNodeType, CanvasEdge } from '@/types/canvas';

export const CANVAS_NODE_LIMIT = 200;
export const CANVAS_BYTE_LIMIT = 2 * 1024 * 1024;
/** JSONB does not retain object key order; equality must compare stable keys. */
export function canvasJsonKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export const canvasNodeNames: Record<CanvasNodeType, string> = {
  text: '文字', image: '图片', video: '视频', audio: '音频', group: '分组',
};
export const emptyCanvasDocument = (): CanvasDocument => ({
  schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
});
export function newCanvasNode(type: CanvasNodeType, position = { x: 0, y: 0 }): CanvasNode {
  return { id: crypto.randomUUID(), type, position, data: { name: canvasNodeNames[type],
    ...(type === 'text' ? { text: '' } : {}),
    ...(type === 'image' ? { prompt: '', size: '1024x1024', quality: 'medium' } : {}) },
    ...(type === 'group' ? { width: 680, height: 380, style: { width: 680, height: 380 } } : {}) };
}
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7;
export function validateCanvasDocument(value: unknown): CanvasDocument {
  const document = value as CanvasDocument;
  if (!document || document.schemaVersion !== 1) throw new Error('不支持的画布工程版本');
  if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)
    || document.nodes.length > CANVAS_NODE_LIMIT || document.edges.length > CANVAS_NODE_LIMIT * 2) throw new Error('画布节点或连线数量超限');
  if (new TextEncoder().encode(JSON.stringify(document)).length > CANVAS_BYTE_LIMIT) throw new Error('画布工程超过2MB');
  if (!document.viewport || !finite(document.viewport.x) || !finite(document.viewport.y)
    || !finite(document.viewport.zoom) || document.viewport.zoom < .1 || document.viewport.zoom > 4) throw new Error('画布视区坐标非法');
  const ids = new Set<string>();
  for (const node of document.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || node.id.length > 100 || ids.has(node.id)) throw new Error('节点标识无效或重复');
    ids.add(node.id);
    if (!Object.prototype.hasOwnProperty.call(canvasNodeNames, node.type) || !node.position || !finite(node.position.x) || !finite(node.position.y)) throw new Error('节点类型或坐标非法');
    if (!node.data || typeof node.data.name !== 'string' || node.data.name.length > 200) throw new Error('节点名称非法');
    for (const key of ['text', 'prompt'] as const) {
      if (node.data[key] !== undefined && (typeof node.data[key] !== 'string' || node.data[key]!.length > 8000)) throw new Error('文字或描述超过8000字');
    }
    if (node.data.url !== undefined && (typeof node.data.url !== 'string' || !/^https?:\/\//i.test(node.data.url)
      || node.data.url.length > 4096)) throw new Error('媒体地址非法');
    if (node.type === 'group' && (!finite(node.width) || !finite(node.height) || node.width! < 100 || node.height! < 100)) throw new Error('分组尺寸非法');
  }
  for (const node of document.nodes) {
    if (node.parentId && (!ids.has(node.parentId) || document.nodes.find(n => n.id === node.parentId)?.type !== 'group'
      || node.type === 'group')) throw new Error('分组归属非法');
  }
  const checked: CanvasDocument = { ...document, edges: [] };
  const edgeIds = new Set<string>();
  for (const edge of document.edges) {
    if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id) || connectionError(checked, edge)) throw new Error('连线无效、重复或存在循环');
    edgeIds.add(edge.id); checked.edges.push(edge);
  }
  return cleanCanvasDocument(document);
}
/** UI selection and measurement state never enter the stored document. */
export function cleanCanvasDocument(document: CanvasDocument): CanvasDocument {
  return { schemaVersion: 1, viewport: document.viewport, nodes: document.nodes.map(node => ({
    id: node.id, type: node.type, position: node.position, data: { ...node.data },
    ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {}),
    ...(node.type === 'group' ? { width: node.width, height: node.height, style: { width: node.width!, height: node.height! } } : {}),
  })), edges: document.edges.map(({ id, source, target, sourceHandle, targetHandle }) =>
    ({ id, source, target, sourceHandle, targetHandle })) };
}
export function connectionError(document: CanvasDocument, edge: Pick<CanvasEdge, 'source' | 'target'>): string {
  const source = document.nodes.find(n => n.id === edge.source), target = document.nodes.find(n => n.id === edge.target);
  if (!source || !target) return '连线节点不存在';
  if (edge.source === edge.target) return '不能连接节点自身';
  if (target.type !== 'image' || !['text', 'image'].includes(source.type)) return '只支持文字或图片连接到图片节点';
  if (document.edges.some(e => e.source === edge.source && e.target === edge.target)) return '已有重复连线';
  if (document.edges.some(e => e.target === edge.target && document.nodes.find(n => n.id === e.source)?.type === source.type)) return '每个图片节点只能连接一个同类来源';
  const pending = [edge.target], seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === edge.source) return '连线不能形成循环';
    if (seen.has(id)) continue;
    seen.add(id); pending.push(...document.edges.filter(e => e.source === id).map(e => e.target));
  }
  return '';
}
export function imageNodeInput(document: CanvasDocument, id: string) {
  const node = document.nodes.find(n => n.id === id);
  if (node?.type !== 'image') throw new Error('请选择图片节点');
  const sources = document.edges.filter(e => e.target === id).map(e => document.nodes.find(n => n.id === e.source)!);
  const text = sources.find(n => n.type === 'text'), image = sources.find(n => n.type === 'image');
  const prompt = (text ? text.data.text : node.data.prompt)?.trim();
  if (!prompt) throw new Error(text ? '连接的文字节点内容为空' : '请输入图片描述');
  if (image && (!image.data.url || image.data.task && ['pending', 'running', 'unknown'].includes(image.data.task.status))) throw new Error('参考图片尚未完成');
  return { prompt, size: node.data.size || '1024x1024', quality: node.data.quality || 'medium',
    ...(image ? { mode: 'reference', reference_image: image.data.url } : { mode: 'generate' }) };
}
function absolutePosition(document: CanvasDocument, node: CanvasNode) {
  const parent = document.nodes.find(n => n.id === node.parentId);
  return parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
}
export function ungroupNodes(document: CanvasDocument, id: string): CanvasDocument {
  return { ...document, nodes: document.nodes.filter(n => n.id !== id).map(n => n.parentId === id
    ? { ...n, position: absolutePosition(document, n), parentId: undefined, extent: undefined } : n) };
}
export function deleteNodes(document: CanvasDocument, ids: string[]): CanvasDocument {
  let next = document;
  for (const id of ids) if (next.nodes.find(n => n.id === id)?.type === 'group') next = ungroupNodes(next, id);
  return { ...next, nodes: next.nodes.filter(n => !ids.includes(n.id)),
    edges: next.edges.filter(e => !ids.includes(e.source) && !ids.includes(e.target)) };
}
export function duplicateNodes(document: CanvasDocument, ids: string[]): CanvasDocument {
  const selected = document.nodes.filter(n => ids.includes(n.id) || n.parentId && ids.includes(n.parentId));
  if (document.nodes.length + selected.length > CANVAS_NODE_LIMIT) throw new Error('每个画布最多200个节点');
  const mapping = new Map(selected.map(n => [n.id, crypto.randomUUID()]));
  const copies = selected.map(n => {
    const { task: _task, ...data } = n.data;
    const grouped = n.parentId && mapping.has(n.parentId);
    const position = grouped ? n.position : absolutePosition(document, n);
    return { ...n, id: mapping.get(n.id)!, selected: false, data: { ...data, name: `${data.name} 副本`.slice(0, 200) },
      parentId: grouped ? mapping.get(n.parentId!) : undefined, extent: grouped ? 'parent' as const : undefined,
      position: grouped ? position : { x: position.x + 40, y: position.y + 40 } };
  });
  return { ...document, nodes: [...document.nodes, ...copies], edges: [...document.edges,
    ...document.edges.filter(e => mapping.has(e.source) && mapping.has(e.target)).map(e =>
      ({ ...e, id: crypto.randomUUID(), source: mapping.get(e.source)!, target: mapping.get(e.target)! }))] };
}
export function groupNodes(document: CanvasDocument, ids: string[]): CanvasDocument {
  const selected = document.nodes.filter(n => ids.includes(n.id) && n.type !== 'group' && !n.parentId);
  if (!selected.length) throw new Error('请选择未分组的内容节点');
  if (document.nodes.length >= CANVAS_NODE_LIMIT) throw new Error('每个画布最多200个节点');
  const x = Math.min(...selected.map(n => n.position.x)) - 24, y = Math.min(...selected.map(n => n.position.y)) - 56;
  const width = Math.max(...selected.map(n => n.position.x + (n.measured?.width || 280))) - x + 24;
  const height = Math.max(...selected.map(n => n.position.y + (n.measured?.height || 300))) - y + 24;
  const group = { ...newCanvasNode('group', { x, y }), width, height, style: { width, height } };
  return { ...document, nodes: [group, ...document.nodes.map(n => selected.includes(n)
    ? { ...n, parentId: group.id, extent: 'parent' as const, position: { x: n.position.x - x, y: n.position.y - y } } : n)] };
}
export function importCanvasDocument(value: unknown): CanvasDocument {
  const document = validateCanvasDocument(value), mapping = new Map(document.nodes.map(n => [n.id, crypto.randomUUID()]));
  return { ...document, nodes: document.nodes.map(n => {
    const { task: _task, ...data } = n.data;
    return { ...n, id: mapping.get(n.id)!, parentId: n.parentId ? mapping.get(n.parentId) : undefined, data };
  }), edges: document.edges.map(e => ({ ...e, id: crypto.randomUUID(), source: mapping.get(e.source)!, target: mapping.get(e.target)! })) };
}
