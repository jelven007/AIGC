export const HISTORY_LIMIT = 100;
export interface EditorHistory<T> {
  past: T[][];
  present: T[];
  future: T[][];
  gesture: T[] | null;
}
export type HistoryAction<T> =
  | { type: 'edit'; update: T[] | ((previous: T[]) => T[]) }
  | { type: 'reset'; value: T[] }
  | { type: 'undo' | 'redo' | 'begin' | 'commit' | 'cancel' };
export function createHistory<T>(value: T[]): EditorHistory<T> {
  return { past: [], present: value, future: [], gesture: null };
}
const same = <T,>(left: T[], right: T[]) =>
  left === right || left.length === right.length && left.every((value, index) => value === right[index]);
/** Immutable clip objects are shared between bounded snapshots; a gesture commits once. */
export function changeHistory<T>(state: EditorHistory<T>, action: HistoryAction<T>): EditorHistory<T> {
  switch (action.type) {
    case 'reset': return createHistory(action.value);
    case 'begin': return state.gesture ? state : { ...state, gesture: state.present };
    case 'cancel': return state.gesture ? { ...state, present: state.gesture, gesture: null } : state;
    case 'commit':
      if (!state.gesture) return state;
      return same(state.gesture, state.present) ? { ...state, gesture: null } : {
        ...state, past: [...state.past, state.gesture].slice(-HISTORY_LIMIT), future: [], gesture: null,
      };
    case 'edit': {
      const next = typeof action.update === 'function' ? action.update(state.present) : action.update;
      if (same(state.present, next)) return state;
      return state.gesture ? { ...state, present: next } : {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: next, future: [], gesture: null,
      };
    }
    case 'undo': {
      const committed = changeHistory(state, { type: 'commit' });
      if (!committed.past.length) return committed;
      return { past: committed.past.slice(0, -1), present: committed.past.at(-1)!,
        future: [committed.present, ...committed.future], gesture: null };
    }
    case 'redo':
      if (state.gesture || !state.future.length) return state;
      return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: state.future[0],
        future: state.future.slice(1), gesture: null };
  }
}
