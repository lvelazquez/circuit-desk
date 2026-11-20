# Firmware boot: where the wavetables come from, and why the oracle was silent (E0.6, E0.7)

Status 2026-11-20. Like `firmware-oracle.md`, everything here runs on your own copy of the official firmware (`circuit-hacks-rc/stock/`) in emulation. Nothing derived from it is committed (D-10): the tools print addresses, lengths and levels, and anything they write goes under `~/Circuit Desk/`. Nothing here touches the device.

## Summary

- **The wavetables (waves 14–29) are not in the firmware file.**
  - At boot the ARM reads them from the device's own storage, at `0x82000–0x94000`: 16 waves × 9 frames × 256 16-bit samples.
  - It sends each frame to DSP core 0, which works out the band-limited levels itself.
  - Without the device there is no way to get them: they stay placeholders (D-1 b).
- **Waves 0–13 need no data.** At boot the DSP generates the basic waveform tables itself, from four commands. The oracle now runs them, so its oscillator plays tables the stock DSP code built.
- **The silent master is fixed.** The oracle never ran the ARM's mixer and settings flushes, so every track level, the master level and the output level stayed at zero.
  - With `Oracle(boot=True)`, a held Synth 1 note with the default patch reaches about −25 dBFS RMS. Numbers are below.

## Tools

| Tool | What it does |
|---|---|
| `tools/firmware/boot_trace.py` | Runs the ARM's boot-time DSP setup in unicorn and prints every DSP write, storage read and DSP poll in order. `boot_writes(img)` returns the core-0 writes. |
| `tools/firmware/oracle.py`, `boot=True` | Replays the boot setup in the oracle; details below. |
| `tools/firmware/oracle_check.py` | Renders one note with `boot=True` and no supplied tables, and prints peak and RMS per 1024 frames. `--no-boot` shows the old silent oracle; `--wav` writes a WAV to `Firmware-derived/`. |
| `tools/firmware/sweep_project_fx.py` | The project FX sweep (delay and reverb words), moved here from a scratch script. |
| `dsptool-c1.patch`: `C1FROMY ON` | The core-1 stand-in serves any address nobody loaded from core 0's external Y memory. `C1STAT` counts these as `fromY`. |

How `boot_trace.py` stubs things:

- **DSP reads (`0x08029344`):** every read returns `$800000`. The boot code polls `Y:$2B` (DSP ready) and `Y:$2C` (command done).
- **Storage read (`0x08047C6C`):** logged, and the destination filled with zeros.
- **DMA bulk write (`0x0803BA78`):** fed to the SHI decoder. The SPI hook in `shi_capture` never sees DMA.

Run the Python with the circuit-hacks-rc venv:

```
"$HOME/Personal Repo/circuit-hacks-rc/.venv/bin/python" tools/firmware/boot_trace.py --quiet
"$HOME/Personal Repo/circuit-hacks-rc/.venv/bin/python" tools/firmware/oracle_check.py --blocks 400
```

`tools/firmware/build-dsptool.sh` rebuilds `dsptool-c1` with `C1FROMY`. It needs `cmake` on `PATH`, for example `~/Circuit Desk/dsp-tools/cmake-venv/bin`.

I also built a disassembler, `~/Circuit Desk/dsp-tools/bin/dis56` (`dis56 core0.bin from to`), with the stock core-0 listing in `dsp-tools/scratch/core0.lst`. Both are local only; the disassembler is a small CLI over dsp56kEmu's own `Disassembler`, and its source and build script are in `dsp-tools/src/`.

## The ARM boot sequence (from `re/app.asm` in circuit-hacks-rc)

`0x0801F554` runs these in order:

1. **`0x08029260(0)`:** uploads the DSP programs, then tail-calls `0x08029492`, the post-upload tables. `dsp_session.Session` already ran that part.
2. **`0x08029710`:** writes `X:$91`, then 35 gain-law words to `X:$98E…` and 35 to `X:$9B1…`, computed on the ARM in floating point.
   - Core 0 reads the first table at `P:$070D` and `P:$101B`, indexed by level.
   - **The oracle never had these.**
3. **`0x0802108C`:**
   - waits for `Y:$2B`;
   - runs the zone loader **`0x08035E28`**;
   - writes `X:$13` = 12 (the main loop at `P:$125` skips the audio work while it is 0) and `X:$14`;
   - writes per-voice initial words for 12 voices: `Y:$150 + $60·v`, `X:$57A + $4A·v`, and so on;
   - writes `X:$CE` and `Y:$2F = 1` (fade out and clear; see the master fade below).

### Zone loader `0x08035E28` (confirmed in emulation)

Thirty zones of `$28800` words, starting at `$100000`. The pointer table is at RAM `0x20005D40`.

**Zones 0, 1, 2 and 13: one command each.** The ARM waits until `Y:$2C` reads `$800000`, then writes:

| Zone | Base | `Y:$2C` word | Command |
|---|---|---|---|
| 0 | `$100000` | `$080002` | 2 |
| 1 | `$128800` | `$094403` | 3 |
| 2 | `$151000` | `$0A8804` | 4 |
| 13 | `$179800` | `$0BCC05` | 5 |

- The word is the address ÷ 2 with the command in its low bits.
- Zones 3–12 get no command and no space: their table entries repeat zone 2's base.

**Zones 14–29: the 16 wavetables** (wave = zone).

- Zone 14 starts at `$1A2000`; frames are `$4800` words apart; the last frame is at `$425800`.
- For each of 9 frames:
  1. wait for `Y:$2C = $800000`;
  2. set the DSP address to `X:$C00`;
  3. write `X:$12 = $200100`, an SHI command: bit 21 → `P:$12D`, 16-bit word mode;
  4. **storage read** `0x08047C6C(src, 0x20005148, 0x200)`;
  5. DMA of 512 bytes to the DSP, then a 2-byte trailer;
  6. `Y:$2C = frame address ÷ 2`, which is command 0.
- `src = 0x82000 + wave·0x1200 + frame·0x200`. The 9 frame offsets and lengths come from a 12-byte-per-entry table in flash at `0x080567EC`.
- The trace shows exactly **144 storage reads, all 512 bytes, covering `0x82000–0x94000` (73,728 bytes)**, all into the same RAM buffer.
- Only one 256-sample frame per wave position is read. The 18 band-limited levels (`$4800` = 18 × `$400`) are built by the DSP.

**The storage device.** `0x08047C6C` calls method +0xC of the object at `[0x20006968]`; in the RAM dump its vtable is `0x0805B1D8`. Method +0xC (`0x08024131`) builds a {source, destination, length} request and calls method +0x1C.

- **Inferred, not confirmed:** this is the external flash that also holds packs and projects. The peripheral behind +0x1C was not traced.

**Mapping to core 1.** NOTAS.md:734 in circuit-hacks-rc reads wave *w* at `$1B4000 + (w − 14)·$28800` in core 1's external X. The ARM's zone 14 starts at `$1A2000`, which is `$12000` (= 4 × `$4800`) lower.

- The `$28800` step per wave matches.
- The fixed offset is not explained yet. The command-0 handler adds `x:$1B21 × $11`-based offsets (`P:$1D0F–$1D18`), which may account for it.
- The earlier note that zone 14 is at `$337000` was an indexing slip: `$337000` is entry 24.

### DSP side: the `Y:$2C` dispatcher `P:$1C53` (from the listing; behaviour confirmed for commands 2–5)

The main loop calls it at `P:$121`. The target Y address is `(word & $7FFFF0) << 1`.

| Command | What it does |
|---|---|
| 0 | Band-limits the 256-word frame at `X:$C00` into levels at the address (`P:$1CFE`). The work is spread over several calls: `Y:$2C = $C00000` while busy, `$800000` when done. |
| 1 | Same machinery with `x0 = $2000`. Not used at boot. |
| 2 | A sine, by recursion (`P:$1CF4` → `P:$1DAF`). |
| 3 | `X:$2800` squared, every other entry cleared, then band-limited (`P:$1CE6`). |
| 4 | `X:$2800` as is, then band-limited (`P:$1CD0`). |
| 5 | `X:$2800` with every other entry cleared, then band-limited (`P:$1CD9`). |
| 6 | Sample upload: 512 words from `X:$C00` (NOTAS.md:2680). |
| 7 | Sample table entry (NOTAS.md:2680). |

- `X:$2800` is a copy of `X:$C00–$FFF`, made at `P:$25F8` from the post-upload tables.
- **Confirmed:** zones 0, 1, 2 and 13 hold DSP-generated waveforms, not delay or reverb buffers as NOTAS.md:2678-2689 in circuit-hacks-rc says.
  - Zone 2 holds the oscillator's saw levels: the reads at `$173000`, `$171000`, … described in `firmware-oracle.md` fall inside it.
  - With `boot=True` the oracle runs all four commands to `$800000`, and its oscillator's 204,576 table reads are all served from them. None is missed, and no table is supplied.
- **Inferred:** which waveform each spectrum command makes. Commands 4 and 5 look like a saw (all harmonics) and a square (odd harmonics). Command 3 is probably triangle-like.

## Why the master mix was silent

Using the disassembly and `WATCH` on one block, the signal path is:

1. **`X:$2DF0`** (the per-synth effects output) is non-zero.
2. **Level and pan, `P:$0FF9`, writes `Y:$840`.** The level law there is `X:$98E[n]`, which stayed zero until step 2 of the boot sequence was replayed.
3. **Track mix at `P:$0240`:** `Y:$800 = Σ X:$1B32·Y:$840 + X:$1B72·Y:$880`.
   - `X:$1B32` is computed as `Y:$57/$58 × Y:$2028[]` at `P:$12ED` → `P:$13A3`.
   - `Y:$57/$58` come from one-pole smoothers (`P:$1B2B`, called from `P:$1AFA`). They chase `X:$52/$53` (Synth 1 level and pan) × `X:$407`.
4. **Master, `P:$144D`:** `X:$2E10 = Y:$7FF × mix`.
   - `Y:$7FF` comes from a smoother chasing `X:$72` (master level), at `P:$1AE7`.
5. **Output stage `P:$21C4`:** writes the ring at `X:$1000` through a gain `X:$1EE6`, which ramps toward `X:$DE` (output level).

**`X:$52–$59`, `X:$72` and `X:$DE` are never written** by the post-upload init (`0x08029492`) or by the forced parameter flush (`0x080213B0`) that `dsp_session` runs. The ARM writes them from two other flushes:

- **mixer, `0x08028EF2`** (dirty group `0x20`):
  - `X:$D1–$DD` (reverb) and `X:$948–$94E` (delay);
  - `X:$E3–$EA` and `X:$AB–$CA`;
  - `X:$3F2–$3F6` and the matching words for the other tracks;
  - `X:$52–$59` (track levels and pans), `X:$72` (master), `X:$18B`;
- **settings, `0x08028FD6`** (group `0x21`): `X:$CF/$D0`, `Y:$10D–$110` and `X:$DE`.

`boot=True` runs both through `Session.capture`.

**The master fade (found, not needed for the dry path).**

- `Y:$7FE` is a fade level stepped by `Y:$7FD` (`P:$0D40`).
- It is driven by the `Y:$2F` state machine at `P:$1FD6` (main loop `P:$128`): 1 = fade out and clear `$40000…`, 4 = cleared, 5 = fade in.
- The ARM task `0x08028382` writes 1, polls for 4, then writes 5.
- **Measured:** with the flushes alone the output sounds with `Y:$7FE = 0`. In the listing, `Y:$7FE` scales the effect returns (`P:$0CEA`, `P:$0D1D`), which the oracle does not exercise yet.

## Numbers

`oracle_check.py`: note C4, velocity 100, held; default patch from the RAM dump; 400 blocks = 12,800 frames. Peak and RMS per 1024 frames:

| Frames from | Peak L | Peak R | RMS L (dBFS) | RMS R (dBFS) |
|---|---|---|---|---|
| 0 | 0 | 0 | −∞ | −∞ |
| 1024 | 69,106 | 54,450 | −52.8 | −55.1 |
| 2048 | 397,096 | 294,808 | −33.5 | −36.4 |
| 4096 | 628,668 | 589,233 | −27.2 | −27.8 |
| 8192 | 934,397 | 603,658 | −24.5 | −28.5 |
| 12288 | 877,921 | 459,709 | −27.5 | −29.1 |

- `C1 served 204576 missed 0 … fromY 204576`.
- All four zone commands end at `$800000`.
- `--no-boot`, the old path, stays at 0 throughout.

With only the two flushes, no boot writes, and a supplied 24-level ramp saw, the output is identical in L and R and settles at a peak of about 993,000 (≈ −18.6 dBFS peak).

## Confirmed vs inferred

| Confirmed | Evidence |
|---|---|
| Storage range, frame size, count and order; the zone command words; the boot write order | Emulation of the stock ARM code |
| The dispatcher's command meanings for 0–5; the gain path through `X:$98E`, `Y:$57/$58`, `Y:$7FF` and `X:$DE` | Disassembly |
| The oracle sounds once the flushes run; tables from zone commands 2–5 cover every oscillator read | Measured |

| Inferred | Basis or gap |
|---|---|
| The storage is the external flash | The driver behind vtable +0x1C was not traced |
| Core 1's external X is the same SDRAM as core 0's external Y | The saw reads fall inside zone 2, and the render works with `C1FROMY` |
| The waveform identity of commands 3–5 | Spectra read from the code, not measured |
| The `$12000` offset between the ARM's zone 14 and core 1's `$1B4000` | Unexplained |
| What `Y:$7FE` gates | Read from the listing, not exercised |
| None of this has been compared with the device | — |

## Open

- **L/R imbalance with the boot writes.** With `boot=True`, R is up to about 3–4 dB lower than L on a held note. Without the boot writes L and R are identical.
  - Bisected: the cause is `0x08029710`'s tables (`X:$91`, `X:$98E…`, `X:$9B1…`). The voice-init writes and the `X:$13/$14/$CE`/`Y:$2F` writes are not the cause.
  - Those tables are what the device's ARM computes, so the imbalance may be genuine behaviour of the default patch, for example a per-voice stereo spread.
  - Unexplained; check against a device recording (Track 3).
- The `$12000` offset to core 1's `$1B4000` for wave 14.
- The effect returns (`X:$2EB0/$2EF0`, the reverb and delay) are still zero for a dry patch. Check them with a send level set, and with the `Y:$2F` fade-in (state 5) replayed.

## Next steps

1. Render the swept parameters through `boot=True` (filter frequency, envelope times, portamento), and fit hertz and seconds for `curves.ts` (Track 2a).
2. Dump zones 0–2 and 13 locally (`DUMPY`, to `Firmware-derived/`, never committed). Compare their spectra with the engine's placeholder waves 0–13, and record which wave reads which zone and level.
3. Waves 14–29: no device-free path. They come from Track 3's optional capture (D-7), or stay placeholders.
