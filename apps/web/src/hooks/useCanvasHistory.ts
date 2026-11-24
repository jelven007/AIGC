import { useCallback, useReducer, useRef } from 'react';
import type { CanvasDocument } from '@/types/canvas';
import { changeCanvasHistory, createCanvasHistory } from '@/lib/canvasHistory';

export function useCanvasHistory(initial: CanvasDocument) {
  const [history, dispatch] = useReducer(changeCanvasHistory, initial, createCanvasHistory);
  const latest = useRef(history.present); latest.current = history.present;
  const change = useCallback((update: CanvasDocument | ((value: CanvasDocument) => CanvasDocument), record = true) => {
    const document = typeof update === 'function' ? update(latest.current) : update;
    latest.current = document;
    dispatch({ type: record ? 'edit' : 'replace', document });
  }, []);
  return { history, document: history.present, latest, change, dispatch };
}
