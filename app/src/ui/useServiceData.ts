// Loads one service call for a view and keeps it current: re-fetches when `deps` change (e.g. the
// edit version), ignores answers that arrive after the view moved on, and reports loading and
// errors in one shape.
import { useEffect, useState } from "react";
import type { DeskMethod, DeskService } from "../../electron/api.ts";
import { call } from "../desk.ts";

export interface ServiceData<T> { data: T | null; error: string | null; loading: boolean }

export function useServiceData<M extends DeskMethod>(
  method: M | null,
  args: Parameters<DeskService[M]>,
  deps: readonly unknown[],
): ServiceData<Awaited<ReturnType<DeskService[M]>>> {
  type T = Awaited<ReturnType<DeskService[M]>>;
  const [state, setState] = useState<ServiceData<T>>({ data: null, error: null, loading: method !== null });
  useEffect(() => {
    if (!method) { setState({ data: null, error: null, loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    call(method as M, ...(args as Parameters<DeskService[M]>)).then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (e: unknown) => { if (live) setState({ data: null, error: (e as Error).message, loading: false }); },
    );
    return () => { live = false; };
    // The caller lists what the call depends on; `args` is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, ...deps]);
  return state;
}
