import type { CanvasDocument } from '@/types/canvas';
import { cleanCanvasDocument } from './canvasDocument';

export interface CanvasHistory {
  past: CanvasDocument[];
  present: CanvasDocument;
  future: CanvasDocument[];
  gesture: CanvasDocument | null;
}
export type CanvasHistoryAction =
  | { type: 'edit' | 'replace'; document: CanvasDocument }
  | { type: 'viewport'; viewport: CanvasDocument['viewport'] }
  | { type: 'reset'; document: CanvasDocument }
  | { type: 'begin' | 'commit' | 'undo' | 'redo' };
export const createCanvasHistory = (document: CanvasDocument): CanvasHistory =>
  ({ past: [], present: document, future: [], gesture: null });
const content = (document: CanvasDocument) => JSON.stringify({ ...cleanCanvasDocument(document), viewport: undefined });
export function changeCanvasHistory(state: CanvasHistory, action: CanvasHistoryAction): CanvasHistory {
  switch (action.type) {
    case 'reset': return createCanvasHistory(action.document);
    case 'viewport': return { ...state, present: { ...state.present, viewport: action.viewport } };
    case 'replace': return { ...state, present: action.document };
    case 'begin': return state.gesture ? state : { ...state, gesture: state.present };
    case 'commit': {
      if (!state.gesture) return state;
      return content(state.gesture) === content(state.present) ? { ...state, gesture: null }
        : { ...state, past: [...state.past, state.gesture].slice(-50), future: [], gesture: null };
    }
    case 'edit':
      if (content(action.document) === content(state.present)) return { ...state, present: action.document };
      return state.gesture ? { ...state, present: action.document } : {
        ...state, past: [...state.past, state.present].slice(-50), present: action.document, future: [],
      };
    case 'undo': {
      const current = changeCanvasHistory(state, { type: 'commit' });
      if (!current.past.length) return current;
      return { past: current.past.slice(0, -1), present: { ...current.past.at(-1)!, viewport: current.present.viewport },
        future: [current.present, ...current.future], gesture: null };
    }
    case 'redo':
      if (!state.future.length || state.gesture) return state;
      return { past: [...state.past, state.present].slice(-50), present: { ...state.future[0], viewport: state.present.viewport },
        future: state.future.slice(1), gesture: null };
  }
}
