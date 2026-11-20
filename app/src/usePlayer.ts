// Plays the open project through a Web MIDI output: the Circuit over USB, or anything else (the
// IAC bus into Live, a soft synth). Edits made while playing are picked up from the same position.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Arrangement } from "@circuit-desk/export";
import { PreviewEngine } from "@circuit-desk/engine";
import { playheads, Schedule, type TimedMessage } from "@circuit-desk/playback";
import { appOutput, audioContext, novaRender, packLoader } from "./audio.ts";
import { logEvent } from "./capture.ts";
import { call } from "./desk.ts";

/** The built-in preview engine's entry in the output list. */
export const PREVIEW_PORT = "preview";

const PUMP_MS = 25;
const PORT_KEY = "circuit-desk.midi-output";
const TARGET_KEY = "circuit-desk.play-target";
const FX_KEY = "circuit-desk.fx";

/** circuit: the Circuit's own channels and drum notes. live: the play-along Live set's. */
export type PlayTarget = "circuit" | "live";

/** What plays: the chains the project was saved with, its scene chain, one scene, or one pattern on every track. */
export type PlayFrom = { kind: "current" } | { kind: "scenes" } | { kind: "scene"; n: number } | { kind: "pattern"; n: number };
export const playFromValue = (f: PlayFrom): string => (f.kind === "scene" || f.kind === "pattern" ? `${f.kind}:${f.n}` : f.kind);
export function parsePlayFrom(v: string): PlayFrom {
  const [kind, n] = v.split(":");
  const num = Number(n);
  if (kind === "scene" && num >= 1 && num <= 16) return { kind, n: num };
  if (kind === "pattern" && num >= 1 && num <= 8) return { kind, n: num };
  return { kind: kind === "scenes" ? "scenes" : "current" };
}
const arrangementOptions = (f: PlayFrom): { source?: "scenes" | "current"; scene?: number; pattern?: number } =>
  f.kind === "scene" ? { scene: f.n } : f.kind === "pattern" ? { pattern: f.n } : { source: f.kind };

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
  const [playFrom, setPlayFromState] = useState<PlayFrom>({ kind: "current" });
  const playFromRef = useRef<PlayFrom>({ kind: "current" });
  const [fx, setFxState] = useState(remembered(FX_KEY) !== "off");
  const fxRef = useRef(fx);
  // Mute and solo (playback only). A change while playing hands over to a new schedule.
  const [muted, setMuted] = useState<ReadonlySet<number>>(new Set());
  const [solo, setSolo] = useState<number | null>(null);
  const silentRef = useRef<ReadonlySet<number>>(new Set());
  const [mixVersion, setMixVersion] = useState(0);
  useEffect(() => {
    silentRef.current = solo === null ? muted : new Set([0, 1, 2, 3, 4, 5, 6, 7].filter((t) => t !== solo));
    setMixVersion((v) => v + 1);
  }, [muted, solo]);
  const toggleMute = useCallback((t: number): void => setMuted((m) => { const n = new Set(m); if (n.has(t)) n.delete(t); else n.add(t); return n; }), []);
  const toggleSolo = useCallback((t: number): void => setSolo((cur) => (cur === t ? null : t)), []);

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
    if (o) for (const m of msgs) if (m.bytes.length && m.bytes[0] !== 0xf0 && m.bytes[0] !== 0xf7) o.send(m.bytes, m.at);
  }, [output, preview]);

  /** Makes the engine (first time) and loads the drum samples this arrangement uses. */
  const prepare = useCallback(async (a: Arrangement, editWhilePlaying = false): Promise<void> => {
    if (!preview || !projectId) return;
    if (!engine.current) {
      // Through the capture tap, and every message logged, so a sound report has what was played.
      engine.current = new PreviewEngine(audioContext(), { output: await appOutput() });
      engine.current.listener = (e) => logEvent({ ...e, source: "player" });
    }
    const pack = await call("packSamples", projectId);
    const flips = a.tracks.slice(4).map((t) => [...new Set(t.notes.flatMap((n) => (n.sample !== undefined ? [n.sample] : [])))]);
    await engine.current.loadDrums(pack.drums, flips, packLoader(projectId));
    // Synth 1/2 play their own patches through the Nova voice (re-read each time: edits may change them).
    const nova = await novaRender(projectId);
    // An edit while playing keeps the macro positions the automation has set.
    await engine.current.useNova(nova.moduleUrl, nova.patches, editWhilePlaying);
    // Levels, pans, sidechains, drum knobs, reverb and delay, as the project stores them.
    await engine.current.useSound(nova.moduleUrl, await call("soundSettings", projectId), a.bpm);
    engine.current.setFx(fxRef.current);
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
      const a = await call("arrangement", projectId, { ...arrangementOptions(playFromRef.current), target });
      if (!a.tracks.some((t) => t.notes.length)) { setError("Nothing to play: the current patterns have no notes"); return; }
      arr.current = a;
      await prepare(a);
      const s = new Schedule(a, { clock, muted: silentRef.current });
      send(s.play(performance.now()));
      sched.current = s; setPlaying(true); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [projectId, output, clock, send, target, preview, prepare]);

  /** The FX switch (built-in preview only): off plays every track dry, without patch effects or drum knobs. */
  const setFx = useCallback((on: boolean): void => {
    fxRef.current = on; setFxState(on); remember(FX_KEY, on ? "on" : "off");
    engine.current?.setFx(on);
  }, []);

  /** Changes what plays. While playing, the new part starts from its beginning at once. */
  const choosePlayFrom = useCallback((f: PlayFrom, start = false): void => {
    playFromRef.current = f; setPlayFromState(f);
    if (sched.current) { send(sched.current.stop(performance.now())); engine.current?.silence(); sched.current = null; setPlaying(false); setHeads([]); void play(); }
    else if (start) void play();
  }, [send, play]);

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
    void call("arrangement", projectId, { ...arrangementOptions(playFromRef.current), target }).then((a) => {
      const old = sched.current;
      if (!live || !old) return;
      void prepare(a, true); // new sample flips load in the background; until then they use the track's sample
      const now = performance.now(), at = old.position(now) % a.length;
      send(old.stop(now, true));
      const s = new Schedule(a, { clock, muted: silentRef.current });
      s.play(now, at);
      arr.current = a; sched.current = s;
    }, (e: unknown) => setError((e as Error).message));
    return () => { live = false; };
  }, [version, mixVersion]); // only an edit, a mute or a solo restarts the schedule

  // Opening another project stops playback.
  useEffect(() => () => stop(), [projectId]);

  const choosePort = (id: string): void => { if (playing) stop(); setPortId(id || null); if (id) remember(PORT_KEY, id); };
  const chooseTarget = (t: PlayTarget): void => { if (playing) stop(); setTarget(t); remember(TARGET_KEY, t); };
  return { ports, portId, choosePort, target, chooseTarget, playing, play, stop, clock, setClock, heads, error, liveOutput: output, playFrom, choosePlayFrom, fx, setFx, muted, solo, toggleMute, toggleSolo };
}
