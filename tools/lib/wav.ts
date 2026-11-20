// Reads WAV files (PCM 16/24/32-bit integer, 32-bit float, plain or WAVE_FORMAT_EXTENSIBLE) into
// float channels. Writing uses encodeWav from @circuit-desk/engine.

export interface Wav {
  sampleRate: number;
  channels: Float32Array[];
}

export function readWav(b: Uint8Array): Wav {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (b.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let format = 0, ch = 0, rate = 0, bits = 0;
  let data: { at: number; size: number } | null = null;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === "fmt ") {
      format = v.getUint16(body, true); ch = v.getUint16(body + 2, true); rate = v.getUint32(body + 4, true); bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // the sub-format GUID's first two bytes
    } else if (id === "data") data = { at: body, size: Math.min(size, b.length - body) };
    o = body + size + (size & 1);
  }
  if (!data || !ch || !rate) throw new Error("no fmt or data chunk");
  if (!((format === 1 && (bits === 16 || bits === 24 || bits === 32)) || (format === 3 && bits === 32))) throw new Error(`unsupported WAV format ${format}, ${bits}-bit`);
  const step = bits / 8, frames = Math.floor(data.size / (step * ch));
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const o = data.at + (i * ch + c) * step;
      let x: number;
      if (format === 3) x = v.getFloat32(o, true);
      else if (bits === 16) x = v.getInt16(o, true) / 0x8000;
      else if (bits === 24) x = (((b[o + 2]! << 24) | (b[o + 1]! << 16) | (b[o]! << 8)) >> 8) / 0x800000;
      else x = v.getInt32(o, true) / 0x80000000;
      channels[c]![i] = x;
    }
  }
  return { sampleRate: rate, channels };
}

/** The channels averaged into one. */
export function mono(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0, out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i]! += c[i]! / channels.length;
  return out;
}

/** Joins recorded blocks into one channel. */
export function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
