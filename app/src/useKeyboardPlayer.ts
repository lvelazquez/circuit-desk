// Plays a synth sound from the computer keyboard, when the user turns it on. Layout as in Live
// (physical keys, so it works on any keyboard layout): A S D F G H J K L ; are white keys from C,
// W E T Y U O P the black keys; Z / X octave down / up; C / V velocity down / up; Esc turns it off.
// Keys with ⌘, Ctrl or Alt, and typing in a text field, are never taken, so menus and fields work.
import { useCallback, useEffect, useRef, useState } from "react";
import { NovaInstrument } from "@circuit-desk/engine";
import { initPatchBytes as initPatchBytesForPreview } from "@circuit-desk/patch";
import { audioContext, loadNovaWorklet } from "./audio.ts";
import { DEFAULT_OCTAVE, KEY_NOTES, MAX_OCTAVE, MIN_OCTAVE, keyCode, keyNote } from "./keymap.ts";

const VELOCITY_STEP = 20;

export interface KeySound {
  /** Shown to the user, e.g. "Synth 1 · Pad Sweep". */
  label: string;
  /** The 340 B patch the built-in preview plays; null = the guide's default patch. */
  patch: Uint8Array | null;
  /** MIDI channel (0-based) when the sound goes to a MIDI output instead. */
  channel: number;
  /** Pack patches only exist here: they always play on the built-in preview. */
  previewOnly: boolean;
}

const isTextField = (el: EventTarget | null): boolean =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

export function useKeyboardPlayer(sound: KeySound | null, output: () => MIDIOutput | null) {
  const [on, setOn] = useState(false);
  const [octave, setOctave] = useState(DEFAULT_OCTAVE);
  const [velocity, setVelocity] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const inst = useRef<NovaInstrument | null>(null);
  const held = useRef(new Map<string, { note: number; midi: MIDIOutput | null; channel: number }>());

  /** The preview instrument, made on first use and given the current patch. */
  const preview = useCallback(async (): Promise<NovaInstrument | null> => {
    try {
      const ctx = audioContext();
      await loadNovaWorklet(ctx);
      const patch = sound?.patch ?? initPatchBytesForPreview();
      if (!inst.current) inst.current = new NovaInstrument(ctx, ctx.destination, patch);
      else inst.current.setPatch(patch);
      return inst.current;
    } catch (e) { setError(`Preview: ${(e as Error).message}`); return null; }
  }, [sound]);

  // A new sound: the next note uses it.
  useEffect(() => { if (inst.current && sound) inst.current.setPatch(sound.patch ?? initPatchBytesForPreview()); }, [sound]);

  const allOff = useCallback((): void => {
    for (const h of held.current.values()) h.midi?.send([0x80 | h.channel, h.note, 0]);
    held.current.clear();
    const ctx = audioContext();
    inst.current?.silence(ctx.currentTime);
  }, []);

  const noteOn = useCallback(async (code: string, note: number): Promise<void> => {
    if (!sound) return;
    const midi = sound.previewOnly ? null : output();
    held.current.set(code, { note, midi, channel: sound.channel });
    if (midi) { midi.send([0x90 | sound.channel, note, velocity]); return; }
    const i = await preview();
    if (i && held.current.get(code)?.note === note) i.noteOn({ time: audioContext().currentTime, note, velocity });
  }, [sound, output, preview, velocity]);

  const noteOff = useCallback((code: string): void => {
    const h = held.current.get(code);
    if (!h) return;
    held.current.delete(code);
    if (h.midi) h.midi.send([0x80 | h.channel, h.note, 0]);
    else inst.current?.noteOff(audioContext().currentTime, h.note);
  }, []);

  useEffect(() => {
    if (!on) { allOff(); return; }
    const down = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTextField(e.target)) return;
      const take = (): void => { e.preventDefault(); e.stopPropagation(); };
      const code = keyCode(e);
      if (code === "Escape") { take(); setOn(false); return; }
      if (code === "KeyZ" || code === "KeyX") {
        take();
        if (!e.repeat) { allOff(); setOctave((o) => Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, o + (code === "KeyX" ? 1 : -1)))); }
        return;
      }
      if (code === "KeyC" || code === "KeyV") {
        take();
        if (!e.repeat) setVelocity((v) => Math.min(127, Math.max(1, v + (code === "KeyV" ? VELOCITY_STEP : -VELOCITY_STEP))));
        return;
      }
      const offset = KEY_NOTES[code];
      if (offset === undefined) return;
      take();
      if (e.repeat || held.current.has(code)) return;
      const note = keyNote(octave, offset);
      if (note !== null) void noteOn(code, note);
    };
    const up = (e: KeyboardEvent): void => {
      const code = keyCode(e);
      if (KEY_NOTES[code] === undefined) return;
      e.preventDefault(); e.stopPropagation();
      noteOff(code);
    };
    const blur = (): void => allOff();
    // Capture phase: these keys reach the keyboard player before the grids' own shortcuts.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [on, octave, noteOn, noteOff, allOff]);

  // Unmount: nothing left sounding.
  useEffect(() => () => { allOff(); inst.current?.dispose(); inst.current = null; }, [allOff]);

  /** Plays one short note now (pack auditioning), on the built-in preview. */
  const audition = useCallback(async (note = 60, seconds = 0.6): Promise<void> => {
    const i = await preview();
    if (!i) return;
    const t = audioContext().currentTime;
    i.noteOn({ time: t, note, velocity: 100 });
    i.noteOff(t + seconds, note);
  }, [preview]);

  return { on, setOn, octave, velocity, error, audition };
}
