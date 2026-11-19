// The AudioWorklet processor for one Nova synth part. Loaded with audioWorklet.addModule(url); the
// app gets the bundled url from Vite ("@circuit-desk/engine/nova-worklet?worker&url").
import { NOVA_PROCESSOR, TAP_PROCESSOR, TAP_SECONDS, type NovaMessage, type TapDump, type TapRequest } from "./protocol.ts";
import { NovaSynth } from "./synth.ts";

// The AudioWorkletGlobalScope, which TypeScript's libraries do not describe.
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class NovaProcessor extends AudioWorkletProcessor {
  private readonly synth = new NovaSynth(sampleRate);
  private mono = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<NovaMessage>) => this.receive(e.data);
  }

  private receive(m: NovaMessage): void {
    if (m.type === "values") { this.synth.setValues(m.values); return; }
    const frame = Math.max(currentFrame, Math.round(m.time * sampleRate));
    if (m.type === "on") this.synth.schedule({ frame, type: "on", note: m.note, velocity: m.velocity });
    else if (m.type === "off") this.synth.schedule({ frame, type: "off", note: m.note });
    else this.synth.schedule({ frame, type: "silence" });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    if (!out || !left) return true;
    if (this.mono.length !== left.length) this.mono = new Float32Array(left.length);
    this.mono.fill(0);
    this.synth.frame = currentFrame;
    this.synth.process(this.mono);
    for (const ch of out) ch.set(this.mono);
    return true;
  }
}

registerProcessor(NOVA_PROCESSOR, NovaProcessor);

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
