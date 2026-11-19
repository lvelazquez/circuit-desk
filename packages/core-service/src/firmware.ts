// The firmware the user's Circuit Tracks runs. It changes what the app treats as live data and how
// it previews, never what it keeps: every byte (stock and CIRCUIT-HACKS) is preserved either way.
// Add a profile here to support another firmware.

export interface FirmwareProfile {
  id: FirmwareId;
  name: string;
  /** A label that fits the toolbar. */
  short: string;
  /** Builds known to match this profile. */
  versions: string;
  description: string;
  /** CIRCUIT-HACKS data (extra lanes XLN1, scene rules SCN3, CTM1 patches, the tail) is read by the device. */
  circuitHacks: boolean;
  /** What MIDI 1 / MIDI 2 are on the device. */
  midiTracks: "external" | "own-synth";
}

export type FirmwareId = "official" | "circuit-hacks";

export const FIRMWARES: readonly FirmwareProfile[] = [
  {
    id: "official",
    name: "Novation official",
    short: "Official 1.2.1",
    versions: "1.2.1 (build 4486)",
    description: "The stock firmware. MIDI 1 and 2 drive external gear; CIRCUIT-HACKS data in a file is kept but not used by the device.",
    circuitHacks: false,
    midiTracks: "external",
  },
  {
    id: "circuit-hacks",
    name: "CIRCUIT-HACKS",
    short: "CIRCUIT-HACKS",
    versions: "RC builds on 1.2.1 (circuit-hacks-rc)",
    description: "MIDI 1 and 2 can play the own synth engines; extra automation lanes, scene rules and Master FX are live. Synth 1 and 2 are the stock voice.",
    circuitHacks: true,
    midiTracks: "own-synth",
  },
];

export const DEFAULT_FIRMWARE: FirmwareId = "official";

export function firmwareProfile(id: string): FirmwareProfile {
  const f = FIRMWARES.find((x) => x.id === id);
  if (!f) throw new Error(`no firmware "${id}"; choose one of ${FIRMWARES.map((x) => x.id).join(", ")}`);
  return f;
}
