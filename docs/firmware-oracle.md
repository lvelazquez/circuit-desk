# Firmware oracle and parameter sweeps (E0.6 and the core-1 spike)

Status 2026-11-19. Everything here runs on your own copy of the official firmware (`circuit-hacks-rc/stock/`). Nothing derived from it is committed: results go to `~/Circuit Desk/Firmware-derived/`, and only code and a few constants live in this repo (decision D-10 in `synth-engine-plan.md`). Nothing here touches the device.

## What exists

| Piece | Where | State |
|---|---|---|
| DSP emulator built on this Mac | `tools/firmware/build-dsptool.sh` | Works. Needs `cmake` and `ninja` (a venv is enough) and a C++ compiler. Output: `~/Circuit Desk/dsp-tools/bin/dsptool-c1`. |
| Parameter table export | `tools/export-params.ts` | Works. 302 parameters with their CC or NRPN. |
| Parameter sweep | `tools/firmware/sweep.py` | Works. Sends every parameter's full range through the stock ARM code and records the words written to the DSP, when the parameter is set and when a note starts. All 298 Synth 1 parameters take about 16 minutes. |
| Sweep report | `tools/sweep-report.ts` | Works. Classifies each moving word: linear, stepped, monotonic or geometric. |
| Core-1 stand-in | `tools/firmware/dsptool-c1.patch`, `dsp56kEmu-c1hook.patch` | Serves core 0's table requests. See "How the stand-in works". |
| Audio oracle | `tools/firmware/oracle.py` | Oscillator and effects chain run; the final mix to the output ring is still silent. See "Where the oracle stands". |

Python is used for the sweep and the oracle because they drive `unicorn` and `dsptool` from the circuit-hacks-rc clone. The report and analysis are TypeScript.

## What the sweep shows (stock ARM code, emulated; not yet compared with a device)

- **157 of 298 Synth 1 parameters move DSP words.** The other 141 are handled on the ARM (the 80 macro fields, polyphony, octave) or are not reached by this method (some LFO rates, `mixer.osc1`).
- **Most values reach the DSP as plain fractions:** 0x10000 per step (value ÷ 128 of full scale) for filter drive, Q normalise, distortion level, chorus level and rate, EQ frequencies and others.
- **Filter frequency (CC 74) is one word, `X:$3E7`.**
  - It starts at 0x1BB6AA and rises by about 43 691 (0x800000 ÷ 192) per step.
  - It stops rising at CC 111 (0x65B6AA): the top 16 steps of the control send the same word.
- **Envelope times go to the DSP at note-on, not when set.** Envelope 1 attack is `Y:$14E` (0x3D57B at 0, falling to 0xFC), decay `Y:$14B`, release `Y:$150`. Several of these also stop changing well before 127 (attack at 86, release at 106 for envelope 1).
- **Distortion level (CC 91) has an offset:** `X:$3F0` equals (value + 44) × 0x10000, reaching its maximum at value 83.
- **Portamento** is two words at note-on (`Y:$15A`, `Y:$15B`); pitch for oscillator 1 is `Y:$148`.

These are the DSP's own units. Turning them into hertz and seconds needs either the DSP code or rendered audio, which is why the oracle matters. Until then they replace guesses only where the unit is already a simple fraction.

## How the stand-in works

The stock core-1 program is 364 words. It keeps a list at `X:$30002…`: core 0 appends source addresses, publishes the end pointer at `X:$30000`, and core 1 overwrites each entry with the word stored at that address in its external memory. The tables (sine, saw, wavetables) are in that external memory, not in the firmware image.

The patched `dsptool` does the same job: when core 0 writes the end pointer, every queued entry is replaced by the word at its address from `C1LOAD addr file`. Two facts found on the way:

- `dsp56kEmu` runs a whole `DO` loop in one interpreter step, so a program-counter hook on the wait routine never fires; the hook is on memory writes instead.
- Core 0 also uses external memory above `$80000` (delay and reverb buffers), so the emulator's address space is enlarged to 0x200000 words.

## Where the oracle stands (updated 2026-11-20)

Fixed since the first write-up, in order of discovery:

1. **Served words must be visible from both buses.** After the wait, core 0 reads the results with `y:(r5)+`, while it queued the addresses with `x:(r1)+`. The shared window is one RAM seen from both buses, so the stand-in now writes each result to the X and the Y view. This is what made the oscillator produce samples at all.
2. **The serve trigger is the end-pointer write, not a read.** Reads of the list bypass `Memory::get` after the first block, so serving on read only worked once.
3. **The saw is read at several band-limited levels.** The table base steps down by `0x2000` as the note ages (`$173000`, `$171000`, `$16F000`, …), so tables must be supplied for a run of levels, each a value table with a second table at `+$1000`. With 24 levels supplied the oscillator keeps sounding for the whole 400-block test.
4. **The output ring is in X memory** at `$1000` (write pointer `Y:$FFD`), not Y.

What works now: the oscillator writes a real saw into its scratch buffer at `Y:$A01…`, and the per-synth effects chain (distortion, EQ, chorus) carries it: `X:$2DF0` grows to about 0.18 of full scale over a few hundred blocks.

**Still silent:** the master section that sums the track buses into the output ring (`X:$2C00…`, `X:$2E10…`) stays at zero, and so do its gain arrays (`X:$2EB0`, `X:$2EF0`, `X:$1B32…`). Track volume (CC 7) and pan (CC 10) do not change them. Ruled out as the cause: the table format, the parameter dump, the ring address.

Next steps:

1. Watch every writer of `X:$2C00–$2CFF` and `X:$2EB0–$2EFF` to learn which routine fills the master gain arrays and what it waits for. The buffers at `$2EB0/$2EF0` are inputs of the reverb/delay returns (`P:$CB8`), so the dry path may need a different trigger.
2. Check the mixer parameters the ARM sends when a project loads (track levels, sends), which a bare RAM dump may not include; the sweep tool can find the CC or NRPN that moves them.
3. Supply a sine for wave 0 and the second oscillator's zone (`$100000…`, `$102000…`), which is still all zeros.
4. Once the ring sounds, compare against `curves.ts`: render each swept parameter and fit hertz and seconds.

## Running it

```
tools/firmware/build-dsptool.sh                              # once
node tools/export-params.ts "$HOME/Circuit Desk/Firmware-derived/params.json"
cd ~/"Personal Repo"/circuit-hacks-rc && .venv/bin/python ~/"Personal Repo"/circuit-desk/tools/firmware/sweep.py --synth 0
node tools/sweep-report.ts ~/"Circuit Desk"/Firmware-derived/sweep-synth1.json report.md
```

Boot-time DSP setup, the wavetable source and the fix for the silent master: see [firmware-boot.md](firmware-boot.md).
