import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Type, ImageIcon, Video, Music2, Layers } from 'lucide-react';
import type { CanvasNode as CanvasNodeType, CanvasNodeData } from '@/types/canvas';
import { canvasNodeNames } from '@/lib/canvasDocument';
const icons = { text: Type, image: ImageIcon, video: Video, audio: Music2, group: Layers };
function CanvasNode({ data: rawData, type, selected }: NodeProps) {
  const data = rawData as CanvasNodeData;
  const [failed, setFailed] = useState<string>();
  const Icon = icons[type! as CanvasNodeType['type']] || Layers;
  const kind = type as CanvasNodeType['type'];
  const pending = data.task && ['running', 'pending', 'unknown'].includes(data.task.status);
  return <div className={`canvas-node canvas-node-${kind}${selected ? ' is-selected' : ''}`}>
    {kind === 'image' && <Handle type="target" position={Position.Left} aria-label="图片输入" />}
    <div className="canvas-node-header"><Icon size={15} /><strong>{data.name}</strong><span>{canvasNodeNames[kind]}</span></div>
    {kind === 'text' && <div className="canvas-node-text">{data.text || <span>选择节点，在属性面板写下灵感…</span>}</div>}
    {kind === 'image' && <div className="canvas-node-image">
      {data.url && failed !== data.url ? <img src={data.url} alt={data.name} draggable={false} onError={() => setFailed(data.url)} />
        : <div className="canvas-media-empty"><ImageIcon size={30} /><span>{data.url ? '图片暂时无法预览' : '从灵感到画面'}</span><small>{data.url ? '在属性面板重新读取素材' : '上传素材，或连接文字生成图片'}</small></div>}
      {pending && <div className="canvas-task-progress"><span>生成中 {data.task?.progress || 0}%</span><progress value={data.task?.progress || 0} max={100} /></div>}
    </div>}
    {kind === 'video' && (data.url ? <video className="nodrag nowheel" src={data.url} controls preload="metadata" aria-label={data.name} />
      : <div className="canvas-media-empty"><Video size={30} /><span>放入你的镜头素材</span></div>)}
    {kind === 'audio' && (data.url ? <audio className="nodrag nowheel" src={data.url} controls preload="metadata" aria-label={data.name} />
      : <div className="canvas-media-empty"><Music2 size={30} /><span>声音也有自己的位置</span></div>)}
    {data.task?.status === 'failed' && <p className="canvas-node-error">{data.task.error || '图片生成失败'}</p>}
    {['text', 'image'].includes(kind) && <Handle type="source" position={Position.Right} aria-label={`${canvasNodeNames[kind]}输出`} />}
  </div>;
}
export default memo(CanvasNode);
