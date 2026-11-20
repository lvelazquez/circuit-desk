# Synth engine: plan

**Status (2026-11-19, revision 2):** draft for the owner's review. It follows [`synth-engine-brief.md`](synth-engine-brief.md).
**Revision 2** folds in what the CIRCUIT-HACKS repo (`circuit-hacks-rc`) already knows about the stock firmware. That changes the macro work, the curve work, the drum and FX work and the role of the emulator. In this document NOTAS means `circuit-hacks-rc/docs/NOTAS.md`.
## Progress

**2026-11-19:** E0.1–E0.3 and the E-slice are built. Decisions were taken on the recommended defaults.

- **`packages/patch`:**
  - format table: 324 parameters plus the name, CC/NRPN, display units, 70 macro destinations mapped to parameter ids;
  - `parsePatch` and `buildPatch` (only changed bytes);
  - `.cpb` banks (padding classified and kept);
  - SysEx `.syx` files;
  - `applyMacros` (guessed formula).
  - On the card copy, every project and bank patch is in range and rebuilds byte for byte.
  - The `ncs` registry marks the two project patches `partial`.
- **`packages/engine/src/nova`:**
  - A pure-DSP voice: waves 0–13 (3–12 as two-saw pulses), placeholder wavetables, mixer, ring and noise, 6 filter types with drive, routing and Q normalise, 3 envelopes, Poly, Mono and Mono AG, portamento.
  - The mod matrix for direct, velocity, keyboard and envelope sources.
  - An AudioWorklet and `NovaInstrument`. Synth 1/2 play the project's own patches in the app and in Export Preview Audio (new read-only service method `synthPatches`).
- **Checks:**
  - `npm test`: 115 tests.
  - `app:smoke`: 33 checks. The piano-roll mouse step failed twice in a row, then passed 4 runs in a row; it looks like a timing race in the smoke script.
  - Hello Tracks renders.
- **Learned while building:**
  - **Factory patches lean on macros and the matrix.** Many leave oscillator levels at 0 and get them from a macro at its stored position (Juno Strings), a Direct matrix source, or an LFO (Bendy Piano, through the one-shot "Piano envelope").
  - So **E0.4 (the macro formula from the firmware) and LFOs move ahead of the rest of E2.**
  - The guessed macro formula made the corpus worse (120 silent, peak 4.6, against 55 and 1.6 without it), so the voice has it off (`APPLY_MACROS`).
  - Measure it again with `tools/nova-levels.ts` (add `--no-macros` to compare).
- **Tools:**
  - `tools/patch-show.ts`: a patch's non-default values.
  - `tools/nova-levels.ts`: peak distribution over the card.

**Glitch pass (2026-11-19):**
- **Clicks fixed** (`nova/clicks.test.ts`): retriggers, voice steals and mono note changes no longer restart a sounding voice mid-cycle. Envelope stages have declick floors (2 ms attack, 8 ms decay and release). All-notes-off fades.
- **Clipping fixed:** a soft clipper after the master limiter; a factory project, "Archived Fax", had 348 full-scale samples before, none after.
- **CPU:** 12 voices use under 7 % of one core.
- **Sound reports:** Transport › Capture Last 10 Seconds (⇧⌘R) saves audio, events and patches to `Exports/Reports/`. `tools/replay-report.ts` replays a report offline and locates jumps.

**Update 2026-11-19 (later):**
- **E0.4 is done.** The macro formula was read from the stock ARM routine (`0x08035F84`) and is in `packages/patch/src/macros.ts`; macros are on in the voice. Stored destination 0 means none and 1–70 select destinations 0–69, so the earlier code was off by one.
- **E0.6 has started.** A full parameter sweep through the stock ARM code ran (298 Synth 1 parameters). Results and method: [`firmware-oracle.md`](firmware-oracle.md).
- **The core-1 spike (D-6) is partly built.** The DSP emulator runs here and a core-1 stand-in serves core 0's table requests, but the audio output is still silent; the blocker and next steps are in `firmware-oracle.md`.

**Effects, first round (2026-11-20, plan E3 brought forward):** the built-in preview now plays the project's and patches' effects, with an FX switch in the toolbar to compare.
- **Settings decoded from the firmware's own descriptors** (`tools/firmware/descriptors.ts`): project block (reverb, delay, sends, FX bypass, four sidechains, levels, pans) and drum records (sample, level, pitch, decay, distortion, EQ, pan). `packages/ncs/src/sound.ts`; all 152 card projects decode, and every sidechain is one of the device's 8 presets.
- **Exact:** pan law, level shape, drum pitch ratio, drum tilt EQ, delay L/R time ratios, DSP order of the patch effects (distortion → EQ → chorus).
- **Approximate** (marked in `packages/engine/src/fx/curves.ts`): reverb (feedback-delay network), delay times and the 36 sync note lengths, chorus/phaser, the 7 distortion shapes, patch EQ frequencies, sidechain and drum-decay times.
- **Measured but not yet used:** a stock-ARM sweep of the project FX (`~/Circuit Desk/Firmware-derived/sweep-project-fx.json`): delay sync is linear in its index, feedback is value << 16, and each reverb type writes its own 8 algorithm words.
- **Not in this round:** master DJ filter and compressor (global settings), automation of levels, pans, sends and drum knobs.

**Automation playback (2026-11-20):** every lane now plays.
- **Preview:** synth macros move the patch (frame-timed in the Nova voice), level, pan and sends move in the mixer (5 ms glide), drum pitch and decay apply per hit, drum distortion and EQ in the mixer.
- **To a Circuit:** the same changes go out as CC from the Programmer's Reference (macros CC 80–87 on the synth channel; drum knobs, level and pan on channel 10; synth levels, pans and all sends on channel 16). MIDI 1/2 level, pan and sends have no documented CC and play in the preview only.
- **Assumptions:** a value holds until the next point; the device listens on the default channels with CC receive on; nothing is reset on the device at Stop.
- **Card:** all 152 projects arrange; Synth 1 macro automation is in 25 projects (`tools/automation-survey.ts`).
- **Editing (2026-11-20):** lanes are drawn with the pointer (a straight line between pointer positions; Alt erases) or edited from the keyboard in the Editor, for note tracks under the piano roll and for each drum below the drum grid; each change is one undoable edit. MCP: `get_automation`, `set_automation`.
- **Export (2026-11-20):** MIDI files carry synth and drum lanes as CC on the channel the Circuit hears them on (16 for levels, pans and sends). Live sets carry them as clip envelopes on `ControllerTargets.<cc>` (target 0 is pitch bend, checked on Live 12's own demo sets), but only lanes on the track's own channel: macros, drum knobs, drum level and pan. Project-channel lanes are left out of Live sets, with a warning.

**LFOs 1–2 (2026-11-20):** `packages/engine/src/nova/lfo.ts`, feeding matrix sources 6–9 (6/8 unipolar, 7/9 bipolar) and taking rate modulation from destinations 14–15.
- **From official documents:** the 38 shapes, ranges and flag bits (Circuit Programmer's Reference v1.3 p. 9); phase, key sync, common sync, one shot, slew, the four fade modes and delay trigger (UltraNova User Guide pp. 23–25, same engine); the 36 sync values (UltraNova p. 40, assumed the same because the range matches).
- **Guessed, marked in the code:** the rate curve (`curves.ts lfoRateHz`, default 68 ≈ 2.5 Hz), the delay curve, the slew time, and the step values of Sequence 1–7, Alternative 1–8 and the 16 melodic shapes. Novation describes these shapes but publishes no values, and a web search (Novation help centre, Gearspace, Elektronauts, Reddit, GitHub) found no dumps or measurements.
- **Card:** `tools/nova-levels.ts` (new `--no-lfo` flag) goes from 7 silent patches (Bendy Piano ×3, Orbit ×2, Episodes ×2) to none. p10 peak 0.118 → 0.139; above 1.0 unchanged at 145.
- **Wavetables, from the same search:** official names for waves 14–29 only. The UltraNova guide says its wavetables have 9 frames each and describes index and interpolate. Nothing confirms whether the Circuit's 16 tables are a subset of the UltraNova's 36, and no single-cycle dumps are published. NOTAS:732 (core 1 X memory layout per table and level) remains the best lead for E0.7.

**Next:** find why the oracle is silent (one to two days, time-boxed), then LFOs 1–2, then convert the swept DSP words to hertz and seconds.

**Rule for this plan:** no device or card writes. Device reads (SysEx dump requests, the `fwid` query) need approval at the time. Firmware-derived data stays local and is never committed (§5).

## 1. What we know

### 1.1 Novation documents the 340 B patch, and it matches the card

- **Source:** *Circuit Tracks Programmer's Reference Guide* v3, "Synth Patch Format", pp. 16–22.
  - Official download: `fael-downloads-prod.focusrite.com/customer/prod/downloads/circuit_tracks_programmer_s_reference_guide_v3.pdf`.
  - Keep the PDF local; the code holds only the table.
- **Layout:** one byte per parameter, addresses 0–339.

  | Addresses | Contents |
  |---|---|
  | 0–15 | name |
  | 16 | category (0–14) |
  | 17 | genre (0–9) |
  | 18–31 | reserved |
  | 32–35 | voice |
  | 36–53 | osc 1 and 2 |
  | 54–59 | mixer |
  | 60–68 | filter |
  | 69–83 | envelopes 1–3 |
  | 84–99 | LFO 1 and 2; bytes 91 and 99 are bit fields |
  | 100–123 | distortion, chorus and EQ |
  | 124–203 | mod matrix: 20 slots × (source 1, source 2, depth, destination) |
  | 204–339 | macros: 8 knobs × (position + 4 × (destination, start, end, depth)) |
- **Card sweep** (`tools/patch-sweep.ts`, read-only): 1,050 patches checked, the 304 project patches plus 746 bank records.
  - All 1,050 are in range for all 324 ranged bytes.
  - Reserved bytes are 0 and names are ASCII.
  - The histograms are plausible.
- **Firmware agreement:** the ARM's live patch in RAM (`0x20010044`, Synth 1) is laid out the same way. Parameter i is patch byte 30 + i, with a few exceptions around the LFO flag bits (NOTAS:2199).

### 1.2 The stock synth, and what CIRCUIT-HACKS adds

- **Synth 1/2:** always the stock voice, the original Circuit's Nova-derived synth.
  - 2 oscillators with 30 waves;
  - ring mod and noise;
  - one filter with 6 types and 7 drive types;
  - 3 envelopes;
  - 2 LFOs with 38 waves;
  - a 20-slot mod matrix (the guide's NRPN table lists only 12; the patch and the firmware have 20, NOTAS:2229);
  - 8 macros;
  - distortion, chorus and EQ.
  - **CIRCUIT-HACKS never changes these 340 B** (`circuit-hacks-rc/docs/VOICES.md:619-627`).
- **CIRCUIT-HACKS engines live on MIDI 1/2, not Synth 1/2.**
  - The engines: oscillator (morph, supersaw, inter-oscillator FM, ring, sync and bitwise), VA drum, granular, sample, wavetable, and FM (4-op or 8-op with DX7 import), plus line in (`VOICES.md:93-320`).
  - The data lives in four places:
    - the 172 B after each bank record (`CTM1` record; FM-8 records past 4,096 B);
    - the project's MIDI 1/2 pattern-settings blocks (`0xC6`, `0xCA`; `0xC8` on Synth 1/2 patterns);
    - `XLN1` lanes (25 own-synth lanes per pattern);
    - the tail (Master FX per project) (NOTAS:334, 735, 1487, 2014).
- **On this card there is none of it.** The 650 padded bank records are all the stock `0xFF` filler; no bank contains `CTM1` (checked 2026-11-19). The revision 1 count of "650 non-zero" was the filler.
  - The owner develops CIRCUIT-HACKS, so projects with this data will exist. That makes it a later track (S1b, §3), not "out of scope".

### 1.3 What the firmware RE already answers

| Topic | Known | Evidence | Open |
|---|---|---|---|
| Macro destinations | **70, not 71:** 0–69, named, with CC/NRPN and parameter index. The guide's value 70 is outside the firmware's loop | firmware table `0x0805A2B0`, loop `0x0803608A`; list in `circuit-hacks-rc/tools/macroed.py:54-66`; NOTAS:2224 | Destinations 41–45 (LFO 2 rate, sync, slew; distortion and chorus level) were inferred by symmetry |
| How macros apply | Computed **on the ARM in the 0–127 domain:** parameter value + macro offset, clamped to 0..127 (`0x080360B2`). So macros come before any curve, and the DSP never sees them | NOTAS:2227 | The offset formula from (position, start, end, depth) is not written down; it's in the ARM code at `0x0803608A` |
| Mod matrix, velocity → amp | Also ARM-side (`0x0802853C`, `0x0802712E`) | `tools/velglob.py:10-12` | Their formulas |
| DSP engine | **Core 0** does all the processing; **core 1** only fetches words from external memory for core 0. 48 kHz, 32-frame blocks | NOTAS:4436, 3877 | — |
| Signal flow | voices → mix → delay → reverb → returns → master DJ filter → master compressor | NOTAS:4176 | — |
| Analogue waves | Wave 2 (saw) = a 4,096-word table plus a slope table. **Waves 3–12 = the difference of two phase-shifted saw reads** | NOTAS:798 | Wave interpolate (CC 20) did not change the reads in emulation |
| Wavetables 14–29 | 16 tables × 9 frames × **18 band-limited levels** × 1,024 words, in core 1's external X at `$1B4000 + (w−14)·$28800` | NOTAS:732-737 | Where the data comes from: generated, or in the firmware image? |
| Voices | 12 synth voice slots plus one drum slot. Voice stealing is **load-based**: when CPU headroom drops below half a voice, the lowest-score voice dies. Not "oldest first" | NOTAS:4397, 1201 | Per-synth split and the score |
| Parameter → DSP curves | Not decoded for the envelopes, filter, LFO, portamento, density, chorus, delay and reverb. At init the ARM uploads **2,880 coefficient words** to core 0 (likely the curve tables) | NOTAS:2650, 4412 | Everything; see E0.6 |
| Drums | **Pitch:** linear ratio 0.25×–1.73×, word = (256 + 2·trunc(1.5·(v−64))) << 8 (NOTAS:2547). **EQ:** tilt, a one-pole LP with k = 0.075 (≈570 Hz), out = in·(1+g) − 2g·lp, g = (v−64)/64. **Distortion:** table waveshaper. **Samples:** read directly, 16-bit, 48 kHz | NOTAS:2547, 4134-4138 | Decay curve (`0x080287A0`) |
| Mixer | Pan law L = g·min(1, 2(1−w)), R = g·min(1, 2w); strip gain 0.0615 at level 127 | NOTAS:1715, 2573 | — |
| Sidechain | Envelope [source, attack, hold, decay, depth], gain = 1 − env·depth, triggered by drum hits | NOTAS:4335 | Time constants |
| Project params (60 B) | From the firmware index list: reverb sends 0–7, reverb 8–10, delay sends 11–18, delay 19–24, sidechain 4 × 5 for **Synth 1, Synth 2, Audio In 1, Audio In 2** (not MIDI 1/2), levels, pans. The **master filter and compressor are global**, not per project | NOTAS:2567-2570, 2633-2640 | The index-to-file-offset mapping. Card profiles: file +11..+15 and +30/31 are always 0 (reserved), so the file layout has gaps; see `tools/drum-sweep.ts` |
| Automation | Synth lanes 0–7 write the **track's macro store** (`0x20010430`), not the patch's macro-position bytes. Lanes 8–11: level, reverb, delay, pan. Drum lanes 0–3: pitch, decay, distortion, EQ; 4–7: level, sends, pan | NOTAS:1568, 1682, 1178 | — |

### 1.4 Corrections to the brief

| Brief said | Correct |
|---|---|
| Banks are 8 records × 512 B | A bank's last record has **no padding** (92 files of 3,924 B, 2 of 1,876 B, 2 of 340 B). With CIRCUIT-HACKS FM-8 data a bank can grow **past 4,096 B** |
| The padding holds CIRCUIT-HACKS' synth | It holds the **MIDI 1/2** own-synth patches, detected by `CTM1` plus its checksum. `0xFF` is the empty filler |
| Project patches are bank patches | Only 28 of 304 are byte-identical; the project holds the edited copy |
| Macro destinations 0–70 | 0–69 |
| Wavetables via `study_novawaves.py` | That tool runs the DSP in emulation and writes **addresses only**. `novadump.py` needs a diagnostic firmware build on the device (a flash write) and Windows (`ctremote` uses WinMM), and by default reads only 2 tables |
| S2 is "months; a Gearmulator-class project" | Much of it already exists: `tools/dsp_session.py` + `dsptool` runs the **stock core 0 driven by the real ARM code**, replaying MIDI and dumping DSP memory (NOTAS:4408-4425). What's missing is core 1, which only serves memory reads, so oscillators are silent today |

## 2. Decisions for the owner

Each decision has my recommendation; the plan goes ahead on the defaults until the owner says otherwise.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D-1 | Wavetables | **(a) First look for the tables' source in your local firmware image, offline** (E0.7). **(b) If they're not there: approximate**, using the known layout (9 frames, interpolated) with placeholder shapes. **(c) Device dump only as a last resort**: it needs a diagnostic build (a flash write) and a Windows port of `ctremote`. Dump only level 0 (16 × 9 × 1,024 words) and build the 18 band-limited levels ourselves, as the DSP does | 64 % of the card's oscillators don't need them, and (a) may avoid the device entirely |
| D-2 | Where the DSP runs | TypeScript AudioWorklet; WASM only if a measured budget fails. Use 32-frame blocks internally to match the device | Small engine; erasable TS |
| D-3 | First milestone | **A vertical slice** (E-slice, §3): one factory project's Synth 1/2 playing their own patches through a minimal voice, before the full editor | Hear progress in week 1; the editor is built against a running engine |
| D-4 | Accuracy target | "Recognisable" for the slice. For E2/E3: **exact parameter → coefficient curves from emulation** (E0.6) and algorithm checks against the emulator oracle (D-6); ear and recordings last | The emulator gives exact numbers without a device |
| D-5 | Reference recordings | Record the Circuit's outputs into an interface, with sweeps **automated over MIDI** (E4). The diagnostic-build USB capture (`ctremote capture`) is an option only if you approve that build on the device | Needed only for what the emulator can't show |
| D-6 | S2 | **Change: promote it to a 1-week spike, run in parallel: "core 1 stub".** Serve core 0's external memory reads from a model of core 1 (memory plus the copy commands), so the existing `dsp_session` emulation outputs synth audio offline. If it works, it's an **oracle**: golden renders from your own firmware, local only, for any patch. Not a real-time engine | Most of S2 already exists; the oracle makes E2/E3 measurable without the device |
| D-7 | Audition edits on the real Circuit ("Replace current patch", RAM only) | Allow after E1, approved per session | Exact preview through S0 |
| D-8 | When patch fields become editable | All at once, after one read-only device dump matches the file | Layout already confirmed on the corpus and in the firmware |
| D-9 | CIRCUIT-HACKS MIDI 1/2 own synth | **Change: a later track, S1b.** Parse and preserve it now (detect `CTM1`, project blocks, `XLN1`), badge it in the browser, sound it after S1. Ask the device which firmware it runs with the read-only `fwid` query | You run CIRCUIT-HACKS; its engines are your own documented code |
| D-10 (new) | Firmware-derived data (curve tables, wavetables, oracle renders) | **Extract with local tools into `~/Circuit Desk/Firmware-derived/`; the engine loads them at run time if present, otherwise uses committed fitted formulas.** Commit only the formulas (a few constants per curve), never the tables | Same rule as samples and recordings; the app still works for anyone without the files |

## 3. Phases

Each phase lists its parts, then its **Accept** criteria. Repo fixtures are synthetic; card, firmware and device data stay local.

### E0. Patch decode and firmware facts (no device except E0.5)

- **E0.1 Format table as data.** A new package `packages/patch`, `format.ts`: 340 entries holding address, id, section, min, max, default, display, CC/NRPN and evidence, plus the enum tables.
  - **Macro destinations 0–69** come from `macroed.py`, with names and CC/NRPN, marked "firmware `0x0805A2B0`". This is public parameter naming, not firmware data.
  - Defaults come from the patch table, not the CC table (the guide disagrees with itself in 3 places).
- **E0.2 Model.** `parsePatch`, `buildPatch(Patch, base)` (writes only changed bytes), and `initPatch()` as the synthetic fixture.
- **E0.3 Containers.**
  - `bank.ts`: stride 512, short last record, data past 4,096 B kept.
  - Padding classified as empty (`0xFF`), `CTM1` (checksum checked) or unknown, and always preserved.
  - `sysex.ts`: 350 B messages and `.syx` files.
  - `ncs` registry entries for the patches, the drum record and the project parameters, with the firmware index evidence from §1.3.
- **E0.4 Macro math.** Derive the offset formula from the ARM routine at `0x0803608A`. Run it in the repo's Unicorn harness (`tools/emu_*.py` style) over a grid of (position, start, end, depth) and fit or port the formula, as a TS function with a golden table.
  - Also confirm destinations 41–45 and value 70 the same way.
  - The mod matrix (`0x0802853C`) and velocity → amp (`0x0802712E`) get the same treatment.
- **E0.5 Device check (approval-gated, read-only):** dump Synth 1/2 of a known project with the current patch dump request, and run the `fwid` query. Lets D-8 happen and tells S1b which firmware it is dealing with.
- **E0.6 Curves from emulation (new; local, no device).** With `dsp_session.py`:
  - load the 2,880 init coefficient words;
  - for each continuous parameter, sweep 0–127 by CC/NRPN through the real ARM code;
  - record which DSP words change, and to what.
  - Output: `~/Circuit Desk/Firmware-derived/curves.json` per D-10, plus fitted formulas committed to `packages/engine/src/nova/curves.ts`.
  - Covers envelope rates, filter frequency and resonance coefficients, LFO rates and the 36 sync values, portamento, density, chorus, delay, reverb and drum decay.
- **E0.7 Wavetable source (new; local, no device).** Find out whether core 1's external X at `$1B4000` is filled from data in the DSP image of your local firmware (`circuit-hacks-rc/stock/`) or computed at boot.
  - If it's in the image: extract level 0 into `Firmware-derived/` (D-10).
  - Otherwise D-1 (b).
- **Accept:**
  - The sweep stays at 1,050/1,050.
  - Parse → build is byte-identical over the card, padding unchanged.
  - A one-field edit changes one byte.
  - The macro function matches the ARM routine on its grid.
  - `curves.json` covers every continuous parameter in `format.ts`, or lists what's missing.

### E-slice. First sound (new; after E0.1–E0.3)

- **Minimal Nova voice** behind `Instrument` (`InstrumentKind` `"nova"`):
  - waves 0–13, with waves 3–12 as the difference of two saw reads like the DSP;
  - osc mix;
  - LP 12/24 filter;
  - env 1 and 2.
  - It plays a factory project's own Synth 1/2 patches in the app and offline render.
- **Accept:** the factory "Hello Tracks" project renders with each synth's own patch; a golden hash test with `initPatch()`.

### E1. Patch browser and editor

- **Pack view:**
  - a bank × patch grid showing name, category and genre (category names and colours as in `sd_app.html:453-458`);
  - a "used by" list per patch;
  - badges for `CTM1` own-synth data.
- **Editor:**
  - pages that mirror the device: Voice, Osc 1–2, Mixer, Filter, Env 1–3, LFO 1–2, FX/EQ, Mod Matrix (20 slots), Macros (destinations by name);
  - named sliders (`role="slider"`, keys, `aria-valuetext` in display units), tokens only, reduced motion handled;
  - edits go through the `ProjectService` history;
  - read-only until D-8.
- **Where edits go:**
  - Project patch edits go to copies; pack edits go to `.cpb` copies.
  - `.syx` export.
  - Optional audition on the device per D-7.
- **MCP:** `list_pack_patches`, `get_patch`, `set_patch_params`, `export_patch_syx`.
- **Accept:**
  - Keyboard-only browse and edit in the smoke test.
  - A copy differs only in that patch's bytes.
  - MCP tests.

### E2. Voice v1

Pure DSP over `Float32Array` blocks in `packages/engine/src/nova/`, in one AudioWorklet.

- **Oscillators:**
  - saw table plus slope correction, and band-limited pulse-width blends;
  - wavetables: 9 frames interpolated, 18 band-limited levels chosen by pitch (as the DSP does), data per D-1;
  - pulse width or index;
  - virtual sync;
  - density;
  - pitch.
- **Mixer:** ring mod and noise.
- **Filter:** the 6 types with drive (7 types) and the 3 routings. The algorithm is chosen by comparison with the oracle (D-6) when it exists, otherwise by ear.
- **Envelopes 1–3, LFOs 1–2** (38 waves; sequence and chord shapes approximated until the oracle or measurement shows them).
- **Mod matrix and macros:** both computed in the 0–127 parameter domain before the curves, as the ARM does (§1.3). The **track macro store** is separate from the patch's macro positions; automation lanes 0–7 and CC 80–87 write the store.
- **Voice handling:**
  - Polyphony modes, portamento and pre-glide.
  - A 12-slot voice pool; load-based stealing is approximated as "quietest voice dies" until the score is decoded.
- **Per-patch FX:** distortion (7 types), chorus or phaser, EQ.
- **Curves:** all of them through `curves.ts` (E0.6).
- **Accept:**
  - Unit tests per part.
  - Golden renders.
  - The CPU budget (D-2).
  - When the oracle exists: per-parameter sweeps within an owner-set distance of it.

### E3. FX, mixer and drums

- **Already decoded (§1.3):** drum pitch, EQ tilt, pan law, strip gain, sidechain shape, project index layout. Implement these directly.
- **To decode:**
  - The project-index → file-offset mapping, by corpus profile plus one controlled diff per group.
  - Drum decay (`0x080287A0`), through E0.4's Unicorn path.
  - Reverb and delay algorithms (`func_001964`, `func_001157`), read from the DSP code. Their coefficient tables come from E0.6.
- **Engine:**
  - Mixer level and pan.
  - Sends.
  - Delay: time or sync, feedback, width, L/R ratio, slew.
  - Reverb: 6 types.
  - Sidechain on Synth 1/2 (Audio In sidechain only matters with line in).
  - The master DJ filter and compressor as **global** app settings, not project fields.
  - Drum knobs.
- **Accept:** registry updated with evidence; golden renders; drum renders against the oracle.

### E4. Accuracy loop (D-5)

- **Automated sweeps:** the app sends CC/NRPN sweeps to the device (current sound in RAM only, approved per session) and records the interface input at the same time. One parameter and one note at a time, aligned automatically.
- **What it's for:** checking what the oracle can't, such as the analogue-modelled filter drive, output level and anything core 1 shapes. Golden pairs stay local.

### S1b. CIRCUIT-HACKS MIDI 1/2 own synth (later; D-9)

- **Data:** padding `CTM1` and FM-8 records, the project's pattern-settings blocks, `XLN1` lanes and the Master FX tail. All are already preserved by `packages/ncs`.
- **Engines:** ported from CIRCUIT-HACKS' own documented DSP sources (`tools/*_dsp.py`). Being your code, they can be committed.
- **Gating:** only when the project carries the data, or `fwid` reports a CIRCUIT-HACKS build.

## 4. Order and size (estimates)

| Step | Needs | Estimate |
|---|---|---|
| E0.1–E0.3 | nothing | 2–3 days |
| E-slice | E0.1–E0.3 | 3–4 days |
| E0.4, E0.6 | local firmware + `dsptool` set up (`circuit-hacks-rc/tools/setup_local.sh`) | 1–1½ weeks |
| E0.7 | local firmware | 1–3 days (research) |
| S2 core-1 stub spike (D-6) | local firmware, in parallel | 1 week, time-boxed |
| E0.5 | device + approval | ½ day |
| E1 | E0 (editing needs D-8) | 1–1½ weeks |
| E2 | E0.6, E-slice | 2½–3 weeks |
| E3 | E0.6, controlled diffs | 1–1½ weeks |
| E4 | D-5 | 1 week, then ongoing |
| S1b | S1 | to plan later |

**No device needed** for E0.1–E0.4, E0.6, E0.7, E-slice, E1 browsing, E2 and the spike.

## 5. Constraints

- **Never commit:** the PDF, firmware, firmware-derived tables, wavetables, pack patches and samples, recordings or oracle renders. Fixtures are synthetic. Firmware-derived data lives in `~/Circuit Desk/Firmware-derived/` (D-10).
- **The device:**
  - No device writes; D-7 and E4's RAM-only CC/NRPN sweeps are the only proposed exceptions, each approved per session.
  - Read-only queries (patch dump, `fwid`) need approval.
  - Diagnostic firmware builds are flash writes: not planned.
- **Lossless:** patch edits change only that patch's bytes; padding, `CTM1`, FM-8, `XLN1` and tail data are preserved byte for byte.
- **Code and UI:** TypeScript strict and erasable; named tokens; keyboard paths, focus order and `prefers-reduced-motion` are acceptance criteria.
