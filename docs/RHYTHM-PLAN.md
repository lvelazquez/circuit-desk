# Plan: Circuit Desk for Circuit Rhythm

**Status:** draft for the maintainer's review, 2026-11-24. Nothing here is built. Facts are marked **[doc]** (from Novation's published PDFs), **[REMIX]** (from the community CIRCUIT-REMIX repo, unverified on hardware), or **[guess]**. The Circuit Tracks plan this builds on is [`PLAN.md`](PLAN.md).

## Goal
The goal is the same desk for the **Novation Circuit Rhythm**, the 8-track sample groovebox. The desk should:
- open the projects on its SD card;
- see and edit every track, pattern, scene and chain;
- hear a preview;
- export to MIDI and Ableton Live;
- drive the same work from the MCP;
- later, write projects and **sample packs** back to the card.

Rhythm is a *better* fit for a desktop preview than Tracks. Its sound is samples plus documented macros, so the preview can come close to the device without the firmware-emulation work Tracks' Nova synth needed.

## What is known

### Sources
| Source | What it gives | Trust |
|---|---|---|
| Circuit Rhythm User Guide v1.0 and the 2.0 Firmware Addendum (Novation PDFs) | Project model, sample modes, FX, Grid FX, scenes with mutes (2.0) | **[doc]** |
| Circuit Rhythm Programmer's Reference v5 (Novation PDF) | Full MIDI map: track channels, CCs, NRPNs, Program Change on ch 16 | **[doc]** |
| Novation support article "Manually setting up Circuit Rhythm SD card packs" | Card tree, 48 kHz/16-bit mono WAV rules | **[doc]**, read from search excerpts only (the page refused fetches) |
| [Ghillermo/CIRCUIT-REMIX](https://github.com/Ghillermo/CIRCUIT-REMIX), Oct 2026 (same author as CIRCUIT-HACKS) | File naming, `.ncs` offsets, the stock SysEx file protocol, firmware 2.0.1 build 5706 | **[REMIX]**: mostly checked in emulation; its pack app is untested on a device; **no licence file** |
| [Ondrysak/ncstool](https://github.com/Ondrysak/ncstool) | Tracks `.ncs` Kaitai spec, used here for comparison | community |

The PDFs go in the reference folder beside the Tracks ones (`~/Circuit Desk/Reference/`), never committed.

### Card and files
- **Card tree:** `Rhythm/NN_Pack/` with `Sessions/NN_Name.ncs` (64 projects), `PCM/NNN_Name.wav` (128 samples), `GridFx/` (16 presets) and `meta/NN_Name.ncm` **[doc/REMIX]**. That is the same layout as Tracks' `Tracks/NN_Pack/Sessions`.
- **Packs:** one pack in internal memory and 31 on the card **[doc]**.
- **Samples:** 48 kHz, 16-bit, mono. About 30 s per sample, or 32 s in the User Guide's recording chapter; the loader cap 0x2F0000 B is about 32.8 s **[REMIX]**. About 228 s per pack in total **[doc excerpt]**.
- **Project files share the extension.** Rhythm projects are also `.ncs`. Two things tell them apart:
  - **header magic:** `RUSE` (user) or `RDEM` (demo) on Rhythm, against `USER` or `DEMO` on Tracks;
  - **size:** 169,092 B (0x29484) on Rhythm, against 160,780 B on Tracks **[REMIX]**.

  The desk must detect the device by header magic and never by extension.
- **Pattern block layout [REMIX]:**
  - The block is 8 tracks × 8 patterns × 0xA28 B, from **0x2E4**. That is the same origin as Tracks' synth patterns.
  - Each pattern holds 32 steps × 8 B (note, gate, mask, velocity, probability, flip, tie), then settings at +0x100, then 12 automation lanes × 192 B at +0x128. Lanes are 32 steps × 6 micro-points, as on Tracks.
- **Still unknown, and only a card or device save can tell:**
  - the header fields: tempo, swing, scenes, chains, mixer, FX and sidechain;
  - whether slice points, start/end and Beat Match live in the project or with the sample;
  - what `.ncm` holds;
  - whether there is a checksum.

### Model, from the User Guide [doc]
- **Tracks:** 8 monophonic sample tracks. Each has 8 patterns of up to 32 steps, 6 micro-steps a step, and a per-track pattern chain.
- **Scenes:** 16 scenes, chainable. Since 2.0 a scene also stores mutes, with a Mute Recall mode.
- **Per step:** sample flip, note, velocity, gate, probability (8 levels) and automation.
- **Per pattern:** start/end step, sync rate, direction and Mutate.
- **Per track:**
  - play mode One Shot, Gated or Loop, plus Reverse;
  - a choke group, and Keyboard or Slice mode (4/8/16 slices, adjustable start and length per slice);
  - 8 macros: Tune, Start, Length, Slope, Distortion, HPF, LPF, Resonance;
  - level, pan, mute, reverb and delay sends, and a sidechain (7 presets, any track as the source).
- **Project:**
  - tempo and swing;
  - 8 reverb and 16 delay presets, a master compressor and a master filter;
  - Grid FX: 16 slots of 7 types (Beat Repeat, Reverser, Gater, Auto Filter, Digitise, Phaser, Vinyl Sim).
- **No synth tracks, no MIDI tracks and no scales.** The note on a step plays the sample chromatically in Keyboard mode, or picks a slice in Slice mode **[doc; the mapping is a guess until checked]**.

### MIDI, from Programmer's Reference v5 [doc]
- **Channels:** tracks 1–8 use channels 1–8 by default (settable 1–15). Channel 16 is the project channel.
- **Project channel:**
  - Program Change 0–63 loads a project now; 64–127 queues it.
  - Notes 36, 38, 40, 41, 43, 45, 47 and 48 trigger tracks 1–8.
- **Per-track CCs:**
  - sample 8, play mode 12, reverse 14, choke 15, slice 16, slice count 17;
  - macros 21–28, start fine 86, length fine 87;
  - level 29, pan 30, reverb send 31, delay send 32.
- **NRPNs:**
  - sidechain 1:0–4, delay 1:6–11, reverb 1:18–20, FX bypass 1:21;
  - compressor 1:22–26, audio input 1:27–30.
- **Other:** Grid FX CC 39–65; master filter CC 79 and 71. Clock, Song Position Pointer and Song Select are supported.

This table is the automation lane → parameter map Tracks had to decode by hand. On Rhythm it is likely the 8 macros plus level, pan and two sends, matching the 12 lanes **[guess; one controlled diff confirms it]**.

## What carries over from the Tracks desk
| Part | Reuse | Why |
|---|---|---|
| `Arrangement` type, `packages/playback` scheduler, SMF writer, `.als` writer and readers | **as is** | They only see tracks, notes, CCs and automation events. Rhythm gives 8 tracks on channels 1–8 |
| Lossless offset-patch model and field registry (`packages/ncs` pattern) | **the pattern, new package** | Same approach: original bytes, edits as patches, every byte owned by a registry entry |
| `packages/ncs/src/pattern.ts` step and lane codecs | **probably shared** | If REMIX's 8 B step and 192 B lane layout holds, they are near the Tracks drum and note codecs. Factor out only once a sweep proves it |
| `arrange()` (`packages/export/src/arrange.ts:316`) | **split** | The chain, scene, swing, direction and probability logic is generic; it takes Tracks' `N.Project` and track names today |
| `Sampler` (`packages/engine/src/sampler.ts:25`), FX chain, mixer, offline render | **extend** | It plays one-shots with pitch and decay. Rhythm needs modes, reverse, choke, slices and the 8 macros |
| `ProjectService`, RPC, MCP server | **generalise** | `TrackName` and `NOTE_TRACKS`/`DRUM_TRACKS` are baked into the service types (`service.ts:31-34`) |
| App shell, library, Editor (piano roll, drum grid, lanes), Scenes, Mixer, playback, export popovers | **reuse with a device profile** | The hardware panel, Sounds/Patch/Pack views and Project view are Tracks-specific |
| Card write guard and the snapshot → plan → write → read-back rules | **as is** | Same FAT card rules. The pack prefix is `Rhythm/` instead of `Tracks/` |
| SysEx transfer (`packages/patch/src/transfer.ts`) | **pattern only** | Rhythm's file protocol is `F0 00 20 29 01 63 03 …` **[REMIX]**. It needs its own capture of Components, as Tracks' did |

## Architecture decision (recommended): one app, two device profiles
- **Detection:** `packages/ncs` keeps Tracks. A new **`packages/rhythm`** reads Rhythm projects. A small **`detect(bytes)`** in a shared place picks the device by magic and size.
- **`DeviceProfile`** in `core-service` holds:
  - the track roster (names, kinds, default channels);
  - the lane names and their CCs;
  - the sync-rate and direction tables;
  - the card folder name (`Tracks` or `Rhythm`);
  - which views exist.

  The service's `TrackName` becomes the profile's. Tracks tests must pass unchanged after this refactor.
- **Opening a project:** opening a project picks its profile. The library lists both devices' packs if both folders are on a card.
- **Why not a fork:**
  - About 70 % of the code (export, playback, engine, editor, MCP plumbing, card safety) is shared.
  - A fork would mean fixing every editor bug twice.
  - The cost is one refactor phase (R2) with the Tracks suite as its safety net.

## Phases
Effort numbers are rough estimates, at the pace the Tracks phases went.

**R0: inputs** (half a day; needs the maintainer)
- Copy the Rhythm card, read-only, with a `MANIFEST.sha256`, as for Tracks: `~/Circuit Desk/Card copy/<date>/Rhythm`.
- Save the User Guide, the addendum and Programmer's Reference v5 into the reference folder.
- Clone CIRCUIT-REMIX beside `circuit-hacks-rc` as a **read-only reference** (see D-R3).
- **Accept:** the manifest matches the card. A survey lists packs, projects, sample counts and the header magic of each file.

**R1: `packages/rhythm`, read-only and lossless** (2–3 days)
- Layout constants and a field registry where every byte has an owner, checked by a test.
- Step and pattern parse/build, lanes, and whatever scenes and chains the sweep can place.
- `tools/rhythm-survey.ts` → `docs/rhythm-card-survey.md`, the same kind of byte-variance report Tracks used to find tempo and swing.
- REMIX offsets enter the registry as `partial` and are promoted only by evidence.
- **Accept:**
  - parse → build is byte-identical for every card project;
  - pattern step counts and the notes a used pattern holds look plausible across the survey;
  - a Tracks file is refused with a clear message, and the reverse is also true.

**R2: device-profile seam** (2–3 days)
- `detect()`, `DeviceProfile`, a generic service track type, and `arrange()` split into a generic core plus a per-device adapter.
- MCP tools take track names from the profile and report the device in `summary`.
- **Accept:** the full Tracks suite plus `app:smoke` stay green, with no Tracks behaviour change. A Rhythm project opens headless and its `summary` is correct.

**R3: exports and MCP for Rhythm** (2 days)
- **Exports:** 8 MIDI tracks on channels 1–8.
  - Sample flips become notes or CC 8 changes **[decide in R3: CC 8 matches the device, notes are friendlier in Live]**.
  - Macro lanes become CCs 21–28; level, pan and sends become CCs 29–32.
  - In `.als`, Session clips are patterns and Live scenes are scenes, as for Tracks.
- **MCP:** `get_pattern` and `set_steps` per track, `get_scenes` and `set_chain`, `save_copy`, `export_*`.
- **Accept:** every card project exports MIDI that reads back cleanly. The `.als` round-trip matches note for note. MCP tests run over the in-memory transport.

**R4: preview engine for Rhythm** (1–2 weeks; the largest phase)
- **`RhythmVoice`** behind the existing `Instrument` interface:
  - One Shot, Gated and Loop; Reverse;
  - a choke group across tracks; Keyboard pitch, or Slice mode playing slice n;
  - the 8 macros: Tune, Start/Length (plus fine), Slope, Distortion, HPF/LPF/Resonance.
- **Sound sources:**
  - samples come from the pack's `PCM/`, with a project's sample flips;
  - mixer, sends, reverb and delay presets, the sidechain and the master compressor reuse `packages/engine/src/fx`.
- Grid FX comes later, in R8.
- **Accept:** `app:render` renders every card project without errors. Per-track levels are audible, using the `synth-audit` approach. A later step compares with a device recording through `app:device-record` (MIDI out of the device, then audio).

**R5: app** (1–2 weeks)
- **Rhythm panel:** a hardware-layout panel built from the User Guide's diagrams, with no Novation marks. It has 8 track buttons, a 4×8 grid, 8 macro knobs, and Sample, Slice, Grid FX, Mixer and Scenes buttons.
- **Rhythm views:**
  - **Sample:** the 128 slots, a waveform, audition, and which tracks and steps use each sample;
  - **Slice:** slice points on the waveform, read-only until R6 decodes them;
  - **Track sound:** mode, reverse, choke and macros.
- **Shared views:** the Editor (piano roll in Keyboard mode, a slice-lane grid in Slice mode, lanes), Scenes (with mutes), Mixer and Project.
- **Accept:**
  - `app:smoke` covers a Rhythm project;
  - keyboard paths and focus order work;
  - reduced motion is respected;
  - `app:shots` works on a Rhythm project.

**R6: decode track** (ongoing; needs device saves)
- Run controlled diffs with the existing `tools/settings-diff.ts` approach: save, change one setting, save again, diff.
- Order:
  1. tempo and swing;
  2. scenes, chains and scene mutes;
  3. level, pan and sends;
  4. reverb, delay and compressor presets;
  5. sidechain;
  6. track mode, reverse, choke and slice count;
  7. slice points and start/end;
  8. Grid FX slots;
  9. the `.ncm` meta file.
- Each decoded field moves to `partial` and becomes editable on copies, under the rule the maintainer set for Tracks on 2026-11-20.
- **Accept:** each promotion cites a diff pair, plus a device load of an edited copy.

**R7: device link** (2–3 days; needs the device)
- Play from the app to the Rhythm over USB MIDI, on channels 1–8 plus clock.
- Program Change on ch 16 loads the same project first.
- Record the device's MIDI out to compare timing, as P4b does for Tracks.
- **Accept:** the notes, velocities and micro-timing sent match the device's own MIDI out for a 100 %-probability pattern, with no stuck notes on stop.

**R8: write-back and the pack builder** (1–2 weeks; device checks need approval)
- **Card write-back** uses the Tracks P5 safety rules: snapshot, a write plan the maintainer confirms, never pack 0, and read-back.
- **Pack builder:** build a pack folder from your own WAVs.
  - Convert to 48 kHz, 16-bit mono, enforce the length caps and the `NNN_` naming, and refuse stray same-prefix files, which the firmware may confuse **[REMIX]**.
  - The `bitbox-instruments` and `Slow Matter` sample pipelines are the source for the conversion and trimming steps.
  - This is the Rhythm-specific feature with the most value: making packs from field recordings and existing libraries without Components.
- **Later:** a Grid FX preview approximation, and a read-only SysEx project download from a capture of Components.

**Total to a useful read, play and export desk (R0–R5):** about 4–6 weeks. Write-back and packs come after.

## Decisions for the maintainer
- **D-R1: device and card (blocks R0).**
  - Is there a Circuit Rhythm and a card to copy?
  - Without one, R1 can only be built on REMIX's offsets and synthetic files, which proves nothing. The plan would stop at R2 plus a demo project.
  - Novation's factory pack ships through Components; whether it is downloadable without a device is unknown.
- **D-R2: one app with device profiles, or a separate Rhythm app.** Recommended: **one app** (above).
- **D-R3: CIRCUIT-REMIX has no licence file.** Recommended:
  - use it only as a cited reference for offsets and protocol;
  - copy no code;
  - verify every offset on our own card;
  - ask the author about a licence, as D6 already plans for the CIRCUIT-HACKS upstream.

  Circuit Desk is MIT and public, so this matters.
- **D-R4: is the sample and pack builder (R8) in scope?** It is the biggest Rhythm-only win, but it writes WAVs to the card.
- **D-R5: Grid FX in the preview.** Approximate the 7 types, or show them as data only? Recommended: data only until R6 decodes the slots.
- **D-R6: sample flips in exports.** Use CC 8 (matches the device), separate notes per sample (friendlier in Live), or both as an option?

## Risks
- **REMIX offsets may be wrong on firmware 2.0.1 saves.** R1's sweep and R6's diffs are the check, and nothing is editable before them.
- **Same extension, different device.** A Tracks tool writing to a Rhythm file, or the reverse, must be impossible. Detection runs on every open and every write, with a test for each direction.
- **Sample memory limits** (about 228 s a pack) must be checked before a pack write, not discovered on the device.
- **The R2 refactor touches shared code** that other sessions are editing: the Editor and service work in progress. Do R2 after that work lands on `main`, in one short branch.
