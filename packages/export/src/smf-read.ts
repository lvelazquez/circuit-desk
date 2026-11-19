// A minimal Standard MIDI File reader, for tests and for checking exports.
export interface ReadNote { track: number; channel: number; pitch: number; velocity: number; tick: number; dur: number }
export interface ReadSmf { format: number; ppq: number; tracks: { name: string; endTick: number }[]; notes: ReadNote[]; ccs: { track: number; channel: number; tick: number; cc: number; value: number }[]; tempos: { tick: number; bpm: number }[]; markers: { tick: number; text: string }[]; problems: string[] }

export function readSmf(b: Uint8Array): ReadSmf {
  let p = 0;
  const u8 = (): number => { const v = b[p++]; if (v === undefined) throw new RangeError("unexpected end of file"); return v; };
  const u16 = (): number => (u8() << 8) | u8();
  const u32 = (): number => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const id = (): string => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = (): number => { let v = 0, c: number; do { c = u8(); v = (v << 7) | (c & 127); } while (c & 128); return v; };
  if (id() !== "MThd" || u32() !== 6) throw new Error("not a MIDI file");
  const format = u16(), ntracks = u16(), ppq = u16();
  const out: ReadSmf = { format, ppq, tracks: [], notes: [], ccs: [], tempos: [], markers: [], problems: [] };
  for (let t = 0; t < ntracks; t++) {
    if (id() !== "MTrk") throw new Error(`track ${t}: bad chunk`);
    const len = u32();
    const end = p + len;
    let tick = 0, status = 0, name = "";
    const open = new Map<number, { tick: number; velocity: number }>();
    while (p < end) {
      tick += vlq();
      let s = u8();
      if (s < 0x80) { s = status; p--; } else status = s;
      if (s === 0xff) {
        const type = u8(), len = vlq(), data = b.slice(p, p + len); p += len;
        const text = String.fromCharCode(...data);
        if (type === 0x03) name = text;
        if (type === 0x06) out.markers.push({ tick, text });
        if (type === 0x51) out.tempos.push({ tick, bpm: 60_000_000 / (((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0)) });
        continue;
      }
      const kind = s & 0xf0, ch = s & 15;
      if (kind === 0x90 || kind === 0x80) {
        const key = u8(), vel = u8(), k = ch * 128 + key;
        if (kind === 0x90 && vel > 0) {
          if (open.has(k)) out.problems.push(`track ${t}: key ${key} starts again at ${tick} while still sounding`);
          open.set(k, { tick, velocity: vel });
        } else {
          const on = open.get(k);
          if (!on) { out.problems.push(`track ${t}: note-off for key ${key} at ${tick} with no note-on`); continue; }
          open.delete(k);
          out.notes.push({ track: t, channel: ch, pitch: key, velocity: on.velocity, tick: on.tick, dur: tick - on.tick });
        }
      } else if (kind === 0xb0) { const cc = u8(), value = u8(); out.ccs.push({ track: t, channel: ch, tick, cc, value }); }
      else if (kind === 0xc0 || kind === 0xd0) u8();
      else { u8(); u8(); }
    }
    if (open.size) out.problems.push(`track ${t}: ${open.size} notes never end`);
    out.tracks.push({ name, endTick: tick });
  }
  return out;
}
