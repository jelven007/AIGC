import type { CanvasDocument, CanvasNode, CanvasNodeData } from '@/types/canvas';
import type { ModelCatalogEntry } from '@/api/modelSettings';
import { Copy, Trash2, Wand2, Download, Film, FolderPlus, RefreshCw } from 'lucide-react';
import { canvasNodeNames } from '@/lib/canvasDocument';
interface Props {
  node?: CanvasNode; document: CanvasDocument; update: (patch: Partial<CanvasNodeData>) => void;
  connect: (type: 'text' | 'image', source: string) => void;
  model?: ModelCatalogEntry; price: number | null; generationError: string; busy: boolean; reason: string;
  generate: () => void; refresh: () => void; materials: () => void; duplicate: () => void; remove: () => void;
  ungroup: () => void; download: () => void; sendToVideo: () => void; addToLibrary: () => void; refreshMedia: () => void;
}
export default function CanvasInspector(props: Props) {
  const { node, document, update } = props;
  if (!node) return <div className="canvas-inspector-empty"><p className="canvas-eyebrow">YOUR CREATIVE SPACE</p><h2>让灵感连接起来</h2>
    <p>从左侧添加节点，或打开素材库。</p><div className="canvas-flow-hint"><span>文字</span><i>→</i><span>图片</span></div>
    <p>拖动圆形端口，连接文字或参考图片。点击生成，结果会回到图片节点。</p><small>Shift 多选 · 空格平移<br />⌘ / Ctrl + Z 撤销 · S 保存</small></div>;
  return <div className="canvas-inspector-fields">
    <div className="canvas-inspector-heading"><h2>{canvasNodeNames[node.type]}属性</h2><small>{node.type === 'group' ? '组织你的创作' : '灵感的每一处细节'}</small></div>
    <label>节点名称<input aria-label="节点名称" maxLength={200} value={node.data.name} onChange={e => update({ name: e.target.value })} /></label>
    {node.type === 'text' && <label>文字内容<textarea aria-label="文字内容" rows={8} maxLength={8000} value={node.data.text || ''}
      placeholder="描述场景、光线与细节…" onChange={e => update({ text: e.target.value })} /><small>{node.data.text?.length || 0} / 8000</small></label>}
    {['image', 'video', 'audio'].includes(node.type) && <button onClick={props.materials}><FolderPlus size={16} />{node.data.url ? '更换素材' : '选择或上传素材'}</button>}
    {node.type === 'image' && <>
      <label>文字来源<select aria-label="文字来源" value={document.edges.find(e => e.target === node.id && document.nodes.find(n => n.id === e.source)?.type === 'text')?.source || ''}
        onChange={e => props.connect('text', e.target.value)}><option value="">使用本节点描述</option>
        {document.nodes.filter(n => n.type === 'text').map(n => <option key={n.id} value={n.id}>{n.data.name}</option>)}</select></label>
      <label>图片描述<textarea aria-label="图片描述" rows={5} maxLength={8000} value={node.data.prompt || ''} placeholder="写下想生成的画面…"
        onChange={e => update({ prompt: e.target.value })} /></label>
      <label>参考图片<select aria-label="参考图片" value={document.edges.find(e => e.target === node.id && document.nodes.find(n => n.id === e.source)?.type === 'image')?.source || ''}
        onChange={e => props.connect('image', e.target.value)}><option value="">不使用参考图片</option>
        {document.nodes.filter(n => n.type === 'image' && n.id !== node.id).map(n => <option key={n.id} value={n.id}>{n.data.name}</option>)}</select></label>
      <div className="canvas-field-pair"><label>尺寸<select aria-label="图片尺寸" value={node.data.size || '1024x1024'} onChange={e => update({ size: e.target.value })}>
        <option value="1024x1024">1:1</option><option value="1536x1024">3:2</option><option value="1024x1536">2:3</option></select></label>
        <label>质量<select aria-label="图片质量" value={node.data.quality || 'medium'} onChange={e => update({ quality: e.target.value })}>
          <option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="auto">自动</option></select></label></div>
      <div className="canvas-model-info"><strong>{props.model?.name || '尚未启用图片模型'}</strong>
        <span>{props.price === null ? '积分价格尚未确认' : `${props.price} 积分 / 次`}</span><small>{props.model?.image_capabilities?.reference ? '支持文字与参考图生成' : '支持文字生成'}</small></div>
      <button className="canvas-primary" disabled={props.busy || !!props.reason} onClick={props.generate}><Wand2 size={16} />{props.busy ? '图片任务进行中' : '生成图片'}</button>
      {props.reason && <p className="canvas-field-note">{props.reason}</p>}
      {props.generationError && <p className="canvas-notice" role="alert">{props.generationError}</p>}
      {props.busy && <button onClick={props.refresh}><RefreshCw size={15} />刷新任务进度</button>}
    </>}
    {node.data.url && <div className="canvas-media-actions"><button onClick={props.download}><Download size={15} />下载素材</button><button onClick={props.refreshMedia}><RefreshCw size={15} />重新读取素材</button>
      {['image', 'video'].includes(node.type) && <button onClick={props.sendToVideo}><Film size={15} />用于视频创作</button>}
      {node.type === 'image' && !node.data.materialId && <button onClick={props.addToLibrary}><FolderPlus size={15} />加入素材库</button>}</div>}
    {node.type === 'group' && <button onClick={props.ungroup}>解除分组</button>}
    <div className="canvas-node-actions"><button onClick={props.duplicate} aria-label="复制节点"><Copy size={15} />复制</button>
      <button onClick={props.remove} aria-label="删除节点"><Trash2 size={15} />删除</button></div>
  </div>;
}
