import { useMemo, useState } from "react";
import type { Listing } from "./desk.ts";

export function Library({ items, current, onOpen }: { items: readonly Listing[]; current: string | null; onOpen: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = new Map<string, Listing[]>();
    for (const it of items) {
      if (it.problem) continue;
      if (q && !`${it.name} ${it.pack} ${it.file}`.toLowerCase().includes(q)) continue;
      m.set(it.pack, [...(m.get(it.pack) ?? []), it]);
    }
    return [...m];
  }, [items, query]);
  return (
    <nav className="panel library" aria-label="Projects">
      <h2 id="library-title">Library</h2>
      <label className="visually-hidden" htmlFor="library-search">Search projects</label>
      <input id="library-search" type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
      {groups.length === 0 && <p className="hint">No projects. Use File › Open Project.</p>}
      {groups.map(([pack, list]) => (
        <section key={pack} aria-label={pack}>
          <p className="pack">{pack}</p>
          <ul>
            {list.map((it) => (
              <li key={it.path}>
                <button type="button" aria-current={it.path === current} onClick={() => onOpen(it.path)} title={it.file}>{it.name || it.file}</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
