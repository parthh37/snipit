import { useCallback, useState } from "react";

interface State<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;

/** Undo/redo over immutable snapshots. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<State<T>>({
    past: [],
    present: initial,
    future: [],
  });

  /** Records an undo step. `base` is what undo returns to (defaults to the present). */
  const commit = useCallback((next: T, base?: T) => {
    setState((s) => ({
      past: [...s.past, base ?? s.present].slice(-LIMIT),
      present: next,
      future: [],
    }));
  }, []);

  /** Changes the present without an undo step (e.g. while typing). */
  const replace = useCallback((next: T) => {
    setState((s) => ({ ...s, present: next }));
  }, []);

  const undo = useCallback(() => {
    setState((s) =>
      s.past.length
        ? {
            past: s.past.slice(0, -1),
            present: s.past[s.past.length - 1],
            future: [s.present, ...s.future],
          }
        : s,
    );
  }, []);

  const redo = useCallback(() => {
    setState((s) =>
      s.future.length
        ? {
            past: [...s.past, s.present],
            present: s.future[0],
            future: s.future.slice(1),
          }
        : s,
    );
  }, []);

  const reset = useCallback((next: T) => {
    setState({ past: [], present: next, future: [] });
  }, []);

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    replace,
    undo,
    redo,
    reset,
  };
}
