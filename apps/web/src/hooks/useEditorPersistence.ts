import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorSaveQueue, persistEditorSnapshot, restoreEditorSnapshot, type EditorSnapshot } from '@/lib/editorPersistence';

export function useEditorPersistence(userId: string | undefined, projectId: string | null,
  restore: (snapshot: EditorSnapshot) => void) {
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const currentProjectIdRef = useRef<string | null>(projectId);
  const pendingCreate = useRef(false);
  const queue = useMemo(() => new EditorSaveQueue(), []);
  const controller = useRef(new AbortController());
  const active = useRef(false);
  useEffect(() => {
    const request = new AbortController(); controller.current = request;
    active.current = true;
    if (!userId) { setReady(true); return () => { active.current = false; }; }
    void restoreEditorSnapshot(userId, projectId, request.signal).then(snapshot => {
      if (!active.current || request.signal.aborted) return;
      if (snapshot) {
        currentProjectIdRef.current = snapshot.importId;
        pendingCreate.current = snapshot.pendingCreate === true;
        restore(snapshot);
      }
      setReady(true);
    }).catch(cause => { if (active.current && !request.signal.aborted) setError(cause instanceof Error ? cause.message : '工程读取失败，请重新加载'); });
    return () => { active.current = false; request.abort(); };
  }, [userId, projectId, restore]);
  const persist = useCallback((snapshot: EditorSnapshot) => {
    if (!userId || !active.current) return;
    try { persistEditorSnapshot(userId, snapshot); setStorageError(''); }
    catch (cause) { setStorageError((cause as Error).message); throw cause; }
  }, [userId]);
  return { ready, error: error || storageError, setError, persist, currentProjectIdRef, pendingCreate,
    queue, signal: controller.current.signal, active };
}
