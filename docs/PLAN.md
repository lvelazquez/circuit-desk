# Plan: "Circuit Desk": desktop Circuit Tracks project editor + MCP

> **Revised 2026-11-19** after checking every reference against source (upstream still at `0160e38`; all file:line references below resolve).
> - **Corrected:** the name limits in `packages/card` (the old "name ≤ 30 chars" was the pack-folder limit, not the project limit).
> - **Corrected:** the "173–220 real files" sweep was done on the upstream author's card, not yours. Your copy is named under Fixtures.
> - **Corrected:** the drum automation lanes are already mapped in the upstream notes; only the synth lanes are a blocker.
> - **Added:** where the undecoded settings most likely live; macOS card hygiene; what the mod-data tests can and cannot prove today.
> - **Changed:** P4b now comes before P5 (it depends only on P4), and its acceptance test is a MIDI comparison instead of "sounds the same".
> - **Removed:** the "name ≤ 30 chars" rule and the "sounds the same" acceptance wording. Scope, decisions and stack are unchanged.
>
> **Second pass, same day:**
> - ~~Blocker for P1: the card copy was cloud-only.~~ Resolved in the third pass.
> - **Corrected:** the `.als` code being reused writes arrangement clips only. Session clips, Live scenes and clip envelopes are new work, and the round-trip reader can't check Session clips yet.
> - **Corrected:** gate units are already known upstream (sixths of a step). Only the tie bit needs a device check.
> - **Corrected:** `patMidi` is a timing reference, not a full specification. It ignores ties, direction and probability.
> - **Added:** the validator's own list of checked fields, as the checklist for the field registry; reusable MIDI-out code from motorik; one unconfirmed Producer Pal tool; an open question on scene length.
> - **Removed:** "its function names list the field groups" (the names are minified; the message strings are what is readable) and "gate units still need decoding".
>
> **Third pass, same day (card copied and surveyed):**
> - **Changed:** Fixtures now point at a verified copy taken from the SD card (9 packs, 152 projects). The decision about the OneDrive copy is gone.
> - **Added:** survey results under Fixtures and in the decode track. Tempo and swing units now have evidence from your own projects.
> - **Removed:** the OneDrive path, the "151" counts, and the "gates P1" decision.

## Context
You want "Circuit Tracks on my desktop": a GUI that looks and works like the Circuit (32-pad grid, 8 knobs, track and view buttons). It should:
- import Circuit projects;
- edit everything (notes and steps, drums, scenes and chains, and tempo, mixer, FX and scale once decoded);
- write projects back to the device;
- export multitrack MIDI and Ableton Live 12 `.als`.

It comes with an **MCP server** so Claude can read and edit the same projects.

Your decisions:
- write-back goes through the **SD card folder** first;
- handle **stock and CIRCUIT-HACKS** projects, preserving all mod data byte for byte;
- build Ableton sets from **your installed Live 12 Suite templates** (personal use).

Scope boundary I'm assuming: this is an editor and sequencer, **not an audio emulation** of the Circuit's synths and DSP. Preview playback goes out as MIDI (later phase). The look is inspired by the device; no Novation logos or trademarks.

What exists already:
- **The format is well mapped** for notes, steps, drums and scenes (sweep-verified by the upstream author over 173–220 files from their card; not yet re-run on yours). The best map is `docs/NOTAS.md:2014-2087`.
- **Partly or not decoded:** tempo and swing (offsets 0x34/0x35, units unknown), mixer, FX, scale, automation lane→parameter mapping.
- **Embedded sound data, kept opaque:** each project carries its own Synth 1 and Synth 2 patches (340 B each), a drum block (44 B) and project parameters (60 B) at `0x26D14`, plus 24 B of loose settings at `0x26CFC` (`docs/NOTAS.md` map table). The model preserves them byte for byte. Patch editing is out of scope.
- **Reusable parser:** the JS `SD` data layer in `circuit-hacks-rc/tools/sd_app.html` (`patParse` :831, `patBuild` :842, `patMidi` :883, `xlSum` :707/:925, `Projects`, `remapSession`, tail handling :703-711).

## Stack and layout (copy the jig-room setup)
- **Desktop shell:** Electron 45, Vite 8, React 19, TS strict, vitest 5, electron-builder unsigned arm64 dmg. Copy from `jig-room/package.json` and `jig-room/tsconfig.electron.json`. Add a project `.npmrc` with `registry=https://registry.npmjs.org/`.
- **New repo `~/Personal Repo/circuit-desk`** (npm workspaces):
  - **`packages/ncs`**: a lossless project model. It keeps the original `ArrayBuffer` and does every edit as an offset-patch, so unknown bytes, the mod tail (0x27024 signed blocks), pattern bytes 4–39, step bytes [2]/[3], and post-160 780 data (`XLN1`, `SCN3`) survive untouched.
    - Port from `sd_app.html`: constants :140-160, pattern parse/build, drums, scenes/chains, the header name/colour, `xlSum` recompute on MIDI 1/2 edits.
    - A **field registry** marks each field `verified` / `partial` / `unknown`. The GUI and MCP only allow editing `verified` fields; the rest are read-only display with raw bytes.
  - **`packages/export`**:
    - **SMF:** multitrack, one MIDI track per Circuit track, patterns laid out by scene chain. Port `motorik/packages/core/src/smf.ts` (+ tests). Ticks follow `patMidi`'s sync-rate table (480 PPQ).
      - `patMidi` (`sd_app.html:883-891`) is the reference for timing only. It plays every pattern forward, drops the tie bit, ignores probability, and gives every drum hit a quarter-step length. The export needs its own rules for those: a tied note merges with the same note on the next step; direction follows the pattern setting; probability is ignored (every step sounds).
      - **Open question:** tracks can have different pattern lengths and sync rates, so "laid out by scene chain" needs a rule for how long a scene lasts. I haven't found one in the notes; it is one device observation (when does the device move to the next scene?) before P2 ends.
    - **ALS:** port `bitbox-instruments/tools/texture/liveset.ts` (`clip`, `track`, `assembleSet`).
      - What that file does today: one **arrangement** clip per track (`liveset.ts:100`). It writes no Session clips, no Live scenes and no clip envelopes, so those three are new code, not a port.
      - It also loads its sound presets and tune list at import time, so the port takes the three functions and the id handling, not the module.
      - **Recommended order (yours to confirm):** ship the arrangement export first, because it is the part that already works, then add Session clips and scenes.
      - Circuit tracks become MIDI tracks.
      - Patterns become **Session-view clips**, and Circuit scenes become Live scenes. Optionally the chain is also rendered to the arrangement.
      - Templates are read from `/Applications/Ableton Live 12 Suite.app` (confirmed installed).
      - Known pitfalls to handle: unique `NextPointeeId`/target IDs, ReWire IDs, tempo and meter written in both the manual value and the automation lane, no overlapping notes on one key.
    - **Round-trip check:** `bitbox-instruments/tools/texture/als-read.ts`. It reads arrangement notes and only counts Session clips (`als-read.ts:71`), so it must learn to read Session clip notes before it can check them.
  - **`packages/card`**: SD-folder access (Node `fs` in Electron main).
    - Pack layout `Tracks/NN_Name/Sessions/NN_Name.ncs`, printable ASCII only. Limits, from `sd_app.html:324` and `:729`:
      - pack folder: 30 characters including the `NN_` prefix (so a 27-character name);
      - project name: 24 characters (the device's 31, minus `NN_` and `.ncs`);
      - 64 project slots per pack, 31 packs on a card.
    - Write-back safety:
      1. snapshot the whole card to `~/Circuit Desk/Snapshots/<date>/`, never on the card;
      2. a write plan you confirm (changed files only);
      3. no stray `NN_*` files in pack folders;
      4. never pack 0;
      5. read back and compare after writing;
      6. macOS hygiene: Finder and Spotlight add `._*`, `.DS_Store`, `.Spotlight-V100` and `.fseventsd` to FAT cards. The write step never creates them and the read-back step lists any it finds. Whether the device ignores a `._NN_*` file is unknown, so it is one line in the P5 device check.
  - **`packages/core-service`**: a project service in the Electron main process (open, edit, undo, save, export). It is exposed to the renderer over IPC and to the MCP over a local Unix socket using JSON-RPC.
  - **`packages/mcp`**: stdio MCP server (`@modelcontextprotocol/sdk`, zod).
    - It proxies to the running app. If the app is closed, it loads `packages/ncs` headless on the files.
    - Tools:
      - `open_project`, `list_projects`;
      - `get_pattern`, `set_steps`, `set_drum_steps`;
      - `get_scenes`, `set_scene`, `set_chain`;
      - `get_field` / `set_field` (verified fields only);
      - `validate`, `diff_vs_original`, `save_copy`;
      - `export_midi`, `export_als`;
      - `card_snapshot`;
      - `card_write_plan` and `card_write`, with `confirm:true`; it refuses without a fresh snapshot.
  - **`app/`**: the React renderer, a Circuit-like UI.
    - 4×8 pad grid, 8 knobs, track buttons, and views: Note, Velocity, Gate, Probability, Micro-step, Patterns + chain, Scenes, Mixer, Drums.
    - Colours use **named tokens** mapped from the Circuit palette. Full keyboard paths and focus order; pad state is never shown by colour alone; `prefers-reduced-motion` respected.
- **Fixtures:**
  - Synthetic ones built with `circuit-hacks-rc/tools/sd_app_fixture.py`.
  - Your real card copy is used **locally only** (gitignored, never committed).
    - It is at `~/Circuit Desk/Card copy/2026-11-19/Tracks`, copied from the SD card on 2026-11-19: 9 packs, 152 projects, 833 files. SHA-256 of every file matched the card (`MANIFEST.sha256` beside it). The folder is personal, unsynced and read-only.
    - The older copy in the work OneDrive (8 packs, 151 projects, cloud-only placeholders) is no longer used. It was left untouched.
    - All 152 are stock size, so **no real CIRCUIT-HACKS file exists here**. Mod-data preservation is proven on synthetic fixtures only until a mod build has saved a project on your device.
    - **What the survey of the 152 found** (`docs/card-survey.md`, made by `tools/card-survey.ts`):
      - **Unknown bytes are not empty in real stock projects.** 24 projects (all 16 of the Factory Pack and the 8 of `07_Shadow Child`) have non-zero data in the 1 000-byte tail and in pattern-settings bytes 4–39 of every pattern. The byte-for-byte rule is needed for your own card, not only for mod files.
      - **No tied notes anywhere** (0 of 15 709 notes). Gate values run 1–96, as upstream says.
      - **Non-forward direction is rare:** 26 of 1 180 used note patterns and 7 of 1 151 used drum patterns.
      - **Scenes and chains are common:** 66 projects have saved scenes, 40 play a chain of more than one scene, and 71 have a pattern chain on at least one track. The scene-length rule matters for real material.
      - **Automation is common:** 258 note patterns and 213 drum patterns carry it.

## Track: decode tempo, swing, mixer, FX, scale
- **Tempo and swing, from the survey (strong evidence, not yet a device check):** byte `0x34` holds 40–174 across your 152 projects, with 100, 120, 128 and 174 the most common, so it reads as plain BPM. Byte `0x35` is 50 in 84 projects and otherwise 22–70, so it reads as swing percent. Byte `0x36` is 3 in every project; the validator's "swing sync rate" is the likely meaning.
- **Where to look next:** The rest of the project-wide settings can only be in three small areas that are not pattern data: the 24 B at `0x26CFC`, the 44 B drum block and the 60 B project-parameter block inside `0x26D14`. That is 128 bytes to diff, not the whole file.
  - What the survey shows about their shape (structure only; the meaning of each byte still needs the controlled diffs):
    - the 44 B drum block is four records of 11 B, one per drum: 7 bytes that vary and 4 that are always zero;
    - the 24 B of loose settings have only 10 bytes that ever vary, in three groups (+2/+3 and +10/+11 as matching pairs, +16 to +21);
    - the 60 B project block has 52 bytes that vary, including four repeating 5-byte groups from +32.
- **Controlled diffs:** save the same project on the device with one setting changed (tempo 120→121, a mixer level, a scale), then byte-diff. The tool is `circuit-desk/tools/diff-ncs.ts`. You do the saves on the device; nothing is written by us.
- **Novation's validator:** use the Components WASM validator archived in `ext/circuittracksreverseengineering/Assets/Novation-Components/` to get ranges and offsets.
  - Its error messages name every field Novation checks, which is the checklist for the field registry: tempo, swing, swing sync rate, scale type, scale root, keyboard octave, session colour, delay preset, reverb preset, side-chain preset, synth patch index, mute state, drum choice, and per pattern: direction, start position, sync rate, probability, gate, tick delay, velocity, note mask, automation lanes, pattern chain and scene chain.
  - There is no message for mixer level or pan, so those may not be range-checked at all.
  - It cannot be run as a test oracle as archived: its 15 imports and its exports have minified names and the JavaScript loader is not in the archive. Offsets come from reading it in Ghidra, as the archive's README does.
- **Promotion:** a field moves to `verified` only after the diff experiments, plus a device load of an edited copy, confirm it.

## Phases
- **P1:** `packages/ncs` read-only.
  - **Done 2026-11-19.** `npm test`: 25 tests pass, among them the sweep over all 152 real projects (byte-identical) and synthetic files with both CIRCUIT-HACKS sections after the stock part. `npm run typecheck` is clean.
  - What exists: the layout constants, the field registry (every byte of the file belongs to one entry, checked by a test), note and drum pattern parse/build, header, scenes and chains readers, and the mod-trailer reader with its checksum check.
  - **Left open:** the order of the 8 tracks inside a scene and in the chain table is not confirmed, so the readers return them by position, not by track name. P2 needs it to lay out scenes; one project with a known scene settles it.
  - **Accept:** for all 152 real `.ncs` files in your card copy, parse→build with no edits is byte-identical; synthetic mod fixtures keep their tail and post-file data.
- **P2:** exports.
  - **Built 2026-11-19, awaiting your check in Live.** `packages/export`: `arrange` (project → timeline), `writeSmf`, `writeAls` (+ `als-read.ts` / `smf-read.ts` for checks); `tools/export.ts` writes to `~/Circuit Desk/Exports/<project>/` (`.mid`, `.als`, `export.txt`). `npm test`: 41 pass, `typecheck` clean.
  - **Checked:** notes equal upstream `patMidi` for every pattern of all 152 projects (run from `sd_app.html` itself); every project's MIDI file reads back clean (no hanging or overlapping notes); every project with notes builds a well-formed `.als` whose arrangement reads back note for note.
  - **Set layout:** one MIDI track per Circuit track with notes, no instrument. Session rows = scenes played (or "Current chains"), then "Pattern 1–8"; Arrangement = each pattern play as a clip.
  - **Assumed, reported in `export.txt`:** track order in a scene is Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4 (card evidence: each chain slot most often points at used patterns of that track); a scene lasts its longest chain; non-forward directions are drawn forward; swing and probability are not applied; tie bit ignored (0 tied notes on your card).
  - **Upstream bug found:** `patMidi` writes a stored note number above 127 as a raw data byte, which makes an invalid MIDI file (`04_Circuit Tracks Factory Pack/11_Woke Code`, Synth 1 pattern 5, has a 128). We leave such notes out and warn.
  - **Still to do for P2:** you open one export in Live 12 (`~/Circuit Desk/Exports/00_Hello Tracks/`). Clip envelopes (automation → CC) are not exported yet.
  - **Accept:** SMF matches `patMidi` per pattern for forward patterns with no ties (the cases `patMidi` handles), with separate tests for ties and direction; a multitrack export opens in Live 12 with the correct tempo and clips; ALS round-trip via `als-read.ts` matches the notes.
- **P3:** MCP (headless) with read and export tools, then edit tools, then save copies.
  - **Built 2026-11-19 (headless).** `packages/core-service` (`ProjectService`: open, read, edit with undo/redo, diff vs original, validate, save copy, export; write guard in `paths.ts`), `packages/ncs/src/edit.ts` (verified-field writers + `changedRanges`), `packages/mcp` (20 tools, stdio `src/main.ts`). `npm test`: 53 pass; `npm run mcp:smoke` drives the real stdio server over the card copy.
  - **Safety as built:** writes only inside `~/Circuit Desk/Copies` and `~/Circuit Desk/Exports` (symlinks resolved; any `Tracks/` path refused); `save_copy` never overwrites; no card tools yet (P5). Edits validate only the values they change, so device-saved oddities (the factory note 128) are kept, not rejected. The CIRCUIT-HACKS lane sum is refreshed after a MIDI 1/2 edit only if it matched before.
  - **Not yet:** `set_field` (header name etc.), the app socket proxy (comes with P4), card write tools (P5).
  - **Accept:** vitest over the in-memory MCP transport; edits change only the expected byte ranges (diff test).
- **P4:** Electron app, Circuit-like UI, editing, undo.
  - **First cut built 2026-11-19.** `app/` (Electron 45 runs `electron/main.ts` directly on its Node 24; React 19 window built by Vite; sandboxed preload in plain JS, as Electron requires). The main process owns the `ProjectService`; the window reaches it only through an allowlisted bridge (`electron/api.ts`). `npm run app` starts it; `npm run app:smoke` runs 14 checks in the real app (keyboard edit, menu undo/redo, saved copy on disk, original untouched, piano roll, drum grid, accessible names, reduced motion).
  - **Circuit view:** 8 track buttons, 8 pattern pads, 4×8 grid (note tracks: 16 steps + 16-key keyboard with page and octave; drums: 32 steps), macro knobs shown read-only. **Editor view:** piano roll with a keyboard cursor (add/remove, move, length, velocity, offset), velocity lane, 4-drum × 32-step grid. **Inspector:** step notes or drum hit, pattern length and sync rate, track chain.
  - **Added the same day (no device needed):** Scenes view (16 scenes, scene chain, per-track chains, store current chains); piano-roll mouse drag (move, resize); velocity lane follows the roll's scroll; the MCP → app link (`core-service/src/rpc.ts`: owner-only local socket `~/Circuit Desk/.circuit-desk.sock`, same method allowlist as the window; the MCP server uses it when the app runs, the files otherwise; `connection` tool says which); playback (`packages/playback` scheduler + Web MIDI in the window, Play/Stop on ⌘↩, output picker, optional clock, playhead on the grids; MIDI permission without SysEx). `npm run app:smoke`: 23 checks.
  - **Automation (same day):** lanes named from the firmware table (`ncs/src/lanes.ts`: note tracks 1–8 macros/knobs, 9 level, 10 reverb, 11 delay, 12 pan; drums 1–4 knobs, 5 level, 6/7 sends, 8 pan; status partial). Shown read-only under the piano roll. MIDI 1/2 knob lanes are exported and played as CC (default template CCs 1, 2, 5, 11, 12, 13, 71, 74; an option takes the real template's). Synth/drum lanes are not exported. Live clip envelopes are not written yet (dragging the `.mid` into Live imports the CC).
  - **Live link, step 1 (same day):** every Live export also writes `<name> (play-along).als`: each track listens on its channel (drums split to 10–13) with monitoring In; the app's "→ Live set" target plays on those channels and kit keys, so playback through the IAC bus is heard in Live with edits live. **Step 2 (Producer Pal clip push) waits for Live + Producer Pal running**, to read its tool schemas before writing to it.
  - **Not yet:** packaged dmg, playback of the scene chain (plays the current chains), per-track MIDI channel settings.
- **P4b:** playback is built and checked against a fake output; **still needs the device** to accept "a project played from the app sounds as it does on the device" and no stuck notes on stop.
  - **Accept:** keyboard-only workflow for editing a step, a scene and a chain; app smoke test (`electron scripts/smoke.ts`, as in move-daily).
- **P4b (S0 sound, decided; needs only P4):** the app plays patterns and scenes on the real Circuit over USB MIDI (`@julusian/midi` behind a `MidiBackend` interface) and sends clock. Audio comes from the device.
  - **Reuse:** `motorik/packages/core/src/midiIO.ts` already has note scheduling, CC 123 panic and a Web MIDI output class that has been run against real ports. In the app window it could replace the native module, which would then be needed only by the headless MCP. Electron must be told to grant the MIDI permission.
  - **Preconditions:** the same project is loaded on the device (so patches and samples match) and the device's own sequencer is stopped.
  - **Accept:** for a test pattern with probability at 100 %, the notes, velocities, lengths and micro-timing the app sends match what the device itself sends on MIDI out when it plays that pattern; no stuck notes on stop (CC 123 / note-offs).
  - **Not covered yet:** automation playback, which waits for the lane→parameter mapping.
- **P5:** card write-back.
  - **Accept:** the snapshot is created; the plan lists only changed files; read-back equals the written bytes.
  - **Device check (needs your approval):** load the edited project on the Circuit and confirm the edits play.
- **P5b (Ableton, decided):** keep the `.als` export, and add a **live clip push** into a running Live set through the Producer Pal MCP (`localhost:3350/mcp`, client pattern in `producer-pal-audio/src/producer_pal_audio/live.py`). Each edit updates the matching clip.
  - **To confirm first:** `live.py` only creates clips (`ppal-create-clip`). No clip-update tool is used anywhere in these repos, so list Producer Pal's tools at the start of P5b. If there is none, an edit deletes and recreates the clip.
  - **Accept:** editing a step updates the Live clip within about 1 s; the push is disabled when Live isn't reachable.
- **R-S2 (research spike, time-boxed to 2 weeks, no commitment):** can the user's official firmware run bit-accurately? Test with the dsp56300 JIT plus dsptool, starting with core 0 alone rendering a synth voice offline, then measure real-time factor on Apple silicon.
  - **Output:** a go/no-go memo with the measured speed and the list of peripherals that would need modelling (dual core, host interface, ESAI).
- **P6:** decode-track fields become editable as they are verified. MIDI preview playback (later). USB SysEx transfer port of the `sd_app.html` stock protocol (later, after you approve it).

## Verification
- Byte-identical round-trip sweep over the real sessions (local).
- Mod-data preservation tests using fixture files with `XLN1` / `SCN3` / tail blocks; `xlSum` recomputed and checked against the `sd_app.html` result.
- Export golden tests: motorik SMF tests, and the `producer-pal` fixture `multitrack_leading_rest_tempo_change.mid` with its `.truth.json`.
- Opening the exported `.als` in Live 12 (manual).
- MCP tests with a fake app socket.
- UI keyboard and reduced-motion checks.

## Sequencer editing in the app (part of P4)
The app has two views of the same project:
- **Circuit view:** pads and knobs, as on the device.
- **Editor view:** a DAW-style workspace with:
  - a **piano roll** per track and pattern (and across a chain);
  - a drum grid;
  - lanes for velocity, gate, probability and micro-timing;
  - an **automation lane editor**;
  - an arranger built from the scene and chain table.

A **constraint layer** in `packages/ncs` keeps every edit inside what the device can store:
- notes snap to the step + sixth-of-a-step micro-timing grid;
- at most 6 notes per step (overflow is shown, never silently dropped);
- at most 32 steps per pattern; longer phrases are split across chained patterns;
- probability is 8 levels;
- gate is bits 0–6 in sixths of a step (`sd_app.html:835`, `:889`; the upstream notes give 1–96, which is up to 16 steps), plus a tie bit in bit 7. Gate length is editable from P4; the tie bit stays read-only until one device check confirms how a tied note plays. None of your 152 projects uses it, so this is low priority.

Illegal input is flagged in the GUI and returned as MCP validation errors.

## Automation: Live ↔ device
- **Device format:** automation is stored per pattern. Synth and MIDI tracks have 12 lanes, drums have 8. Each lane is 32 steps × 6 micro-points, values 0–127, and `0xFF` = no value. CIRCUIT-HACKS adds extra lanes after the 160 780 B (`XLN1`, which must be preserved and has a checksum).
- **Device → Live:**
  - MIDI-track lanes become CC envelopes in the exported clips, using the track's CC template.
  - Synth and drum lanes become CC envelopes that would drive the Circuit over MIDI, once their lane→parameter mapping is known.
  - Exact, apart from the 1/6-step resolution.
- **Live → device:**
  - Clip envelopes are resampled onto the 32×6 grid of each pattern; arrangement automation is split per pattern.
  - Only lanes whose parameter mapping is `verified` are written. Anything else is reported as dropped.
  - Lossy: smooth curves become 1/6-step stairs, the number of parameters per pattern is limited by the lane count, and there is no automation across pattern boundaries beyond what the chain gives.
- **Already mapped (found in revision):** the 8 drum lanes. Lanes 0–3 are the four stock drum knobs, 4 is level, 5 and 6 are the two FX sends, 7 is pan (`docs/NOTAS.md:1178`). They still need one device check before they count as `verified`.
- **Blocker:** the 12 synth lanes aren't documented yet. One pointer: table `0x08059080` gives ids 20–27 = MIDI 1 lanes 0–7 and 30–37 = MIDI 2. It is resolved in the decode track by controlled diffs: record one knob's automation on the device, save, and diff the files.

## Preview engine (built 2026-11-19): the groundwork for S1/S2
- **Kickoff brief for the emulator plan:** [`synth-engine-brief.md`](synth-engine-brief.md) (sources, phases E0–E4, owner decisions D-1–D-6, kickoff prompt).
- **Emulator plan (draft 2026-11-19):** [`synth-engine-plan.md`](synth-engine-plan.md). The 340 B patch matches Novation's documented format on all 1,050 card patches (`tools/patch-sweep.ts`). The stock Synth 1/2 voice has no FM, granular or other mod engines; those are CIRCUIT-HACKS engines on MIDI 1/2. That conflicts with the S1 row below; see the plan, §1.2. Revision 2 also notes that CIRCUIT-HACKS' `dsp_session` already emulates the stock core 0, which reshapes S2 into an offline "oracle" spike (plan D-6).
- **`packages/engine`** (Web Audio, runs in the window): `PreviewEngine` = 8 channel strips (instrument → gain) → master gain → limiter. It takes the scheduler's timed messages (the same ones a MIDI port gets, plus `track` and drum `sample`), so playback, the playhead and live edits are shared with MIDI output.
- **`Instrument` interface** (`types.ts`): `noteOn / noteOff / control / silence / dispose`. Every future sound source plugs in here without touching the scheduler or UI.
  - `Sampler` (drums): the pack's own WAVs (`PCM/NN_Name.wav`, 48 kHz mono), the track's sample from byte 0 of its drum record (checked against sample names on 8 factory projects), per-step sample flips, one sound per track (a new hit cuts the last). Synthetic fallback hits if a sample is missing.
  - `Synth` (Synth 1/2, MIDI 1/2): a 6-voice subtractive stand-in driven by a plain-data `SynthPatch` (named stand-ins in `STAND_IN_PATCHES`). **Next step for S1:** decode the Nova patch (340 B in the project at 0x26D14, banks in `Patches/NN_PATCHBANK.cpb`) into a richer patch model, then either map it onto this synth or replace it with a Nova-like voice behind the same interface.
- **Offline render** (`render.ts`): the arrangement through the engine on an `OfflineAudioContext` → 16-bit WAV. Used by File › Export Preview Audio (⌘⌥E, writes `<name> (preview).wav` in Exports) and by `npm run app:render -- <ncs>`. **Use for S1/S2:** golden renders — once a device recording exists, compare the engine's render to it per track.
- **Pack view**: the 64 samples, click to audition, which drums use which; the place for patch auditioning and editing once patches decode.
- **Not modelled yet:** drum knobs (pitch/decay etc.), mixer levels, pan, FX (reverb/delay/sidechain), swing, probability, synth macros. Each is a decode-track item first.
- **Sequencer timing (2026-11-20):** `packages/export/src/steps.ts`.
  - Reverse, ping-pong (alternates each play, end steps repeat: inferred from the per-track lap counter, NOTAS:2057) and swing (pairs of 1/16 steps; curve not measured) go into files and playback.
  - Step probability ((p + 1) / 8, one roll per step, NOTAS:2042/2359) and random direction are rolled again on each loop pass by the scheduler. Files keep every note and write random patterns forward.
  - Direction order 0–3 = Forward, Reverse, Ping-pong, Random, from the Circuit Tracks User Guide v2 pads 29–32.
- **Scale and project settings (2026-11-20):** `packages/ncs/src/settings.ts`.
  - Scale type is loose-settings byte +17 and the root is +16 (`partial`).
  - **Stored step notes are relative to the root.** Read with the root at C, the card's synth and MIDI notes fit their scale 98.5 % and 98.9 % of the time; read from the stored root, 87.7 %. That matches NOTAS:1828.
  - So arrange transposes every note track by the root. That changes exports and playback for the 28 card projects whose root isn't C.
  - **Device check 2026-11-24 (MIDI out over USB, `app:midi-record`):** a C minor project playing; the root was changed C → G mid-play. From the change on, every Synth 1 and Synth 2 note came out exactly +7 semitones (24 of 24 Synth 2 notes in a loop, 8 of 8 Synth 1), scale shape kept, drums unchanged. The device transposes note tracks by the root, as arrange does. Saved before and after the change (slots 31 and 32, downloaded with Components' web app) and diffed with `tools/settings-diff.ts`: only the root byte changed (0 → 7, plus a Synth 2 macro position touched by hand); no note byte moved. So stored notes are relative to the root and the device adds it: `scaleRoot` is now `verified`. Scale type, tempo, swing, mixer, FX and drum settings still await the full A/B save.
  - Bytes +18 to +21 are still unknown.
- **Editable now:** name, tempo, swing, scale, reverb, delay, sends, FX bypass, sidechains, levels, pans and drum sounds (`setSettings`, MCP `set_settings`), and pattern direction.
  - These fields are `partial`, and editing them departs from the registry rule "editors may only change `verified` fields".
  - Decided by the owner on 2026-11-20 ("close the editing gaps"): edits still only reach copies, and each change reports its status.
  - Promotion to `verified` comes with the card write-back device check.
- **App:** a Mixer view (strips with level, pan and sends; mute and solo during playback only; reverb, delay and sidechains) and a Project view (name, tempo, swing, scale, drum sounds).
  - The keyboard pads follow the scale as on the device; Chromatic is a piano layout.
  - Note names show sounding pitch (stored note + root).

## Sound engine options and the Ableton link (effort estimates)
| Tier | What | Fidelity | Effort [estimate] | Risk |
|---|---|---|---|---|
| S0 | **Use the real Circuit as the sound source.** The app plays its patterns to the device over USB MIDI in real time, and audio comes from the Circuit's outputs | exact | about 1 week on top of P4 | low |
| S1 | Approximate engine: AudioWorklet synth with a Nova-like voice (2 oscillators, filter, 2 envelopes, 2 LFOs, mod matrix, the documented patch parameters) plus playback of the pack's `PCM/*.wav` drum samples, plus simple delay/reverb/sidechain | drums close; synths "in the family", not identical; mod engines (FM-8, wavetable, granular) extra | 6–12 weeks | medium |
| S2 | **Bit-accurate emulation:** run the user's own official firmware. That means the DSP56724 programs on the dsp56300 JIT (the same emulator the repo uses; its Gearmulator project runs Access Virus firmware in real time, with an arm64 JIT), the ARM app in an emulator, plus models of the dual-core shared memory, the host interface and audio I/O. Mod engines come for free once the image runs | exact (including the mod) | **months** (a Gearmulator-class project); the dual-core and peripheral modelling is the unknown | high; real-time speed for two DSP cores plus the ARM on Apple silicon is unproven |

**Is the Ableton link real time?**
- The planned `.als` export is a **file**, not real time.
- Real-time options:
  - (a) the Circuit as a MIDI device in Live (clock and notes over USB);
  - (b) Circuit Desk pushes patterns into a **running** Live set through the Producer Pal MCP that `producer-pal-audio/src/producer_pal_audio/live.py` already drives at `localhost:3350/mcp` (near-live: a clip updates on each edit);
  - (c) audio into Live needs a cable from the Circuit's outputs into an interface. I found no evidence that the Circuit Tracks streams audio over USB; retailer specs describe USB only as power/charging and class-compliant MIDI. To be confirmed.

## Ableton Move features the Circuit Tracks lacks: where each could land
Sources:
- Ableton's official Move release notes (1.1.2 to 2.1.x);
- press coverage of 2.0 / 2.1;
- features the CIRCUIT-HACKS guide already has, checked with grep in `docs/GUIA.en.md`.

"Mod has" means it is already in CIRCUIT-HACKS. Firmware additions compete for the ~2 KB of flash left on the RC.

| Move feature | Circuit / mod today | Desktop app (Circuit Desk) | Firmware |
|---|---|---|---|
| Undo/redo | none | **P4: full history** | P: one level of pattern undo only if ~3.3 KB RAM is found (candidate: backup SRAM); needs space |
| Capture (keep what you just played, unrecorded) | none (the mod's "capture" means sample capture) | **P6: record the Circuit's USB MIDI output into a new pattern** | P: note ring buffer of ~1 KB RAM; needs space |
| Set export to Live / Cloud sync | none | **P2: `.als` + multitrack MIDI** (Session clips = patterns, scenes = scenes) | — |
| Templates / presets for new sets | none | **P4: project templates** | — |
| Time signatures (2.1) | the pattern first/last step already gives odd lengths | export writes the meter; a view of bars and steps | low value |
| Quick note length (hold step, tap another) | stock Gate view | GUI gesture | F: small; flash-limited |
| In-Key 4ths layout | mod has the Jankó isomorphic layout | GUI keyboard layouts | F: small variant of Jankó |
| All Sound Off (CC 120) on stop | not found in docs | — | F: tiny. Useful for the Pro-800 / Model D / Solina |
| Note repeat (drums) | the mod arpeggiator covers synth/MIDI tracks | GUI step "rolls" use the stock micro-step mask | P: drum note repeat; needs space |
| Arpeggiator, solo, quantize, 16-pitch drums, slicing, reverse | **mod has** (arp, Mixer solo pad 16, Shift+Play quantize, drum chromatic pads, granular slicer/reverse) | edit / display | exists |
| Per-track MIDI in/out, clock in/out, MIDI exchange | stock has | — | exists |
| Audio tracks, time-stretched loops, bounce to audio, Link / Link Audio | none | not planned (the app is not an audio engine) | **U**: DSP, sample memory and no network |
| Polyphonic aftertouch, display, jog wheel, battery, mic | hardware | — | **U**: hardware; the pad path has no pressure value |
| Control-Live mode | the parked CTL controller plan (`../../circuit-tracks-controller/planning/10-implementation-plan.md`) | — | parked (CTL) |

**Takeaway:** most of Move's workflow advantages (undo, capture, templates, Live export, comfortable step editing) land cheaply in Circuit Desk. Firmware candidates are the small ones (CC 120 on stop, 4ths layout, quick note length). Each would be an upstream proposal, because of the flash budget. Undo, capture and drum note repeat in firmware wait for the upstream space plan.

---
