import { useCallback, useEffect, useReducer } from 'react';
import { changeHistory, createHistory } from '@/lib/editorHistory';

export function useEditorHistory<T>(initial: T[]) {
  const [state, dispatch] = useReducer(changeHistory<T>, initial, createHistory<T>);
  const setTracks = useCallback((update: T[] | ((previous: T[]) => T[])) => dispatch({ type: 'edit', update }), []);
  const reset = useCallback((value: T[]) => dispatch({ type: 'reset', value }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  useEffect(() => {
    const begin = (event: PointerEvent) => {
      if ((event.target as Element)?.closest?.('[role="slider"]')) dispatch({ type: 'begin' });
    };
    const commit = () => dispatch({ type: 'commit' });
    const cancel = () => dispatch({ type: 'cancel' });
    document.addEventListener('pointerdown', begin, true);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', commit);
    return () => {
      document.removeEventListener('pointerdown', begin, true);
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', commit);
    };
  }, []);
  return { tracks: state.present, setTracks, reset, undo, redo,
    canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
