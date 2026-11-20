// The project on screen: the library, the open project's summary, scenes and settings (reloaded
// after each edit), and the pattern being edited with the four drum patterns beside it.
import { useEffect, useState } from "react";
import type { TrackName } from "@circuit-desk/core-service";
import { call, type DrumPatternData, type Listing, type PatternData, type Scenes, type Settings, type Summary } from "./desk.ts";
import { DRUM_NAMES, isDrum } from "./tracks.ts";

export function useProjectData(projectId: string | null, track: TrackName, pattern: number, version: number,
  onFirstProject: (id: string) => void, fail: (e: unknown) => void, failLibrary: (e: unknown) => void) {
  const [library, setLibrary] = useState<Listing[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scenes, setScenes] = useState<Scenes | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [data, setData] = useState<PatternData | null>(null);
  const [drums, setDrums] = useState<DrumPatternData[]>([]);

  // Once: the library, and a project already open (e.g. through the MCP link).
  useEffect(() => {
    void (async () => {
      try { setLibrary(await call("listProjects")); } catch (e) { failLibrary(e); }
      try { const open = await call("openProjects"); if (open[0]) onFirstProject(open[0].id); } catch (e) { fail(e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project-wide data: on opening a project and after each edit.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void Promise.all([call("summary", projectId), call("getScenes", projectId), call("settings", projectId)]).then(([s, sc, st]) => {
      if (live) { setSummary(s); setScenes(sc); setSettings(st); }
    }, (e: unknown) => { if (live) fail(e); });
    return () => { live = false; };
  }, [projectId, version, fail]);

  // The pattern on screen and the four drum patterns: also when the track or pattern changes.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void Promise.all([
      isDrum(track) ? Promise.resolve(null) : call("getPattern", projectId, track, pattern),
      Promise.all(DRUM_NAMES.map((n) => call("getPattern", projectId, n, pattern))),
    ]).then(([d, ds]) => {
      if (!live) return;
      const drumData = ds.filter((x): x is DrumPatternData => x.kind === "drums");
      setDrums(drumData);
      // A drum track's own pattern is one of the four already fetched.
      setData(d ?? drumData[DRUM_NAMES.indexOf(track as (typeof DRUM_NAMES)[number])] ?? null);
    }, (e: unknown) => { if (live) fail(e); });
    return () => { live = false; };
  }, [projectId, track, pattern, version, fail]);

  return { library, summary, scenes, settings, data, drums };
}
