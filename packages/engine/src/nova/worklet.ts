// The AudioWorklet processor for one Nova synth part. Loaded with audioWorklet.addModule(url); the
// app gets the bundled url from Vite ("@circuit-desk/engine/nova-worklet?worker&url").
import { MIXER_PROCESSOR, NOVA_PROCESSOR, TAP_PROCESSOR, TAP_SECONDS, type MixerInit, type MixerMessage, type NovaInit, type NovaMessage, type TapDump, type TapRequest } from "./protocol.ts";
import { NovaSynth } from "./synth.ts";
import { novaTablesLoaded, setNovaTables } from "./tables.ts";
import { ProjectMixer } from "../fx/mixer.ts";

// The AudioWorkletGlobalScope, which TypeScript's libraries do not describe.
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class NovaProcessor extends AudioWorkletProcessor {
  private readonly synth = new NovaSynth(sampleRate);

  /** Initial values, FX switch and tempo come with the node (processorOptions): an offline render can
   * finish before a port message arrives. Later changes come as messages. */
  constructor(options?: { processorOptions?: NovaInit }) {
    super(options);
    const init = options?.processorOptions;
    if (init?.tables && !novaTablesLoaded()) setNovaTables(init.tables);
    if (init?.values) this.synth.setValues(init.values);
    if (init?.bpm) this.synth.setBpm(init.bpm);
    if (init?.fx === false) this.synth.fx.enabled = false;
    this.port.onmessage = (e: MessageEvent<NovaMessage>) => this.receive(e.data);
  }

  private receive(m: NovaMessage): void {
    if (m.type === "values") { this.synth.setValues(m.values, m.keepMacros === true); return; }
    if (m.type === "bpm") { this.synth.setBpm(m.bpm); return; }
    if (m.type === "macro") { this.synth.schedule({ frame: Math.max(currentFrame, Math.round(m.time * sampleRate)), type: "macro", index: m.index, value: m.value }); return; }
    if (m.type === "fx") { this.synth.fx.enabled = m.on; return; }
    const frame = Math.max(currentFrame, Math.round(m.time * sampleRate));
    if (m.type === "on") this.synth.schedule({ frame, type: "on", note: m.note, velocity: m.velocity });
    else if (m.type === "off") this.synth.schedule({ frame, type: "off", note: m.note });
    else this.synth.schedule({ frame, type: "silence" });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0], right = out?.[1] ?? left;
    if (!out || !left || !right) return true;
    this.synth.frame = currentFrame;
    this.synth.processStereo(left, right);
    return true;
  }
}

registerProcessor(NOVA_PROCESSOR, NovaProcessor);

/** The project mixer: 8 stereo strips (Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4) in, the mix out. */
class MixerProcessor extends AudioWorkletProcessor {
  private readonly mixer = new ProjectMixer(sampleRate);

  constructor(options?: { processorOptions?: MixerInit }) {
    super(options);
    const init = options?.processorOptions;
    if (init?.sound) this.mixer.set(init.sound, init.bpm ?? 120);
    if (init?.fx === false) this.mixer.enabled = false;
    this.port.onmessage = (e: MessageEvent<MixerMessage>) => {
      const m = e.data;
      if (m.type === "sound") this.mixer.set(m.sound, m.bpm);
      else if (m.type === "fx") this.mixer.enabled = m.on;
      else if (m.type === "clear") this.mixer.clear();
      else if (m.type === "auto") this.mixer.automate(Math.max(currentFrame, Math.round(m.time * sampleRate)), m.track, m.target, m.value);
      else this.mixer.trigger(Math.max(currentFrame, Math.round(m.time * sampleRate)), m.drum);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0], right = out?.[1];
    if (!left || !right) return true;
    this.mixer.process(inputs, left, right, currentFrame, left.length);
    return true;
  }
}

registerProcessor(MIXER_PROCESSOR, MixerProcessor);

/** Passes its stereo input through unchanged and keeps the last TAP_SECONDS in a ring buffer. */
class TapProcessor extends AudioWorkletProcessor {
  private readonly size = Math.round(TAP_SECONDS * sampleRate);
  private readonly ring = [new Float32Array(this.size), new Float32Array(this.size)];
  private at = 0;
  private filled = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<TapRequest>) => { if (e.data.type === "dump") this.dump(e.data.id); };
  }

  private dump(id: number): void {
    const n = this.filled;
    const out = [new Float32Array(n), new Float32Array(n)];
    const start = (this.at - n + this.size) % this.size;
    for (let c = 0; c < 2; c++) {
      const ring = this.ring[c]!, o = out[c]!;
      const first = Math.min(n, this.size - start);
      o.set(ring.subarray(start, start + first), 0);
      o.set(ring.subarray(0, n - first), first);
    }
    const msg: TapDump = { type: "dump", id, endFrame: currentFrame, sampleRate, left: out[0]!, right: out[1]! };
    this.port.postMessage(msg, [out[0]!.buffer, out[1]!.buffer]);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0], output = outputs[0];
    const frames = output?.[0]?.length ?? 128;
    for (let c = 0; c < 2; c++) {
      const src = input?.[c] ?? input?.[0];
      const dst = output?.[c];
      if (dst) { if (src) dst.set(src); else dst.fill(0); }
      const ring = this.ring[c]!;
      for (let i = 0; i < frames; i++) ring[(this.at + i) % this.size] = src ? src[i]! : 0;
    }
    this.at = (this.at + frames) % this.size;
    this.filled = Math.min(this.size, this.filled + frames);
    return true;
  }
}

registerProcessor(TAP_PROCESSOR, TapProcessor);
