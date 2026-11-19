// Plays the open project through a Web MIDI output: the Circuit over USB, or anything else (the
// IAC bus into Live, a soft synth). Edits made while playing are picked up from the same position.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Arrangement } from "@circuit-desk/export";
import { PreviewEngine } from "@circuit-desk/engine";
import { playheads, Schedule, type TimedMessage } from "@circuit-desk/playback";
import { audioContext, novaRender, packLoader } from "./audio.ts";
import { call } from "./desk.ts";

/** The built-in preview engine's entry in the output list. */
export const PREVIEW_PORT = "preview";

const PUMP_MS = 25;
const PORT_KEY = "circuit-desk.midi-output";
const TARGET_KEY = "circuit-desk.play-target";

/** circuit: the Circuit's own channels and drum notes. live: the play-along Live set's. */
export type PlayTarget = "circuit" | "live";

export interface PortInfo { id: string; name: string }
export type Heads = ({ pattern: number; step: number } | null)[];

function remembered(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key: string, v: string): void { try { localStorage.setItem(key, v); } catch { /* a per-viewer convenience only */ } }

export function usePlayer(projectId: string | null, version: number) {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [portId, setPortId] = useState<string | null>(remembered(PORT_KEY) ?? PREVIEW_PORT);
  const [target, setTarget] = useState<PlayTarget>(remembered(TARGET_KEY) === "live" ? "live" : "circuit");
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(false);
  const [heads, setHeads] = useState<Heads>([]);
  const [error, setError] = useState<string | null>(null);
  const sched = useRef<Schedule | null>(null);
  const engine = useRef<PreviewEngine | null>(null);
  const preview = portId === PREVIEW_PORT;
  const arr = useRef<Arrangement | null>(null);

  useEffect(() => {
    setPorts([{ id: PREVIEW_PORT, name: "Built-in preview" }]);
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess({ sysex: false }).then((a) => {
      if (a.sysexEnabled) { setError("MIDI was opened with SysEx; playback is off to stay safe"); return; }
      const list = (): void => setPorts([{ id: PREVIEW_PORT, name: "Built-in preview" }, ...[...a.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }))]);
      a.onstatechange = list;
      setAccess(a); list();
    }, (e: unknown) => setError(`MIDI: ${(e as Error).message}`));
  }, []);

  const output = useCallback((): MIDIOutput | null => (access && portId && portId !== PREVIEW_PORT ? access.outputs.get(portId) ?? null : null), [access, portId]);
  /** Sends notes, CC and clock only: a SysEx start byte (0xF0) never leaves the app. */
  const send = useCallback((msgs: TimedMessage[]): void => {
    if (preview) { engine.current?.handle(msgs); return; }
    const o = output();
    if (o) for (const m of msgs) if (m.bytes[0] !== 0xf0 && m.bytes[0] !== 0xf7) o.send(m.bytes, m.at);
  }, [output, preview]);

  /** Makes the engine (first time) and loads the drum samples this arrangement uses. */
  const prepare = useCallback(async (a: Arrangement): Promise<void> => {
    if (!preview || !projectId) return;
    engine.current ??= new PreviewEngine(audioContext());
    const pack = await call("packSamples", projectId);
    const flips = a.tracks.slice(4).map((t) => [...new Set(t.notes.flatMap((n) => (n.sample !== undefined ? [n.sample] : [])))]);
    await engine.current.loadDrums(pack.drums, flips, packLoader(projectId));
    // Synth 1/2 play their own patches through the Nova voice (re-read each time: edits may change them).
    const nova = await novaRender(projectId);
    await engine.current.useNova(nova.moduleUrl, nova.patches);
  }, [preview, projectId]);

  const stop = useCallback((): void => {
    if (sched.current) send(sched.current.stop(performance.now()));
    engine.current?.silence();
    sched.current = null; setPlaying(false); setHeads([]);
  }, [send]);

  const play = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    if (!preview && !output()) { setError("Choose an output first"); return; }
    try {
      const a = await call("arrangement", projectId, { source: "current", target });
      if (!a.tracks.some((t) => t.notes.length)) { setError("Nothing to play: the current patterns have no notes"); return; }
      arr.current = a;
      await prepare(a);
      const s = new Schedule(a, { clock });
      send(s.play(performance.now()));
      sched.current = s; setPlaying(true); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [projectId, output, clock, send, target, preview, prepare]);

  // Pump the schedule and move the playhead.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => { const s = sched.current; if (s) send(s.pump(performance.now())); }, PUMP_MS);
    let frame = 0, last = "";
    const draw = (): void => {
      const s = sched.current, a = arr.current;
      if (s && a) {
        const h = playheads(a, s.position(performance.now()));
        const key = JSON.stringify(h);
        if (key !== last) { last = key; setHeads(h); }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { clearInterval(timer); cancelAnimationFrame(frame); };
  }, [playing, send]);

  // An edit while playing: carry on from the same place with the new notes.
  useEffect(() => {
    if (!playing || !projectId) return;
    let live = true;
    void call("arrangement", projectId, { source: "current", target }).then((a) => {
      const old = sched.current;
      if (!live || !old) return;
      void prepare(a); // new sample flips load in the background; until then they use the track's sample
      const now = performance.now(), at = old.position(now) % a.length;
      send(old.stop(now, true));
      const s = new Schedule(a, { clock });
      s.play(now, at);
      arr.current = a; sched.current = s;
    }, (e: unknown) => setError((e as Error).message));
    return () => { live = false; };
  }, [version]); // only an edit restarts the schedule

  // Opening another project stops playback.
  useEffect(() => () => stop(), [projectId]);

  const choosePort = (id: string): void => { if (playing) stop(); setPortId(id || null); if (id) remember(PORT_KEY, id); };
  const chooseTarget = (t: PlayTarget): void => { if (playing) stop(); setTarget(t); remember(TARGET_KEY, t); };
  return { ports, portId, choosePort, target, chooseTarget, playing, play, stop, clock, setClock, heads, error, liveOutput: output };
}
