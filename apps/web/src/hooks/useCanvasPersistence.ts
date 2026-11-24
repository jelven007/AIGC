import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasConflictError, saveCanvasProject } from '@/api/canvasProjects';
import { CanvasSaveQueue, writeCanvasDraft } from '@/lib/canvasPersistence';
import { cleanCanvasDocument, canvasJsonKey } from '@/lib/canvasDocument';
import { canonicalMediaTree } from '@/lib/privateMedia';
import type { CanvasDocument, CanvasProject } from '@/types/canvas';

const fingerprint = (title: string, document: CanvasDocument) => canvasJsonKey(canonicalMediaTree({ title, document: cleanCanvasDocument(document) }));
export function useCanvasPersistence(project: CanvasProject, initialTitle: string, initialDocument: CanvasDocument, initialConflict: boolean) {
  const abort = useRef<AbortController>();
  const queue = useRef<CanvasSaveQueue>();
  const latest = useRef({ title: initialTitle, document: initialDocument });
  const conflict = useRef(initialConflict), active = useRef(false), timer = useRef<ReturnType<typeof setTimeout>>();
  const [status, setStatus] = useState('已保存'), [error, setError] = useState('');
  const [hasConflict, setHasConflict] = useState(initialConflict);
  useEffect(() => {
    active.current = true; abort.current = new AbortController();
    queue.current = new CanvasSaveQueue(project, (revision, title, document) => {
      if (conflict.current) throw new CanvasConflictError();
      return saveCanvasProject(project.user_id, project.id, revision, title, document, abort.current!.signal);
    });
    return () => { active.current = false; clearTimeout(timer.current); abort.current?.abort(); };
  }, [project.id, project.user_id]);
  const writeLocal = useCallback(() => {
    const current = queue.current?.current || project;
    writeCanvasDraft(project.user_id, project.id, { ...latest.current, baseRevision: current.revision });
  }, [project]);
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const pending = queue.current;
    if (!pending || conflict.current) throw new CanvasConflictError();
    const snapshot = { ...latest.current, document: cleanCanvasDocument(latest.current.document) };
    try {
      writeLocal();
      if (fingerprint(snapshot.title, snapshot.document) === fingerprint(pending.current.title, pending.current.document)) {
        if (active.current) { setStatus('已保存'); setError(''); }
        return pending.current;
      }
      setStatus('保存中');
      const saved = await pending.save(snapshot.title, snapshot.document);
      if (!active.current) return saved;
      writeLocal();
      setStatus(fingerprint(latest.current.title, latest.current.document) === fingerprint(saved.title, saved.document) ? '已保存' : '有未保存修改');
      setError('');
      return saved;
    } catch (cause) {
      if (active.current) {
        if (cause instanceof CanvasConflictError) { conflict.current = true; setHasConflict(true); }
        setStatus('保存失败'); setError(cause instanceof Error ? cause.message : '画布保存失败，请重试');
      }
      throw cause;
    }
  }, [writeLocal]);
  const stage = useCallback((title: string, document: CanvasDocument) => {
    const changed = fingerprint(title, document) !== fingerprint(latest.current.title, latest.current.document);
    latest.current = { title, document };
    if (!changed) return;
    clearTimeout(timer.current);
    try { writeLocal(); setStatus('有未保存修改'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '本地恢复副本保存失败'); setStatus('保存失败'); }
    if (!conflict.current) timer.current = setTimeout(() => { void save().catch(() => {}); }, 800);
  }, [writeLocal, save]);
  useEffect(() => {
    if (initialConflict) { setStatus('保存失败'); setError('本地副本与云端版本不同，已保留本地内容'); }
    else if (fingerprint(initialTitle, initialDocument) !== fingerprint(project.title, project.document)) {
      setStatus('有未保存修改'); timer.current = setTimeout(() => { void save().catch(() => {}); }, 800);
    }
    const flush = () => { try { writeLocal(); } catch { /* Current contents remain in the open editor. */ } };
    window.addEventListener('pagehide', flush);
    const warn = (event: BeforeUnloadEvent) => {
      if (conflict.current || fingerprint(latest.current.title, latest.current.document) !== fingerprint(queue.current?.current.title || '', queue.current?.current.document || project.document)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', warn); };
  }, [project, initialTitle, initialDocument, initialConflict, writeLocal, save]);
  return { stage, save, status, error, hasConflict, latest };
}
