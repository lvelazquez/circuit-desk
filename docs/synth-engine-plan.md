# Synth engine: plan

**Status (2026-11-19):** draft for the owner's review. It follows [`synth-engine-brief.md`](synth-engine-brief.md) and refines its phases E0–E4 with what the kickoff found.
**Rule for this plan:** no device or card writes. Device reads (SysEx dump requests) need approval at the time.

## 1. What the kickoff found

### 1.1 Novation documents the 340 B patch format, and it matches the card

- **Source:** *Circuit Tracks Programmer's Reference Guide* v3, "Synth Patch Format", pp. 16–22.
  - Official download: `fael-downloads-prod.focusrite.com/customer/prod/downloads/circuit_tracks_programmer_s_reference_guide_v3.pdf`, linked from `downloads.novationmusic.com/novation/circuit/circuit-tracks`.
  - Keep the PDF local and don't commit it. The code holds only the table: addresses, names, ranges and defaults.
- **Layout:** one byte per parameter, addresses 0–339.

  | Addresses | Contents |
  |---|---|
  | 0–15 | name (ASCII) |
  | 16 | category (0–14) |
  | 17 | genre (0–9) |
  | 18–31 | reserved |
  | 32–35 | voice |
  | 36–53 | osc 1 and 2 |
  | 54–59 | mixer |
  | 60–68 | filter |
  | 69–83 | envelopes 1–3 |
  | 84–99 | LFO 1 and 2; the last byte of each is a bit field |
  | 100–123 | distortion, chorus and EQ, with 8 reserved bytes |
  | 124–203 | mod matrix: 20 slots × (source 1, source 2, depth, destination) |
  | 204–339 | macros: 8 knobs × (position + 4 × (destination, start, end, depth)) |
- **Card sweep** (read-only, `tools/patch-sweep.ts` to be added in E0): 1,050 patches checked, made up of the 304 project patches (152 × 2) and 746 bank records.
  - **All 1,050 are in range for all 324 ranged bytes.**
  - Every reserved byte is 0.
  - Every name is printable ASCII.
  - Every value in the histograms is plausible: categories 0–14; all 30 oscillator waves used; macro destinations from 0–70 used.
- **So the layout is confirmed on the corpus.** One device dump (§1.5) confirms it on the device.

### 1.2 The engine is smaller than the brief assumed

The Tracks synth is the original Circuit's Nova-derived voice:
- 2 oscillators with 30 waves:
  - 0–13 are analytic: sine, triangle, saw, nine saw/pulse-width blends, pulse, square;
  - 14–29 are 16 wavetables, swept by "wave interpolate";
- per oscillator: pulse width or index, virtual sync, density and density detune;
- a ring modulator and noise;
- one multimode filter with 6 types and 7 drive types;
- 3 envelopes;
- 2 LFOs with 38 waveforms;
- a 20-slot mod matrix (13 sources, 18 destinations);
- 8 macros × 4 destinations;
- per-patch distortion, chorus or phaser, and a 3-band EQ.

It has **no FM, granular or other mod engines.** Two existing documents disagree with this:
- `PLAN.md` "Sound engine options", row S1, lists "mod engines (FM-8, wavetable, granular) extra";
- the brief's 172 B record padding holds CIRCUIT-HACKS' own synth.

Those engines belong to CIRCUIT-HACKS, not to the stock patch. That matters for scope:
- S1's core is one well-documented voice, which supports the brief's "recommended main line";
- emulating the CIRCUIT-HACKS engines is a separate, later question (see D-9).

Use of wavetables on the card: 748 of the 2,100 oscillator slots (36 %) select a wavetable (waves 14–29). So D-1 affects a third of the sounds.

### 1.3 Corrections to the brief

| Brief said | Card says |
|---|---|
| "9 packs × 16 banks × 8 records" | **96** `.cpb` files hold **746** records. A bank's **last record has no padding**: 92 files are 3,924 B (7 × 512 + 340), 2 are 1,876 B (3 × 512 + 340) and 2 are a bare 340 B. The bank reader must use a stride of 512 and allow a short last record |
| Project patches are bank patches | 302 of 304 project patches share a name with a bank record, but only **28** are byte-identical. A project stores the patch **as edited** (macro positions and so on), so the project copy is what preview must play |
| (not covered) | Padding: 650 of 746 bank records have non-zero bytes in the 172 B after the patch (CIRCUIT-HACKS data). Never touch it |
| (not covered) | Guide errata: address 260 is printed as "2v". Some defaults differ between the CC table and the patch table (wave interpolate 0 vs 127, pulse width 127 vs 64, chorus rate 84 vs 20). **Use the patch table for file defaults** |

### 1.4 Answers to the brief's open questions (§8)

| # | Question | Answer now | Still open |
|---|---|---|---|
| 1 | Does the 340 B match Novation's format? | Yes on the corpus (§1.1) | One device dump |
| 2 | Which Nova features does Tracks have? | §1.2: 30 waves, 6 filter types, 20 mod slots, chorus, distortion, EQ, 3 envelopes, 2 LFOs | The response curves (value → Hz, seconds); see E4 |
| 3 | Macro assignments, and how lanes 1–8 address them | Each macro knob has 4 slots: destination (0–70), start, end and depth. Lanes 1–8 most likely carry the knob **position** (CC 80–87) | **The guide has no table for the 71 macro destinations**, so what 0–70 mean is unknown. See E0.4 |
| 4 | USB audio | Unchanged: no evidence. The guide mentions USB only for MIDI and SysEx | D-5 |
| 5 | Drum knobs and where they are stored | The guide lists them: patch select, level, pitch (±64), decay, distortion, EQ (±64), pan (±64). The 11 B drum record matches this in order (§1.6) | One controlled diff per byte |

### 1.5 The read-only device path exists

These commands come from the guide's "Synth Patch Sysex Message Formats" section, pp. 13–14:

| Command | What it does | Writes to the device? |
|---|---|---|
| `F0 00 20 29 01 64 40 <0/1> F7` | Current patch dump request for Synth 1 or 2. The device answers on USB with a 350 B "Replace current patch" message | No |
| Program change (0–63) on channel 1 or 2, then the dump request | Dumps a patch stored in flash | It changes the selected patch, which is device state. Approval-gated |
| `…64 00 <loc> 00 <340 B> F7` | "Replace current patch": RAM only, not saved | **Yes (to RAM).** See D-7 |
| `…64 01 <n> 00 <340 B> F7` | "Replace patch": overwrites a patch in flash | **Yes (flash). Never, under this plan** |

There's also a portable file format: a single-patch `.syx` file is one "Replace current patch" message (Synth 1), and a bank is 64 "Replace patch" messages. Exporting a patch as `.syx` is a cheap, device-free deliverable.

### 1.6 Corpus hints for E3 (hypotheses, not decoded)

These are value profiles across 152 projects. Each needs one controlled diff (`tools/diff-ncs.ts`) before it counts as `partial` or `verified`.

- **Drum record, 11 B at `0x26FBC`:** +0 sample (0–63), +1 level (100 is typical), +2 pitch (64 is centre), +3 decay (mostly 127), +4 distortion (mostly 0), +5 EQ (64 is centre), +6 pan (64 is centre). +7 to +10 are always 0. This is the guide's drum control list in its own order.
- **Project params, 60 B at `0x26FE8`:**
  - +32..+51 are four 5-byte groups. Each reads as sidechain (source 0–3, attack, hold, decay, depth), with defaults 0, 0, 50, 70, 0 exactly as in the guide's "Sidechain" table. That would mean four tracks have sidechain (Synth 1, Synth 2, and likely MIDI 1 and 2), not the two the guide lists.
  - +52..+55 read as levels (mostly 100); +56..+59 as pans (mostly 64).
  - +8 is 0–5 (mostly 2), which reads as reverb type (default 2). +9 and +10 range 64–120 and read as reverb decay and damping.
  - +24..+29 read as delay: time, time sync (default 20), feedback (64), width (127), L/R ratio 3–6, slew (5).
  - +0..+7 and +16..+23 read as the 8 tracks' reverb and delay sends.

## 2. Decisions for the owner

Each decision comes with my recommendation, so the plan can go ahead on the defaults until the owner says otherwise.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D-1 | Wavetables (waves 14–29) | **Approximate first, dump later.** Waves 0–13 are analytic, so they're exact in shape with no device. Build waves 14–29 from the guide's names (sine table, analogue pulse/sync, triangle-saw blend, digital nasty, vocal, random) as placeholder tables of the same shape (n frames swept by interpolate). Swap in a local device dump (`study_novawaves.py`) when you approve it | 64 % of the card's oscillators need no dump; the engine's code doesn't change when real tables arrive |
| D-2 | Where the DSP runs | **TypeScript AudioWorklet**, with pure DSP modules and no Web Audio nodes inside the voice. Move to WASM only if a measured budget fails: 2 synths × 6 voices × full density above ~30 % of one core on the M-series machine | Matches the repo (erasable TS, Node runs the sources); the DSP is small |
| D-3 | First milestone sound | **One engine done well:** Synth 1/2 core = oscillators, mixer, filter, the 3 envelopes and polyphony modes. Then LFOs, the matrix and macros; then the per-patch FX | There's only one synth engine (§1.2), so "all engines roughly" no longer applies |
| D-4 | Accuracy target | **"Recognisable by ear" for E2.** Add a measured threshold in E4, only once D-5 provides recordings | The response curves (value → Hz or seconds) can't be known without measurement |
| D-5 | Reference recordings | **Record the Circuit's main outputs into an interface** when the device is back, using a fixed test-pattern project (one note per parameter sweep) | No evidence of USB audio |
| D-6 | S2 spike timing | **Later: park it until E2 is done**, then decide with E2's measured gaps | The engine is smaller than feared, so the case for bit-accurate emulation is weaker |
| D-7 (new) | Audition edits on the real Circuit with "Replace current patch" (RAM only, not saved) | **Allow it after E1, approved per session.** It's the S0 way to hear an edit exactly, before the emulator is accurate | It's still a device write, so your call |
| D-8 (new) | When patch fields become editable | **Promote all 340 B patch fields to `verified` together after one device dump matches the file byte for byte.** Until then, patch editing is read-only in the app and MCP, as the registry rule says | The corpus already confirms ranges; the dump confirms the layout on the device in one step |
| D-9 (new) | CIRCUIT-HACKS synth (the 172 B padding) | **Out of scope for S1.** Preserve it byte for byte; show "CIRCUIT-HACKS data present" in the browser | It's a different engine with its own documentation (`patchtool.py`) |

## 3. Phases

Each phase lists its parts, then its **Accept** criteria. Tests stay synthetic in the repo; card and device data stay local.

### E0. Patch decode (no device needed except E0.5)

- **E0.1 Format table as data.** A new package `packages/patch`:
  - `format.ts`: 340 entries holding address, id, section, min, max, default, display (bipolar ±64, dB −12 to +18, enum labels, bit fields for LFO bytes 91 and 99), CC/NRPN number and evidence ("PRG v3 p.16–22").
  - Enum tables: oscillator waves, filter, drive and distortion types, LFO waves, mod sources and destinations, delay L/R ratios.
  - Generated once from the extracted PDF text by a local tool. The generated `.ts` is committed; the PDF is not.
- **E0.2 Model.** `parsePatch(bytes) → Patch`, a typed, grouped view: voice, osc[2], mixer, filter, env[3], lfo[2], fx, eq, modMatrix[20], macros[8][4]. `buildPatch(Patch, base)` writes only the changed bytes.
  - `initPatch()` builds the guide's defaults. It's the synthetic fixture, named "Initial Patch" by the guide's own default bytes.
- **E0.3 Containers.**
  - `bank.ts`: `.cpb` reader and writer. Stride 512, short last record allowed, padding opaque and preserved.
  - `sysex.ts`: parse and build the 350 B "Replace current patch" message; read and write `.syx` single-patch files.
  - In `ncs`: registry entries `patch.synth1` and `patch.synth2` link to the patch package's field table; status per D-8.
- **E0.4 Macro destinations 0–70.** The guide has no table. To settle it:
  - (a) Look for the list in Novation Components' public web editor bundle (the Circuit Tracks synth editor names every macro target).
  - (b) If that fails: on the device, set one macro slot's destination by NRPN (`3:0`) and watch which parameter the macro moves. This is MIDI-only and touches no flash, but it is device state, so approval-gated.
  - (c) Corpus check: a factory patch's macro names (shown by Components) against its destination numbers.
  - Until settled, macros parse with numeric destinations, and the voice applies only those that are known.
- **E0.5 Device check (approval-gated, read-only):** load a known project, send the current patch dump request for Synth 1 and 2, and compare the dumps with the file's 340 B.
  - Lets D-8 happen.
- **Accept:**
  - The `tools/patch-sweep.ts` sweep keeps 1,050/1,050 in range.
  - Parse → build is byte-identical for every project patch, bank file and `.syx` file in the card copy.
  - Bank padding is unchanged (hash per record).
  - A one-field edit changes exactly one byte (`changedRanges`).
  - `npm test` and `typecheck` stay clean.

### E1. Patch browser and editor (no sound change yet)

- **Pack view:** a bank × patch grid (up to 16 banks × 8). Each patch shows name, category and genre; patches with CIRCUIT-HACKS data are marked.
  - Filter by category and genre.
  - Each pack patch shows "used by" (projects whose patch index points at it, from `synthPatchIndex`). The index reading is partial; it gets confirmed with the corpus by matching name plus index.
- **Patch editor:** pages that mirror the device's knob sections: Voice, Osc 1, Osc 2, Mixer, Filter, Env 1–3, LFO 1–2, FX/EQ, Mod Matrix, Macros.
  - Controls are named sliders (`role="slider"`, arrow and Page keys, `aria-valuetext` in display units).
  - Tokens only; no new motion except existing token pairs, and reduced-motion handled.
  - Edits go through the `ProjectService` edit and undo history, as notes do.
  - Read-only until D-8.
- **Where edits go:**
  - A project's Synth 1/2 patch edits save into the project copy (`~/Circuit Desk/Copies`).
  - A pack patch edit writes a copy of the `.cpb`.
  - Export the patch as `.syx`.
  - No card writes until P5.
- **MCP:** `list_pack_patches`, `get_patch`, `set_patch_params` (verified fields only, with validation errors in display units), `export_patch_syx`.
- **Accept:**
  - Smoke checks: open a pack, browse with the keyboard only, open a patch, change a value (once D-8 allows it), undo, save a copy, and confirm the copy differs only in that patch's bytes.
  - MCP tests over the in-memory transport.

### E2. Voice v1 (behind `Instrument`)

- **Location:** `packages/engine/src/nova/`. Pure DSP over `Float32Array` blocks, no DOM. Wrapped by one AudioWorklet processor (`nova-worklet.ts`) and an `Instrument` adapter (`InstrumentKind` gains `"nova"`). The stand-in `Synth` stays as the fallback.
- **Units,** each with its own vitest tests (spectra and envelopes measured on rendered buffers):
  - **Oscillators:** waves 0–13 band-limited (polyBLEP or minBLEP); pulse width or index; virtual sync; density (stacked detuned copies); semitones, cents and pitch-bend range; wavetables 14–29 per D-1.
  - **Mixer:** levels for osc 1 and 2, ring mod 1×2 and noise; pre-FX level.
  - **Filter:** LP 12/24, BP 6/6 and 12/12, HP 12/24 (state-variable or ladder, chosen by measurement); resonance; Q normalise; key tracking; env 2 → frequency; drive with 7 types; the 3 routing modes.
  - **Envelopes 1–3:** env 1 = amp, env 2 = filter, env 3 = mod with delay; velocity amount.
  - **Voice:** polyphony modes Mono, Mono AG and Poly (6 voices, oldest stolen); portamento; pre-glide; keyboard octave.
  - **LFOs 1–2:** 38 waves (the sequences, arpeggio and chord shapes are approximated from their names until measured); phase; slew; delay with fade and gate modes; one-shot, key sync and common sync; tempo sync from the transport.
  - **Mod matrix:** 20 slots, source 1 × source 2 × depth → 18 destinations.
  - **Macros:** position → 4 slots (start, end, depth), for the destinations E0.4 settles. Automation lanes 1–8 drive the macro positions; `control(cc 80–87)` does too.
  - **Per-patch FX:** distortion (7 types, compensation), chorus or phaser, 3-band EQ. Post-FX level.
- **Response curves** (attack 0–127 → seconds, frequency 0–127 → Hz, LFO rate → Hz) start as named, documented guesses in one `curves.ts`, so E4 can replace them in one place.
- **Accept:**
  - Unit tests per part.
  - A golden render of a synthetic project using `initPatch()` plus a few hand-built patches (deterministic hash).
  - CPU budget per D-2, measured in the app.
  - In the app, the factory projects' Synth 1/2 play their own patches. This is checked by ear against the device when it's available, which is D-4's "recognisable" bar.

### E3. FX, mixer and drums

- **Decode first** with controlled diffs of the §1.6 hypotheses:
  - drum record +1..+6;
  - project params: sends, reverb, delay, sidechain ×4, levels, pans, master filter, FX bypass.
  - Each gets a registry entry with evidence. Values the guide gives (ranges, defaults, enum labels) come from it.
- **Engine:**
  - Mixer level and pan per channel strip.
  - Reverb with 6 types: an algorithmic stand-in, decay and damping.
  - Delay: time or sync, feedback, width, L/R ratio, slew.
  - Sidechain duck per source drum.
  - Master filter (LP to off to HP).
  - Drum knobs on the sampler: pitch (resample), decay (amp envelope), distortion, EQ (tilt), pan, level.
- **Accept:**
  - Registry statuses updated with evidence.
  - Golden renders show sends, ducking and pan in measured buffers.
  - Swing and probability come from the scheduler, as a separate small item.

### E4. Accuracy loop (needs D-5)

- **Test project:** one note per parameter step (envelope times, filter sweep, LFO rates, each wave). Record it from the Circuit's outputs, then render it offline with the same project.
- **Analysis:** align per note and compare spectrum, envelope and level. The fitted values replace the guesses in `curves.ts`.
- **Golden pairs** stay local (`~/Circuit Desk/Reference/`). A distance metric is tracked by a test that skips when the files are absent.
- **Accept:** each curve is fitted within an owner-set threshold (D-4). Remaining gaps are listed for the S2 decision (D-6).

### S2 spike

Parked per D-6; R-S2 in `PLAN.md` is unchanged.

## 4. Order and size (estimates)

| Step | Needs | Estimate |
|---|---|---|
| E0.1–E0.3 | nothing | 2–3 days |
| E0.4 | the Components bundle, or the device | ½–2 days |
| E0.5 | device + approval | ½ day |
| E1 | E0 (editing needs D-8) | 1–1½ weeks |
| E2 core (osc, mixer, filter, envelopes, voice) | E0 | 2 weeks |
| E2 rest (LFOs, matrix, macros, FX) | E2 core, E0.4 | 1½–2 weeks |
| E3 | controlled diffs on the device | 1½–2 weeks |
| E4 | D-5 recordings | 1–2 weeks, then ongoing |

What can start today with no device: E0.1–E0.3, E1 browsing (read-only), E2 core.

## 5. Constraints (carried over from the brief §6)

- Commit no proprietary assets: no PDF, firmware, wavetables, pack patches or samples, recordings. Repo fixtures are synthetic (`initPatch()` and hand-built patches).
- No device writes (D-7 is the only proposed exception, and it needs approval). Read-only dump requests need approval at the time.
- Patch edits change only that patch's bytes (`changedRanges`); the 172 B padding is never touched.
- TypeScript strict, erasable syntax; named tokens in the UI; keyboard paths, focus order and `prefers-reduced-motion` are acceptance criteria.
