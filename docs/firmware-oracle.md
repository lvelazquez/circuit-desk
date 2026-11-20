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
| Audio oracle | `tools/firmware/oracle.py` | Runs, but renders silence. See "The open blocker". |

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

## The open blocker: silent output

With an ideal saw ramp supplied at `$173000` (values) and `$174000` (slopes, set to zero), core 0 requests and receives its table words (224 entries in the first block, then 384 per block, none missing for oscillator 1), the voice phase advances, and the envelope ramps. But the output ring is zero, and so is every intermediate buffer I looked at (`X:$2DF0`, `$2E10`, `$2E50`, `$2E70`).

Ruled out: reading the wrong space (the ring is in X, now read correctly), a missing parameter dump (replayed first), track volume and pan (CC 7 and 10 changed nothing).

Next steps, in order:

1. Watch writes to the voice bus. Each oscillator batch ends in `a,y:(r7)+n7` inside the per-voice routine at `P:$77F`; find where the first non-zero oscillator sample lands, using `dsptool`'s `WATCH` on candidate buffers.
2. Check the table format. Two tables are requested (values and `+$1000`); the values may need a different scaling or sign convention, or the second table may not be a slope.
3. Check the mixer and master state the ARM sets from a project (track level, master volume at `X:$DE`), which a bare RAM dump may leave at zero.

If the oscillator path can't be made to sound within a day or two of this, the fallback in the plan is unchanged: curves from the sweep plus ear and recordings for the rest.

## Running it

```
tools/firmware/build-dsptool.sh                              # once
node tools/export-params.ts "$HOME/Circuit Desk/Firmware-derived/params.json"
cd ~/"Personal Repo"/circuit-hacks-rc && .venv/bin/python ~/"Personal Repo"/circuit-desk/tools/firmware/sweep.py --synth 0
node tools/sweep-report.ts ~/"Circuit Desk"/Firmware-derived/sweep-synth1.json report.md
```
