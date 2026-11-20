# Device session checklist (plan Track 3)

One sitting with the Circuit Tracks connected over USB and its outputs going into an audio interface.
This checks the parts that can only be confirmed on the device: the patch layout (D-8), the firmware
the device runs, the Keyboard Octave question, P4b playback, and the measurements Track 2 needs.

**Rules for the whole session**

- **Each send is approved at the time.** Every script below does a dry run first. A dry run lists the
  ports and prints the exact bytes it would send, and sends nothing. Read that output, then run it again
  with `--yes` once the owner has agreed.
- **No device writes.** The scripts can only send:
  - `device-dump` sends only the two current-patch dump requests and the fwid query. The allowlist is
    in `packages/patch/src/device.ts` and is checked twice: in the script process and again in the page.
  - `device-record` sends only channel messages (notes, and CC/NRPN when a list holds them). Web MIDI
    is opened without SysEx, and any `F0`/`F7` byte is refused. At the end it sends a note-off for every
    note still on, then All Notes Off (CC 123).
- **Nothing is written to the SD card or under any `Tracks/` path.** Output goes to
  `~/Circuit Desk/Device/<timestamp>/` (or `--out <dir>`, which is refused under a `Tracks/` folder).
- **Recordings stay local** and are never committed, like samples and firmware-derived data
  (`synth-engine-plan.md` §5).
- **Check the tools without the device first:** `npm run app:device-smoke`. It runs both device scripts
  against fake ports and a fake audio input, then analyses the result.

**Preconditions for every step**

- The same project is loaded on the device and open in the app. Load it unedited and don't touch the
  synth knobs, because the dump compares against the file.
- The device's sequencer is stopped, unless a step says to press Play.
- The port names the scripts list contain "Circuit". If several ports match, pass a more exact `--port`.
- The audio interface input is known by part of its name, for example `--input "Scarlett"`. Set the gain
  so the loudest note peaks around −12 dBFS. Audio processing is turned off by the script.

---

## 1. Firmware identity (`fwid`, read-only)

```sh
npm run app:device-dump -- fwid                 # dry run: ports and the 14 bytes
npm run app:device-dump -- fwid --yes           # sends F0 7D 43 54 00 23 00 00 00 00 00 00 00 F7
```

- **What it sends and what comes back.** It sends the fwid query from circuit-hacks-rc `tools/fwid.py:5-6`.
  - A Circuit Hacks build answers `F0 7D 43 54 40 23 01 m0..m5 F7`, and the script prints the marker
    (for example `B5.47`).
  - **No answer** means the stock firmware, or a Hacks build older than the fwid hook. The stock firmware
    ignores manufacturer 7D messages.
- **Then:** set the app's firmware selector to match (toolbar `#firmware`, `app/src/App.tsx:331`, or the
  MCP `firmware` tool).

## 2. D-8 patch dump (read-only)

Load a known project on the device unedited, for example a card-copy project you also have on disk. Then:

```sh
P="$HOME/Circuit Desk/Card copy/2026-11-19/Tracks/<pack>/Sessions/<project>.ncs"
npm run app:device-dump -- dump "$P"            # dry run
npm run app:device-dump -- dump "$P" --yes      # F0 00 20 29 01 64 40 00 F7, then … 40 01 F7
```

- **How the comparison works.** Each answer is a 350-byte "replace current patch" message. Its 340 patch
  bytes are compared with the file's patch at `0x26D14 + 340·n`.
- **What it prints:** `identical`, or each differing address with its parameter id (from `PATCH_PARAMS`).
- **What it saves:** `synth1.syx`, `synth2.syx` and `summary.json` in `~/Circuit Desk/Device/<timestamp>/`.
- **Exit codes:** 0 identical, 1 no answer (within `--timeout`, default 3000 ms), 2 a patch differs.

**If both synths are identical**, promote the patches. This is one commit:

1. In `packages/ncs/src/registry.ts:46-47`, set `patch.synth1` and `patch.synth2` to
   `status: "verified"`. Replace the evidence with:
   `"device dump <date>, <project> byte-identical (Synth 1 and 2; ~/Circuit Desk/Device/<timestamp>)"`.
   Keep the reference to the Programmer's Reference and the card sweep.
2. Update the `verified` definition comment at `registry.ts:6`. It currently says "so far: by the upstream
   project's editor"; add "or by a device dump that matches the file".
3. The patch editor's status line switches to "verified" on its own (it reads the registry). Check it in
   the Patch view, and check `npm test` (registry tests).
4. Record it in `docs/synth-engine-plan.md` Progress and in `docs/PLAN.md`.

**If they differ**, don't promote. The printed addresses say which fields to look at; keep `summary.json`
as the evidence. Name bytes (`name[i]`) differing only by trailing padding are worth a second dump of
another project before drawing conclusions.

## 3. Octave check (`40_SESSION`, LivingDead)

- **The project:** `00_Delorean Dream-Tracks/Sessions/40_SESSION.ncs`.
  - Synth 1 is **LivingDead**: Keyboard Octave `voice.octave` = 63 (−1 oct), Osc 1 at −12 st.
  - Synth 2 is Square TB.
- **The question.** `packages/engine/src/nova/voice.ts:78-82` says the voice must not apply Keyboard
  Octave, because the sequencer already stores the shifted note. Applying it put LivingDead's Osc 1 at
  16 Hz. This step confirms or reverts that comment.

1. Load `40_SESSION` on the device. Mute every track but Synth 1, then record the device playing it.
   Nothing is sent over MIDI:
   ```sh
   npm run app:device-record -- --input "<interface>" --seconds 20          # dry run
   npm run app:device-record -- --input "<interface>" --seconds 20 --yes    # then press Play on the device
   node tools/analyse-recording.ts "<dir>/audio.wav"
   ```
2. Render the same project through the app's preview (the voice's current pitch) and analyse it the
   same way. Mute everything but Synth 1 in the app first, or compare only the Synth 1 notes:
   ```sh
   npm run app:render -- "$HOME/Circuit Desk/Card copy/2026-11-19/Tracks/00_Delorean Dream-Tracks/Sessions/40_SESSION.ncs"
   node tools/analyse-recording.ts "<printed preview wav>"
   ```
3. Compare the measured fundamentals note by note.
   - **The same (within a few cents):** the comment stands. Rewrite "To confirm on a device" as
     "Confirmed on a device <date>".
   - **The device an octave lower:** the voice should apply Keyboard Octave. Revert, and record the
     measured Hz as the evidence.
4. Optional cross-check over MIDI: with LivingDead loaded, send a single note on channel 1. This tests
   the MIDI-in path, which may differ from the sequencer path:
   `npm run app:device-record -- --input "<interface>" --notes 60 --channel 1 --yes`.
   Osc 1 at −12 st gives about 130.8 Hz with no octave shift, or 65.4 Hz with it.

## 4. P4b: playback from the app matches the device

- **Use a test pattern with step probability at 100 %** (no random direction). `compare-midi` warns
  about notes with probability or random direction.
- **Check on the device first:** the Circuit must send its sequencer notes on MIDI out (the MIDI Tx
  notes setting in Setup view). This is not confirmed yet; if `midi-record` hears no notes, check that
  setting first.

1. **The device's own playback**, recorded from its MIDI out:
   ```sh
   npm run app:midi-record -- 30 circuit "$HOME/Circuit Desk/Device/p4b-device.json"   # press Play on the device, Stop before 30 s
   ```
2. **The app's playback.** The Circuit doesn't echo what it receives, so the app's stream is recorded
   from the IAC bus:
   - `swift tools/iac-online.swift` turns the IAC Driver on.
   - In the app, choose the IAC bus as the output.
   - Run the line below, then press Play and Stop (⌘↩) in the app.
   ```sh
   npm run app:midi-record -- 30 iac "$HOME/Circuit Desk/Device/p4b-app.json"
   ```
   Then switch the app's output to the Circuit and play the same project to the device, to hear that it
   sounds as it does on the device. The device's sequencer must be stopped.
3. **Compare:**
   ```sh
   node tools/compare-midi.ts "$P" "$HOME/Circuit Desk/Device/p4b-device.json" --against "$HOME/Circuit Desk/Device/p4b-app.json"
   node tools/compare-midi.ts "$P" "$HOME/Circuit Desk/Device/p4b-device.json"     # the device against the project's own notes
   ```
   - **What it checks:** pitch, velocity, length, and onset within ±1 micro-step tick (a step is
     6 ticks) at the project's tempo, for each channel's sync rate.
     - `--ticks N` widens the tolerance; `--tolerance-ms N` sets it in ms.
     - The two streams are lined up by their first note-on and then by the median onset difference.
   - **Stuck notes:** a note-on with no note-off counts as stuck. All Notes Off (CC 123) is reported but
     doesn't excuse it.
   - **Exit code:** 0 PASS, 1 FAIL. Keep the output as the P4b evidence.

## 5. Measurements for Track 2 (LFO rate, an envelope time, filter frequency)

- **Setup:** a known patch is loaded (an init-like patch is easiest). Each take is a single held note,
  analysed with `node tools/analyse-recording.ts <dir>/audio.wav <dir>/events.json`.
- **What each column gives:**
  - `attack ms`, `decay ms`, `sustain dB`, `release ms`: the envelope;
  - `Hz`: pitch; `peak`/`rms`: level;
  - `mod Hz`: the rate of a periodic level change, for an LFO routed to the filter or level. Hold the
    note for at least two LFO periods.

**Moving a parameter between takes needs the owner's OK at the time, or is done by hand.** The owner
hasn't decided between these:

- **By hand on the device (no extra sends):** set the value, then record a take with
  `--notes 48 --channel 1 --length 3000 --gap 2000 --yes`. Write each value into a notes file next to
  the recording.
- **Over MIDI (needs owner OK at the time; RAM only, the E4 exception):** a `--list notes.json` that sets
  the value before each note. Controller numbers (from `PATCH_PARAMS`, Synth 1 on channel 1):
  - filter frequency: CC 74;
  - Env 1 attack, decay, release: CC 73, 75, 72;
  - LFO 1 rate: NRPN 0:76, sent as `B0 63 00`, `B0 62 4C`, `B0 06 <value>`;
  - LFO 1 rate sync: NRPN 0:77 (set it to 0, free-running).

  For example, `[{"t":0,"bytes":[176,74,20]},{"t":200,"bytes":[144,48,100]},{"t":3200,"bytes":[128,48,0]}, …]`.
  These change the current patch in RAM only. Reload the project afterwards so nothing carries over.

**Suggested values:** 0, 32, 64, 96 and 127 for each parameter. Filter frequency on a saw with
resonance 0, read as a spectrum later if needed. For LFO rate, route LFO 1 to filter frequency with a deep
depth and read `mod Hz`.

## 6. Optional D-7 wavetable capture (needs owner OK at the time; RAM only, never saved)

**Not part of the read-only session.** It needs a "Replace current patch" send (`replaceCurrentPatchMessage`,
location 0). That is outside `device-dump`'s allowlist on purpose, so it needs its own approved script
or tool on the day.

- **What it would do:** for each wave 14–29, load a test patch with Osc 1 on that wave, no filter, no
  effects and a fixed index. Record a held note at each of the 9 frames with `device-record`, then turn
  the recordings into single-cycle tables.
- **Where the results go:** they stay in `~/Circuit Desk/Firmware-derived/` (D-10) and are never
  committed.
- **Afterwards:** reload the project on the device so the RAM patch is gone.
