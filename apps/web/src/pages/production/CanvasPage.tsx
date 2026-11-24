import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { loadCanvasProject, assertCanvasMediaOwner } from '@/api/canvasProjects';
import { mediaPreview } from '@/api/media';
import { readCanvasDraft } from '@/lib/canvasPersistence';
import { canvasJsonKey } from '@/lib/canvasDocument';
import { canonicalMediaTree } from '@/lib/privateMedia';
import type { CanvasDraft } from '@/lib/canvasPersistence';
import type { CanvasProject } from '@/types/canvas';
import CanvasProjects from '@/components/canvas/CanvasProjects';
import CanvasEditor from '@/components/canvas/CanvasEditor';
import '@/components/canvas/canvas.css';

function OpenCanvas({ userId, id }: { userId: string; id: string }) {
  const [loaded, setLoaded] = useState<{ project: CanvasProject; draft: CanvasDraft | null; warning: string }>();
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setLoaded(undefined);
    void (async () => {
      const project = await loadCanvasProject(userId, id, abort.signal);
      let draft: CanvasDraft | null = null, warning = '';
      try {
        draft = readCanvasDraft(userId, id);
        if (draft) {
          assertCanvasMediaOwner(draft.document, userId);
          const nodes = await Promise.all(draft.document.nodes.map(async node => node.data.url
            ? { ...node, data: { ...node.data, url: await mediaPreview(node.data.url, userId) } } : node));
          draft = { ...draft, document: { ...draft.document, nodes } };
          if (draft.title === project.title && canvasJsonKey(canonicalMediaTree(draft.document)) === canvasJsonKey(canonicalMediaTree(project.document))) {
            draft.baseRevision = project.revision;
          }
        }
      } catch (cause) { draft = null; warning = cause instanceof Error ? cause.message : '本地副本读取失败'; }
      if (!abort.signal.aborted) setLoaded({ project, draft, warning });
    })().catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '画布加载失败'); });
    return () => abort.abort();
  }, [userId, id, attempt]);
  if (error) return <section className="canvas-loading" role="alert"><h1>画布加载失败</h1><p>{error}</p><button onClick={() => setAttempt(a => a + 1)}>重试加载</button><a href="/canvas">返回画布列表</a></section>;
  if (!loaded) return <div className="canvas-loading" role="status">正在打开画布…</div>;
  return <CanvasEditor key={`${id}:${attempt}`} project={loaded.project} draft={loaded.draft} warning={loaded.warning}
    reload={() => setAttempt(a => a + 1)} />;
}
export default function CanvasPage() {
  const { user } = useAuth(), { canvasId } = useParams();
  if (!user) return null;
  return canvasId ? <OpenCanvas key={`${user.id}:${canvasId}`} userId={user.id} id={canvasId} />
    : <CanvasProjects key={user.id} userId={user.id} />;
}
