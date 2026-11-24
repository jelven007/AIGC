import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowUpRight, FileUp, Trash2, Layers } from 'lucide-react';
import { createCanvasProject, deleteCanvasProject, listCanvasProjects, verifyCanvasMedia } from '@/api/canvasProjects';
import { emptyCanvasDocument, importCanvasDocument, CANVAS_BYTE_LIMIT } from '@/lib/canvasDocument';
import { writeCanvasDraft } from '@/lib/canvasPersistence';
import { readTaskReceipt, writeTaskReceipt } from '@/lib/taskReceipt';
import type { CanvasProject, CanvasDocument } from '@/types/canvas';

export default function CanvasProjects({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<CanvasProject[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const navigate = useNavigate(), file = useRef<HTMLInputElement>(null), active = useRef(true);
  const pending = useRef<{ id: string; title: string; document: CanvasDocument }>();
  const receiptKey = `aigc:canvas-create:${userId}`, receiptError = useRef('');
  useEffect(() => {
    const saved = readTaskReceipt<{ id: string; title: string; document: CanvasDocument }>(receiptKey,
      value => typeof value?.id === 'string' && typeof value?.title === 'string' && value?.document?.schemaVersion === 1);
    pending.current = saved.value || undefined; receiptError.current = saved.error;
    if (saved.error) setError(saved.error);
    else if (saved.value) setError('存在未确认的新建画布，请重试创建以恢复原工程');
  }, [receiptKey]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true);
    listCanvasProjects(userId, abort.signal).then(value => { if (active.current) { setProjects(value); setError(''); } })
      .catch(cause => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [userId, attempt]);
  const create = async (document = emptyCanvasDocument(), title = '未命名画布') => {
    if (busy) return; setBusy(true); setError('');
    try {
      if (receiptError.current) throw new Error(receiptError.current);
      pending.current ||= { id: crypto.randomUUID(), document, title };
      const value = pending.current;
      writeTaskReceipt(receiptKey, value);
      const saved = await createCanvasProject(userId, value.id, value.title, value.document);
      writeTaskReceipt(receiptKey, null);
      if (active.current) { pending.current = undefined; navigate(`/canvas/${saved.id}`); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '创建画布失败'); }
    finally { if (active.current) setBusy(false); }
  };
  const importFile = async (value?: File) => {
    if (!value || busy) return;
    try {
      if (value.size > CANVAS_BYTE_LIMIT) throw new Error('工程文件超过2MB');
      const document = importCanvasDocument(JSON.parse(await value.text()));
      await verifyCanvasMedia(document, userId);
      if (active.current) await create(document, value.name.replace(/\.json$/i, '').slice(0, 200) || '导入画布');
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '工程导入失败'); }
  };
  const remove = async (project: CanvasProject) => {
    const running = project.document.nodes.some(n => n.data.task && ['running', 'pending', 'unknown'].includes(n.data.task.status));
    if (!window.confirm(`删除“${project.title}”？${running ? '已提交的图片任务会继续执行，可在任务中心查看。' : '原素材将保留。'}`)) return;
    setBusy(true);
    try { await deleteCanvasProject(userId, project.id); writeCanvasDraft(userId, project.id, null);
      if (active.current) setProjects(values => values.filter(p => p.id !== project.id));
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '删除失败'); }
    finally { if (active.current) setBusy(false); }
  };
  return <section className="canvas-projects">
    <div className="canvas-projects-heading"><div><p className="canvas-eyebrow">CREATIVE SPACE</p><h1>创作画布</h1><p>把灵感、素材与图片生成，放在同一个创作空间。</p></div>
      <div className="canvas-actions"><button disabled={busy} onClick={() => file.current?.click()}><FileUp size={16} />导入工程</button>
        <button className="canvas-primary" disabled={busy} onClick={() => void create()}><Plus size={17} />{pending.current ? '重试创建' : '新建画布'}</button></div></div>
    <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
    {error && <div className="canvas-notice" role="alert">{error}<button onClick={() => setAttempt(a => a + 1)}>重试列表</button></div>}
    {loading ? <p role="status">正在读取画布…</p> : <div className="canvas-project-grid">
      <button className="canvas-new-project" disabled={busy} onClick={() => void create()}><Plus size={30} /><strong>开启新的创作</strong><span>文字 · 图片 · 视频 · 音频</span></button>
      {projects.map(project => <article className="canvas-project" key={project.id}>
        <button className="canvas-project-open" onClick={() => navigate(`/canvas/${project.id}`)} aria-label={`打开${project.title}`}>
          <div className="canvas-project-preview"><Layers size={32} /><span>{project.document.nodes.length} 个节点</span><ArrowUpRight size={18} /></div>
          <strong>{project.title}</strong><span>{new Date(project.updated_at).toLocaleString('zh-CN')}</span>
        </button><button className="canvas-project-delete" aria-label={`删除${project.title}`} disabled={busy} onClick={() => void remove(project)}><Trash2 size={15} /></button>
      </article>)}
    </div>}
  </section>;
}
