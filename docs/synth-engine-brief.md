# Synth engine: kickoff brief

**Purpose:** the starting point for planning a Circuit Tracks synth emulator inside Circuit Desk, so that projects and packs preview accurately and sounds can be edited.
**Status (2026-11-19):** groundwork built (the preview engine); the emulator itself is not started.
**Use:** hand this file to a planning session as its context. Everything below points at files that exist, or names what is still unknown.

## 1. Goal (owner's words)

> "I'd eventually like a synth engine emulator and a way to accurately preview the packs and edit sounds."

In practice this breaks into four parts:
1. **Preview:** Synth 1 and 2 sound like their patches, and drums like the Circuit's drum engine with its settings.
2. **Pack browsing:** audition every patch and sample in a pack.
3. **Sound editing:** edit a patch's parameters in the app and hear the change.
4. **Write-back:** edited patches go back into the project or the pack, losslessly, through the card safeguards (plan P5).

## 2. What exists today

Everything is in `~/Personal Repo/circuit-desk` (branch `feat/core-export-mcp`). The engine design is in [`PLAN.md`](PLAN.md), section "Preview engine".

| Piece | Where | What it gives the emulator |
|---|---|---|
| `Instrument` interface | `packages/engine/src/types.ts` | `noteOn / noteOff / control / silence / dispose`. A new synth or drum engine plugs in here; the scheduler, playhead, mixer and UI stay unchanged |
| `PreviewEngine` | `packages/engine/src/engine.ts` | 8 channel strips → master → limiter. It takes the scheduler's timed messages, including `track` and the drum `sample` flip. Works on `AudioContext` and `OfflineAudioContext` |
| Stand-in synth | `packages/engine/src/synth.ts` | A 6-voice subtractive voice driven by plain data (`SynthPatch`, `STAND_IN_PATCHES`). Replace it or map onto it |
| Pack sampler | `packages/engine/src/sampler.ts` | The pack's WAVs. Byte 0 of each drum record gives the drum's sample, checked against sample names on 8 factory projects. Sample flips work; a new hit cuts the previous one |
| Offline render | `packages/engine/src/render.ts` | Arrangement → WAV (File › Export Preview Audio; `npm run app:render -- <ncs>`). The basis for golden-render accuracy tests |
| Scheduler | `packages/playback/src/schedule.ts` | Notes, CC (MIDI 1/2 automation) and clock, with lookahead and sample-accurate timestamps |
| Automation lanes | `packages/ncs/src/lanes.ts` | Lane meanings from the firmware table (partial). Synth lanes 1–8 are macros 1–8; lanes 9–12 are level, reverb, delay and pan |
| Lossless file model | `packages/ncs` | Opens and edits `.ncs` byte-for-byte safely; a field registry gates what may be edited. New patch fields join this registry |
| Pack view | `app/src/PackView.tsx` | 64 samples you can audition. The planned home for the patch browser and editor |
| Tests | `npm test` (77), `npm run app:smoke` (33 checks) | The smoke test already renders a WAV and checks its length and silence at the end |

**Not modelled at all yet:**
- Nova synthesis;
- drum knobs (pitch, decay and so on);
- mixer level and pan;
- FX: reverb, delay, sidechain, master compressor;
- swing and probability;
- synth macros.

## 3. Data sources

| Source | Location | Status |
|---|---|---|
| Synth 1 / 2 patches inside a project | `.ncs` at `0x26D14` and `0x26D14 + 340` (340 B each; `layout.ts` `PATCH0`, `PATCH_SIZE`) | Opaque in our registry (`patch.synth1/2`, unknown) |
| Patch index of Synth 1 / 2 | `.ncs` `0xCD64 + 0` / `+ 8` (`SYNTH_GAP`) | Partial (`sd_app.html:1029`) |
| Pack patch banks | `Tracks/NN_Pack/Patches/NN_PATCHBANK.cpb`: 16 files per pack, each 8 records × 512 B. A record is a 340 B stock patch plus 172 B of padding | Layout from upstream `tools/patchtool.py` and `tools/mpatch.py`. The padding holds CIRCUIT-HACKS' own synth, which `patchtool.py` documents fully; the stock 340 B is not decoded upstream ("Components' business") |
| **Novation's patch format** | *Circuit Tracks Programmer's Reference Guide* (v3), section "Synth Patch Format", plus the SysEx patch dump requests | **Public.** This is the primary source for decoding the 340 B; get the PDF from novationmusic.com/downloads. Confirm it matches our 340 B before trusting it |
| Synth parameter CC / NRPN map | Same guide | Gives names and ranges per parameter; also how to drive the real Circuit when A/B testing |
| Drum samples | `Tracks/NN_Pack/PCM/NN_Name.wav` (64 per pack, 48 kHz, 16-bit, mono) | Used today |
| Drum settings | `.ncs` drum block `0x26FBC` (4 × 11 B; byte 0 = sample), project params `0x26FE8` (60 B), loose settings `0x26CFC` | Mostly unknown; value ranges in `docs/card-survey.md` |
| Novation Components validator | `circuit-hacks-rc/ext/circuittracksreverseengineering/Assets/Novation-Components/` | Its range and error messages list the checked fields |
| Nova wavetables | Upstream `tools/study_novawaves.py` and `tools/novadump.py` copy the oscillator waves from the device's DSP over USB | Needs the device and a CIRCUIT-HACKS diagnostic build; output stays local (`re/`, never published). Owner's call (D-1 below) |
| DSP firmware | Your official firmware image (local, from `circuit-hacks-rc/stock/`), DSP56724 code; upstream dsp56300 emulator | For the bit-accurate route only (S2) |
| Your card copy | `~/Circuit Desk/Card copy/2026-11-19/Tracks` (9 packs, 152 projects) | Decode test corpus; local only |

## 4. Two routes (from the plan's sound tiers)

| | **S1: modelled emulator** | **S2: run the real DSP code** |
|---|---|---|
| What | A Nova-like voice in TypeScript (AudioWorklet, later WASM if needed): oscillators with wavetables, filter, envelopes, LFOs, mod matrix, macros, FX. Driven by decoded patches | The official DSP56724 programs on a dsp56300 emulator (Gearmulator's approach) plus enough of the ARM side and the I/O |
| Accuracy | "In the family"; gets closer with measurement | Exact, including the mod engines |
| Effort (estimate) | 6–12 weeks for synths that sound close; drums and FX extra | Months; real-time on Apple silicon unproven |
| Legal and asset notes | Wavetables must come from your own device dump, kept local | Needs your firmware image locally; never distributed |
| Plan status | **Recommended main line** | Time-boxed 2-week research spike (plan R-S2) |

Both routes share a step: **decode the patch format first.** S1 needs the parameters; S2 needs to load patches into the emulated DSP.

## 5. Proposed phases (for the planning session to refine)

- **E0. Patch decode.**
  - Parse the 340 B with Novation's Synth Patch Format table into a typed model.
  - Add it to the `ncs` field registry (`verified` only where confirmed).
  - Run the parser over every patch in the card copy: 152 projects × 2 patches plus 9 packs × 16 banks × 8 records. Every value must be in range, and a parse → build round trip must be byte-identical.
  - **Device step:** dump one patch over SysEx (read-only request) and compare it with the file.
- **E1. Patch browser and editor (no sound change yet).**
  - In the Pack view: banks × patches, names and categories, parameters grouped by page, editable through the same edit-and-undo service as notes.
  - Write-back goes to copies only, until P5 card writes exist.
  - Add MCP tools: `get_patch`, `set_patch_params`.
- **E2. Voice v1** (behind `Instrument`). Parts, each a small DSP unit with its own tests:
  - oscillators: wave set, wave interpolation, density and detune per the guide;
  - filter: types per the guide;
  - amp, filter and mod envelopes;
  - LFOs;
  - mod matrix;
  - macros mapped from the patch's macro assignments;
  - automation lanes 1–8 driving the macros.
  - Runs in an AudioWorklet; keep the DSP pure, with no Web Audio nodes in the voice, so it can move to WASM.
- **E3. FX, mixer and drums.**
  - Project FX (reverb, delay), sidechain, mixer level and pan once decoded (decode track).
  - Drum knob parameters on the sampler: pitch, decay, distortion, EQ.
- **E4. Accuracy loop.**
  - Record the real Circuit per track (from its audio outs; USB audio is unconfirmed).
  - Render the same project offline.
  - Compare per note: spectrum, envelope and level.
  - Keep golden pairs local; track a distance metric in CI-style tests.
- **S2 spike** (parallel, time-boxed): the go/no-go memo from the plan.

## 6. Constraints that carry over

- **Proprietary assets:** never commit firmware, wavetables, samples, patches from packs, or recordings of them. Repo fixtures are synthetic; real data stays under `~/Circuit Desk/` and `re/`.
- **The device:** no SysEx writes to it, no firmware flashing, no card writes without explicit approval at the time. Read-only dump requests are also approval-gated, because they talk to the device.
- **The codebase:**
  - TypeScript strict and erasable-syntax only (Node and Electron run the `.ts` files directly).
  - Named design tokens in the UI.
  - Keyboard paths, focus order and `prefers-reduced-motion` are acceptance criteria.
  - Evidence (file:line, a test, a measurement) for every decoded field.
- **Lossless editing:** a patch edit changes only that patch's bytes, checked with `changedRanges`. CIRCUIT-HACKS data after a patch (the 172 B padding) is never touched.

## 7. Decisions for the owner (before or during planning)

| # | Decision | Options |
|---|---|---|
| D-1 | Wavetables for S1 | dump from your own device with the upstream tool (accurate, local only) / approximate waves (no device needed, less accurate) |
| D-2 | Where DSP code runs | TypeScript AudioWorklet first (simplest) / Rust or C++ → WASM from the start (faster, more setup) |
| D-3 | First milestone sound | one engine (the oscillator synth) done well / all engines roughly |
| D-4 | Accuracy target | "recognisable" by ear / measured threshold against device recordings (needs D-5) |
| D-5 | Reference recordings | record the Circuit's outputs into an interface / skip measured comparison for now |
| D-6 | S2 spike timing | before S1 (decide the route first) / in parallel / later |

## 8. Open questions to answer early

1. Does the 340 B in our files match Novation's documented Synth Patch Format byte for byte? Check it on the card corpus, then with one device dump.
2. Which Nova features does the Tracks firmware's synth have (wavetable count, filter types, FX, mod matrix size)? The guide's parameter list answers this.
3. What are the macro knob assignments in a patch, and how do automation lanes 1–8 address them (value vs. depth)?
4. Can the Circuit Tracks stream audio over USB? The plan found no evidence. This decides how reference recordings are made.
5. Drum engine: what do the drum knobs do (pitch, decay, distortion, EQ), and where in the file are their per-project settings?

## 9. Suggested kickoff prompt

> Plan the Circuit Desk synth engine. Read `circuit-desk/docs/synth-engine-brief.md` first, then `docs/PLAN.md` (sections "Preview engine" and "Sound engine options"). Start with E0 (patch decode): find the Synth Patch Format in Novation's Circuit Tracks Programmer's Reference Guide, check it against the 340 B patches in my card copy, and propose the patch model and the field-registry entries. Surface decisions D-1 to D-6 for me. No device or card writes.
