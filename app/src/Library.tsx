// The project library: the card copy's projects grouped by pack, each with its slot number, the open
// one marked (and whether it has unsaved edits). Search filters by project, pack or file name.
import { useMemo, useState } from "react";
import type { Listing } from "./desk.ts";

/** The slot on the device: the number in the file name (Session07.ncs → "07"), if any. */
const slotOf = (file: string): string | null => /(\d+)/.exec(file)?.[1]?.padStart(2, "0") ?? null;
/** "01_Smoke" → "Smoke": the number prefix is the pack's folder order, kept in the tooltip. */
const packName = (pack: string): string => pack.replace(/^\d+[_ -]+/, "") || pack;

export function Library({ items, current, edited, onOpen }: { items: readonly Listing[]; current: string | null; edited: boolean; onOpen: (path: string) => void }) {
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
    <nav className="panel library" aria-label="Projects" id="library">
      <h2 id="library-title">Library</h2>
      <label className="visually-hidden" htmlFor="library-search">Search projects</label>
      <input id="library-search" type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} data-tip="Filter the library by project, pack or file name." />
      {groups.length === 0 && <p className="hint">{query ? "No projects match." : "No projects. Use File › Open Project…"}</p>}
      {groups.map(([pack, list]) => (
        <section key={pack} aria-label={packName(pack)}>
          <p className="pack" data-tip={`Pack folder ${pack}`}>{packName(pack)}</p>
          <ul>
            {list.map((it) => {
              const open = it.path === current, slot = slotOf(it.file);
              return (
                <li key={it.path}>
                  <button type="button" aria-current={open} onClick={() => onOpen(it.path)}
                    data-tip={`Open ${it.file}. Edits stay in the app (with undo) until File › Save a Copy; the file itself is never changed.`}>
                    {slot && <span className="slot" aria-label={`slot ${slot},`}>{slot}</span>}
                    <span className="lib-name">{it.name || it.file}</span>
                    {open && edited && <span className="lib-mark" aria-label=", edited" data-tip="Has edits not yet saved as a copy.">●</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
