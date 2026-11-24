// The tabs of the pane beside the panel: Editor, Scenes, Sounds, Mixer, Pack, Project (⌘2–⌘7).
// One tab stop; arrow keys, Home and End move between tabs and show them (ARIA tabs pattern).
import type { KeyboardEvent } from "react";
import { listMove } from "./model.ts";
import { DETAIL_VIEWS, VIEWS, type DetailView } from "./views.ts";

export function DetailTabs({ view, onView }: { view: DetailView; onView: (v: DetailView) => void }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const to = e.key === "Home" ? 0 : e.key === "End" ? DETAIL_VIEWS.length - 1 : listMove(i, e.key, DETAIL_VIEWS.length, true);
    const next = to === null ? undefined : DETAIL_VIEWS[to];
    if (to === null || !next) return;
    e.preventDefault();
    onView(next.id);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="tablist" aria-label="Views" className="detail-tabs">
      {DETAIL_VIEWS.map((v, i) => {
        const n = VIEWS.indexOf(v) + 1, on = v.id === view;
        return (
          <button key={v.id} type="button" role="tab" id={`tab-${v.id}`} aria-selected={on} aria-controls="detail-panel" tabIndex={on ? 0 : -1}
            className="btn" data-view={v.id} aria-keyshortcuts={`Meta+${n}`} data-tip={`${v.tip} (⌘${n})`}
            onClick={() => onView(v.id)} onKeyDown={(e) => onKey(e, i)}>{v.label}</button>
        );
      })}
    </div>
  );
}
