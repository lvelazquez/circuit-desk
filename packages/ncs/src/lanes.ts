// What each automation lane drives. Source: the firmware's automation table 0x08059080 as traced
// upstream (circuit-hacks-rc docs/NOTAS.md:1178 for drums, :1682 for note tracks; snapall.py writes
// synth macro m to lane m). Not checked on a device by us: status "partial".

export type LaneKind = "synth" | "midi" | "drum";

export interface LaneInfo {
  /** 1-based, as shown. */
  lane: number;
  name: string;
  /** For MIDI tracks' knob lanes: the CC sent with the device's default MIDI template. */
  defaultCc?: number;
}

/** The CCs of the 8 knobs in the device's default MIDI template (sd_app.html:155 CC_DEF). */
export const DEFAULT_TEMPLATE_CCS = [1, 2, 5, 11, 12, 13, 71, 74] as const;

const MIX = ["Level", "Reverb send", "Delay send", "Pan"] as const;

export function laneInfo(kind: LaneKind, lane: number): LaneInfo {
  const i = lane - 1;
  if (kind === "drum") {
    if (i < 4) return { lane, name: `Drum knob ${i + 1}` };
    return { lane, name: MIX[i - 4] ?? `Lane ${lane}` };
  }
  if (i < 8) {
    if (kind === "synth") return { lane, name: `Macro ${i + 1}` };
    const cc = DEFAULT_TEMPLATE_CCS[i]!;
    return { lane, name: `Knob ${i + 1} (CC ${cc} on the default template)`, defaultCc: cc };
  }
  return { lane, name: MIX[i - 8] ?? `Lane ${lane}` };
}

export const LANE_EVIDENCE = "firmware automation table 0x08059080, traced upstream (NOTAS:1178, :1682); not checked on a device";
