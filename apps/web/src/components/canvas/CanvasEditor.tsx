import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReactFlow, ReactFlowProvider, Background, MiniMap, useReactFlow, SelectionMode,
  type OnNodesChange, type OnEdgesChange, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Undo2, Redo2, Save, Download, FolderOpen, MousePointer2, Hand, Type, ImageIcon, Video,
  Music2, Group, Minus, Plus, Maximize, Settings2, Copy, RefreshCw } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanvasHistory } from '@/hooks/useCanvasHistory';
import { useCanvasPersistence } from '@/hooks/useCanvasPersistence';
import { useCanvasImageJob } from '@/hooks/useCanvasImageJob';
import { useWorkspaceModels } from '@/hooks/useWorkspaceModels';
import { useCredits } from '@/hooks/useCredits';
import { cleanCanvasDocument, newCanvasNode, connectionError, imageNodeInput, deleteNodes, duplicateNodes,
  groupNodes, ungroupNodes, CANVAS_NODE_LIMIT } from '@/lib/canvasDocument';
import { createCanvasProject, assertCanvasMediaOwner } from '@/api/canvasProjects';
import { writeCanvasDraft, type CanvasDraft } from '@/lib/canvasPersistence';
import { canonicalMedia } from '@/lib/privateMedia';
import { mediaPreview } from '@/api/media';
import { uploadMaterialAsset } from '@/api/materialAssets';
import type { CanvasDocument, CanvasProject, CanvasNode as Node, CanvasEdge, CanvasNodeType, CanvasNodeData } from '@/types/canvas';
import type { ProductionJob } from '@/api/productionJobs';
import type { Material } from '@/types/types';
import CanvasNode from './CanvasNode';
import CanvasInspector from './CanvasInspector';
import CanvasMaterials from './CanvasMaterials';

const nodeTypes = { text: CanvasNode, image: CanvasNode, video: CanvasNode, audio: CanvasNode, group: CanvasNode };
const tools = [{ type: 'text', label: '文字', icon: Type }, { type: 'image', label: '图片', icon: ImageIcon },
  { type: 'video', label: '视频', icon: Video }, { type: 'audio', label: '音频', icon: Music2 }, { type: 'group', label: '分组', icon: Group }] as const;
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface Props { project: CanvasProject; draft: CanvasDraft | null; warning: string; reload: () => void }
function Editor({ project, draft, warning, reload }: Props) {
  const initialDocument = draft?.document || project.document;
  const [title, setTitle] = useState(draft?.title || project.title), [notice, setNotice] = useState(warning);
  const [mode, setMode] = useState('select'), [inspectorOpen, setInspectorOpen] = useState(false);
  const [materials, setMaterials] = useState<{ nodeId?: string; type?: string } | null>(null);
  const [savingCopy, setSavingCopy] = useState(false), [working, setWorking] = useState(false);
  const copyId = useRef<string>(), workingRef = useRef(false), active = useRef(true), stageRef = useRef(title); stageRef.current = title;
  const { history, document: doc, change, dispatch, latest } = useCanvasHistory(initialDocument);
  const persistence = useCanvasPersistence(project, draft?.title || project.title, initialDocument, !!draft && draft.baseRevision !== project.revision);
  const flow = useReactFlow<Node, CanvasEdge>(), stage = persistence.stage, mobile = useIsMobile(), navigate = useNavigate();
  const stageDocument = useCallback((update: CanvasDocument | ((value: CanvasDocument) => CanvasDocument), record = true) => {
    const next = typeof update === 'function' ? update(latest.current) : update;
    change(next, record); stage(stageRef.current, next);
  }, [change, latest, stage]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { stage(title, doc); }, [doc, title, stage]);
  const selected = doc.nodes.filter(n => n.selected), node = selected.length === 1 ? selected[0] : undefined;
  const nodeRef = useRef(node); nodeRef.current = node;
  const settings = useWorkspaceModels(project.user_id), credits = useCredits();
  const model = settings.models.find(m => m.enabled && m.slot === 'image.primary');
  const onJob = useCallback(async (id: string, job: ProductionJob) => {
    if (!active.current || !latest.current.nodes.some(n => n.id === id)) return;
    const task = { request_key: job.request_key, jobId: job.id, status: job.status, progress: job.progress,
      error: job.error_message || undefined };
    const next = { ...latest.current, nodes: latest.current.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, task,
      ...(job.status === 'completed' && job.result?.url ? { url: job.result.url, materialId: undefined } : {}) } } : n) };
    stageDocument(next, false);
    await persistence.save();
    if (active.current && ['completed', 'failed', 'cancelled'].includes(job.status)) void credits.refresh();
  }, [latest, stageDocument, persistence.save, credits.refresh]);
  const imageJob = useCanvasImageJob(project.user_id, project.id, initialDocument, onJob);
  let reason = '';
  if (node?.type === 'image') {
    try {
      const input = imageNodeInput(doc, node.id);
      if (!model) reason = settings.error || '请先在模型设置中启用图片接口';
      else if ('reference_image' in input && !model.image_capabilities?.reference) reason = '当前模型不支持参考图片';
      else if (settings.price === null) reason = settings.priceError || '请等待积分价格读取，或刷新配置';
      else if (persistence.hasConflict) reason = '请先解决画布保存冲突';
    } catch (cause) { reason = cause instanceof Error ? cause.message : '图片输入无效'; }
  }
  const safe = (operation: () => void) => { try { operation(); setNotice(''); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '操作失败'); } };
  const updateNode = (patch: Partial<CanvasNodeData>) => {
    const id = nodeRef.current?.id; if (!id) return;
    stageDocument(current => ({ ...current, nodes: current.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) }));
  };
  const add = (type: CanvasNodeType) => safe(() => {
    if (latest.current.nodes.length >= CANVAS_NODE_LIMIT) throw new Error('每个画布最多200个节点');
    const area = document.querySelector('.canvas-stage')!.getBoundingClientRect();
    const position = flow.screenToFlowPosition({ x: area.x + area.width / 2 - 140, y: area.y + area.height / 2 - 120 });
    let avoidedGroup = false;
    while (true) {
      const overlap = latest.current.nodes.find(n => !n.parentId && (n.type === 'group'
        ? position.x < n.position.x + (n.width || 280) && position.x + 280 > n.position.x
          && position.y < n.position.y + (n.height || 300) && position.y + 300 > n.position.y
        : Math.abs(n.position.x - position.x) < 60 && Math.abs(n.position.y - position.y) < 60));
      if (!overlap) break;
      if (overlap.type === 'group') {
        position.x = overlap.position.x + (overlap.width || 280) + 24; avoidedGroup = true;
      } else { position.x += 64; position.y += 64; }
    }
    const created = { ...newCanvasNode(type, position), selected: true };
    stageDocument(current => ({ ...current, nodes: [...current.nodes.map(n => ({ ...n, selected: false })), created] }));
    if (avoidedGroup) void flow.setCenter(position.x + 140, position.y + 120, { zoom: flow.getZoom() });
    if (mobile) setInspectorOpen(true);
  });
  const remove = () => safe(() => {
    const ids = latest.current.nodes.filter(n => n.selected).map(n => n.id);
    const edges = latest.current.edges.filter(e => e.selected).map(e => e.id);
    stageDocument(current => ({ ...deleteNodes(current, ids), edges: current.edges.filter(e => !edges.includes(e.id) && !ids.includes(e.source) && !ids.includes(e.target)) }));
  });
  const duplicate = () => safe(() => stageDocument(current => duplicateNodes(current, current.nodes.filter(n => n.selected).map(n => n.id))));
  const group = () => safe(() => stageDocument(current => groupNodes(current, current.nodes.filter(n => n.selected).map(n => n.id))));
  const save = () => { void persistence.save().catch(() => {}); };
  const exportProject = () => safe(() => downloadBlob(new Blob([JSON.stringify(cleanCanvasDocument(latest.current), null, 2)], { type: 'application/json' }), `${title || '画布'}.json`));
  const saveCopy = async () => {
    if (savingCopy) return; setSavingCopy(true);
    try {
      copyId.current ||= crypto.randomUUID();
      const document = cleanCanvasDocument(latest.current);
      // A running request belongs to its original canvas, even when saving a copy.
      document.nodes = document.nodes.map(n => { const { task: _task, ...data } = n.data; return { ...n, data }; });
      const saved = await createCanvasProject(project.user_id, copyId.current, `${title} 副本`.slice(0, 200), document);
      if (active.current) navigate(`/canvas/${saved.id}`);
    } catch (cause) { if (active.current) setNotice(cause instanceof Error ? cause.message : '另存失败'); }
    finally { if (active.current) setSavingCopy(false); }
  };
  const connect = (value: Connection) => safe(() => {
    const error = connectionError(latest.current, value); if (error) throw new Error(error);
    stageDocument(current => ({ ...current, edges: [...current.edges, { ...value, id: crypto.randomUUID() }] }));
  });
  const setSource = (type: 'text' | 'image', source: string) => safe(() => {
    const id = nodeRef.current?.id; if (!id) return;
    const current = latest.current, edges = current.edges.filter(e => e.target !== id || current.nodes.find(n => n.id === e.source)?.type !== type);
    const next = { ...current, edges };
    if (source) { const edge = { id: crypto.randomUUID(), source, target: id }; const error = connectionError(next, edge); if (error) throw new Error(error); edges.push(edge); }
    stageDocument(next);
  });
  const runAsync = async (operation: () => Promise<void>) => {
    if (workingRef.current) return;
    workingRef.current = true; setWorking(true); setNotice('');
    try { await operation(); }
    catch (cause) { if (active.current) setNotice(cause instanceof Error ? cause.message : '操作失败'); }
    finally { workingRef.current = false; if (active.current) setWorking(false); }
  };
  const generate = () => void runAsync(async () => {
    const id = nodeRef.current?.id; if (!id || reason || imageJob.busy) return;
    const input = imageNodeInput(latest.current, id); assertCanvasMediaOwner(latest.current, project.user_id);
    const balance = await credits.refresh();
    if (!active.current) return;
    if (balance.error || !balance.data) throw new Error('积分读取失败，请重试');
    if (settings.price === null || balance.data.left < settings.price) throw new Error('积分不足或价格未确认');
    await persistence.save();
    if (!active.current || !latest.current.nodes.some(n => n.id === id)) return;
    await imageJob.start(id, input);
  });
  const useMaterial = (material: Material) => safe(() => {
    if (!['image', 'video', 'audio'].includes(material.type)) throw new Error('不支持的素材类型');
    const current = latest.current, target = materials?.nodeId && current.nodes.find(n => n.id === materials.nodeId);
    const created = target || newCanvasNode(material.type as CanvasNodeType, flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    const next = { ...created, selected: true, data: { ...created.data, name: material.name, materialId: material.id, url: material.url } };
    if (!target && current.nodes.length >= CANVAS_NODE_LIMIT) throw new Error('每个画布最多200个节点');
    const updated = { ...current, nodes: target ? current.nodes.map(n => n.id === target.id ? next : n)
      : [...current.nodes.map(n => ({ ...n, selected: false })), next] };
    assertCanvasMediaOwner(updated, project.user_id); stageDocument(updated);
  });
  const mediaOperation = (kind: 'download' | 'video' | 'library' | 'refresh') => void runAsync(async () => {
    const selected = nodeRef.current; if (!selected?.data.url) return;
    assertCanvasMediaOwner(latest.current, project.user_id);
    const url = await mediaPreview(selected.data.url, project.user_id); if (!active.current) return;
    if (kind === 'video') { await persistence.save(); if (active.current) navigate('/video/create', { state: { canvasMedia: {
      userId: project.user_id, type: selected.type, url: canonicalMedia(url), name: selected.data.name,
    } } }); return; }
    if (kind === 'refresh') {
      stageDocument(current => ({ ...current, nodes: current.nodes.map(n => n.id === selected.id ? { ...n, data: { ...n.data, url } } : n) }));
      return;
    }
    const response = await fetch(url); if (!response.ok) throw new Error('素材读取失败，请重新读取素材');
    const blob = await response.blob(); if (!active.current) return;
    const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    if (kind === 'download') { downloadBlob(blob, `${selected.data.name}.${extension}`); return; }
    const material = await uploadMaterialAsset(new File([blob], `${selected.data.name}.${extension}`, { type: blob.type }), project.user_id, true);
    if (active.current) stageDocument(current => ({ ...current, nodes: current.nodes.map(n => n.id === selected.id ? { ...n, data: { ...n.data, materialId: material.id } } : n) }));
  });
  const onNodesChange: OnNodesChange<Node> = useCallback(changes => {
    const edit = changes.toArray().some(c => !['select', 'dimensions'].includes(c.type));
    stageDocument(current => ({ ...current, nodes: changes.applyTo(current.nodes) }), edit);
  }, [stageDocument]);
  const onEdgesChange: OnEdgesChange<CanvasEdge> = useCallback(changes => {
    stageDocument(current => ({ ...current, edges: changes.applyTo(current.edges) }), changes.toArray().some(c => c.type !== 'select'));
  }, [stageDocument]);
  const commands = useRef({ remove, duplicate, group, save }); commands.current = { remove, duplicate, group, save };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,video,audio,[contenteditable="true"],[role="dialog"]')) return;
      const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
      if (command && ['z', 'd', 's', 'g'].includes(key)) {
        event.preventDefault();
        if (key === 'z') dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        if (key === 'd') commands.current.duplicate(); if (key === 's') commands.current.save(); if (key === 'g') commands.current.group();
      } else if (key === 'delete' || key === 'backspace') { event.preventDefault(); commands.current.remove(); }
      else if (!command && key === 'v') setMode('select'); else if (!command && key === 'h') setMode('pan');
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [dispatch]);
  const renderedNodes = useMemo(() => doc.nodes.map(n => ({ ...n, dragHandle: '.canvas-node-header' })), [doc.nodes]);
  const inspector = <CanvasInspector node={node} document={doc} update={updateNode} connect={setSource} model={model} price={settings.price}
    generationError={imageJob.error} busy={imageJob.busy || working} reason={reason} generate={generate} refresh={() => void imageJob.refresh()}
    materials={() => setMaterials({ nodeId: node?.id, type: node?.type })} duplicate={duplicate} remove={remove}
    ungroup={() => safe(() => stageDocument(current => ungroupNodes(current, node!.id)))}
    download={() => mediaOperation('download')} sendToVideo={() => mediaOperation('video')} addToLibrary={() => mediaOperation('library')} refreshMedia={() => mediaOperation('refresh')} />;
  return <section className="canvas-editor" aria-label="创作画布编辑器">
    <header className="canvas-topbar"><button aria-label="返回画布列表" onClick={() => navigate('/canvas')}><ArrowLeft size={18} /></button>
      <div className="canvas-title"><input aria-label="画布名称" maxLength={200} value={title} onChange={e => { setTitle(e.target.value); stageRef.current = e.target.value; stage(e.target.value, latest.current); }} />
        <span role="status" className={persistence.status === '保存失败' ? 'canvas-save-error' : ''}>{persistence.status}</span></div>
      <div className="canvas-history"><button aria-label="撤销" title="撤销 Ctrl/Cmd+Z" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={17} /></button>
        <button aria-label="重做" title="重做 Ctrl/Cmd+Shift+Z" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={17} /></button></div>
      <div className="canvas-top-actions"><button aria-label="打开素材库" onClick={() => setMaterials({})}><FolderOpen size={17} /><span>素材库</span></button>
        <button aria-label="导出工程" onClick={exportProject}><Download size={17} /><span>导出</span></button>
        <button aria-label="另存画布" disabled={savingCopy} onClick={() => void saveCopy()}><Copy size={16} /><span>另存</span></button>
        <button className="canvas-primary" aria-label="保存画布" disabled={persistence.hasConflict} onClick={save}><Save size={16} /><span>保存</span></button></div>
    </header>
    {(notice || persistence.error) && <div className="canvas-notice" role="alert"><span>{notice || persistence.error}</span>
      {persistence.hasConflict ? <><button onClick={() => {
        if (window.confirm('重载会放弃当前本地编辑；可先导出或另存画布。继续重载？')) { writeCanvasDraft(project.user_id, project.id, null); reload(); }
      }}>重载云端</button><button disabled={savingCopy} onClick={() => void saveCopy()}>另存画布副本</button></>
        : <button onClick={() => { setNotice(''); void settings.refresh().catch(cause => setNotice(cause.message)); save(); }}><RefreshCw size={14} />重试</button>}</div>}
    <div className="canvas-body"><div className="canvas-stage">
      <ReactFlow<Node, CanvasEdge> nodes={renderedNodes} edges={doc.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={connect} isValidConnection={edge => !connectionError(latest.current, edge)} minZoom={.1} maxZoom={4} defaultViewport={initialDocument.viewport}
        onNodeDragStart={() => dispatch({ type: 'begin' })} onNodeDragStop={() => dispatch({ type: 'commit' })}
        onSelectionDragStart={() => dispatch({ type: 'begin' })} onSelectionDragStop={() => dispatch({ type: 'commit' })}
        onMoveEnd={(_, viewport) => stageDocument(current => ({ ...current, viewport }), false)}
        onNodeDoubleClick={() => setInspectorOpen(true)} deleteKeyCode={null} panOnDrag={mode === 'pan' ? true : [1, 2]}
        panActivationKeyCode="Space" nodesDraggable={mode !== 'pan'} selectionOnDrag={mode === 'select'} selectionMode={SelectionMode.Partial} multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        forceColorMode="dark" defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: '#ec9856', strokeWidth: 2 } }}
        proOptions={{ hideAttribution: true }}>
        <Background gap={24} size={1} color="#38383f" />
        <MiniMap pannable zoomable nodeColor={n => n.type === 'group' ? '#333039' : '#a16a45'} maskColor="rgba(12,12,16,.65)" />
      </ReactFlow>
      {imageJob.busy && <div className="canvas-active-job" role="status"><span>有图片任务正在生成或待确认</span><button aria-label="刷新画布图片任务" onClick={() => void imageJob.refresh()}><RefreshCw size={14} />刷新进度</button>
        {imageJob.error && <span>{imageJob.error}</span>}</div>}
      <div className="canvas-tools" role="toolbar" aria-label="画布工具">
        <button aria-label="选择工具" title="选择 V" aria-pressed={mode === 'select'} onClick={() => setMode('select')}><MousePointer2 size={19} /></button>
        <button aria-label="平移工具" title="平移 H / 空格" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}><Hand size={19} /></button><hr />
        {tools.map(tool => <button key={tool.type} aria-label={`添加${tool.label}`} title={`添加${tool.label}`} onClick={() => add(tool.type)}><tool.icon size={19} /></button>)}
        <hr /><button aria-label="分组选中节点" title="分组选中节点" disabled={!selected.length} onClick={group}><Group size={19} /></button>
        <button aria-label="打开节点属性" title="节点属性" onClick={() => setInspectorOpen(true)}><Settings2 size={19} /></button>
      </div>
      {!doc.nodes.length && <div className="canvas-empty"><p className="canvas-eyebrow">A SPACE FOR YOUR NEXT IDEA</p><h1>让灵感，自由生长。</h1><p>添加文字，连接图片，把想法变成画面。</p>
        <button className="canvas-primary" onClick={() => add('text')}><Plus size={17} />写下第一个灵感</button></div>}
      <div className="canvas-zoom"><button aria-label="缩小画布" onClick={() => void flow.zoomOut()}><Minus size={16} /></button>
        <span>{Math.round(doc.viewport.zoom * 100)}%</span><button aria-label="放大画布" onClick={() => void flow.zoomIn()}><Plus size={16} /></button>
        <button aria-label="适应全部节点" onClick={() => void flow.fitView({ padding: .2, maxZoom: 1 })}><Maximize size={16} /></button></div>
      <div className="canvas-node-count">{doc.nodes.length} / 200 节点 {selected.length > 1 && `· 已选 ${selected.length} 个`}</div>
    </div>
      {!mobile && <aside className="canvas-inspector" aria-label="节点属性">{selected.length > 1 ? <div className="canvas-inspector-fields"><h2>已选 {selected.length} 个节点</h2>
        <button onClick={group}>分组选中节点</button><button onClick={duplicate}>复制节点</button><button onClick={remove}>删除节点</button></div> : inspector}</aside>}
    </div>
    <Sheet open={inspectorOpen && mobile} onOpenChange={setInspectorOpen}><SheetContent className="canvas-inspector-sheet"><SheetTitle>节点属性</SheetTitle><SheetDescription>编辑内容、连接输入与生成图片。</SheetDescription>{inspector}</SheetContent></Sheet>
    <CanvasMaterials userId={project.user_id} open={!!materials} close={() => setMaterials(null)} choose={useMaterial} type={materials?.type} />
  </section>;
}
export default function CanvasEditor(props: Props) { return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>; }
