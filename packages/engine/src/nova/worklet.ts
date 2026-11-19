// The AudioWorklet processor for one Nova synth part. Loaded with audioWorklet.addModule(url); the
// app gets the bundled url from Vite ("@circuit-desk/engine/nova-worklet?worker&url").
import { NOVA_PROCESSOR, type NovaMessage } from "./protocol.ts";
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
