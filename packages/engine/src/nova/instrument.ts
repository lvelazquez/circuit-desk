/// <reference lib="dom" />
// The Nova synth behind the engine's Instrument interface: an AudioWorkletNode driven by messages.
import { parsePatch } from "@circuit-desk/patch";
import type { Instrument, NoteOn } from "../types.ts";
import { NOVA_PROCESSOR, type NovaInit, type NovaMessage } from "./protocol.ts";

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Loads the worklet module into `ctx` once. `url` is the bundled worklet.ts. */
export function loadNovaWorklet(ctx: BaseAudioContext, url: string): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(url);
    loaded.set(ctx, p);
  }
  return p;
}

export class NovaInstrument implements Instrument {
  private readonly node: AudioWorkletNode;
  /** Name of the patch playing, for the UI. */
  name: string;

  /** `patch` is the 340 B synth patch. The worklet module must be loaded first. */
  constructor(ctx: BaseAudioContext, out: AudioNode, patch: Uint8Array, opts: { fx?: boolean; bpm?: number } = {}) {
    // Stereo: the patch's chorus. The patch, FX switch and tempo go with the node, so an offline
    // render has them from the first frame.
    const processorOptions: NovaInit = { values: parsePatch(patch).values, ...opts };
    this.node = new AudioWorkletNode(ctx, NOVA_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions });
    this.node.connect(out);
    this.name = "";
    this.setPatch(patch);
  }

  setPatch(patch: Uint8Array): void {
    const p = parsePatch(patch);
    this.name = p.name;
    this.post({ type: "values", values: p.values });
  }

  noteOn({ time, note, velocity }: NoteOn): void { this.post({ type: "on", time, note, velocity }); }

  noteOff(time: number, note: number): void { this.post({ type: "off", time, note }); }

  control(time: number, cc: number): void {
    // Synth CCs (macros, knobs) arrive with automation playback in E2; all-notes-off works now.
    if (cc === 120 || cc === 123) this.silence(time);
  }

  silence(time: number): void { this.post({ type: "silence", time }); }

  /** Tempo, for the patch's synced chorus rate. */
  setBpm(bpm: number): void { this.post({ type: "bpm", bpm }); }

  /** The app's FX switch: false plays the voices without the patch's own effects. */
  setFx(on: boolean): void { this.post({ type: "fx", on }); }

  dispose(): void {
    this.silence(0);
    this.node.disconnect();
    this.node.port.close();
  }

  private post(m: NovaMessage): void { this.node.port.postMessage(m); }
}
