import { useCallback, useEffect, useRef, useState } from 'react';

// Loads data, optionally refreshing every `refreshMs`. Keeps old data visible while refreshing.
export function useApi(loader, deps = [], refreshMs = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updated: null });
  const alive = useRef(true);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loader();
      if (alive.current) setState({ data, error: null, loading: false, updated: new Date() });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    alive.current = true;
    load();
    const t = refreshMs ? setInterval(load, refreshMs) : null;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, refreshMs]);
  return { ...state, reload: load };
}
