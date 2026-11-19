// Plays the open project through a Web MIDI output: the Circuit over USB, or anything else (the
// IAC bus into Live, a soft synth). Edits made while playing are picked up from the same position.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Arrangement } from "@circuit-desk/export";
import { playheads, Schedule, type TimedMessage } from "@circuit-desk/playback";
import { call } from "./desk.ts";

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
  const [portId, setPortId] = useState<string | null>(remembered(PORT_KEY));
  const [target, setTarget] = useState<PlayTarget>(remembered(TARGET_KEY) === "live" ? "live" : "circuit");
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(false);
  const [heads, setHeads] = useState<Heads>([]);
  const [error, setError] = useState<string | null>(null);
  const sched = useRef<Schedule | null>(null);
  const arr = useRef<Arrangement | null>(null);

  useEffect(() => {
    if (!navigator.requestMIDIAccess) { setError("Web MIDI is not available"); return; }
    navigator.requestMIDIAccess({ sysex: false }).then((a) => {
      const list = (): void => setPorts([...a.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id })));
      a.onstatechange = list;
      setAccess(a); list();
    }, (e: unknown) => setError(`MIDI: ${(e as Error).message}`));
  }, []);

  const output = useCallback((): MIDIOutput | null => (access && portId ? access.outputs.get(portId) ?? null : null), [access, portId]);
  const send = useCallback((msgs: TimedMessage[]): void => { const o = output(); if (o) for (const m of msgs) o.send(m.bytes, m.at); }, [output]);

  const stop = useCallback((): void => {
    if (sched.current) send(sched.current.stop(performance.now()));
    sched.current = null; setPlaying(false); setHeads([]);
  }, [send]);

  const play = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    if (!output()) { setError("Choose a MIDI output first"); return; }
    try {
      const a = await call("arrangement", projectId, { source: "current", target });
      if (!a.tracks.some((t) => t.notes.length)) { setError("Nothing to play: the current patterns have no notes"); return; }
      arr.current = a;
      const s = new Schedule(a, { clock });
      send(s.play(performance.now()));
      sched.current = s; setPlaying(true); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [projectId, output, clock, send, target]);

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
  return { ports, portId, choosePort, target, chooseTarget, playing, play, stop, clock, setClock, heads, error };
}
