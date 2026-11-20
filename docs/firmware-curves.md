# Curves from the firmware (E0.6, Track 2a)

Status 2026-11-20. This step turns the swept DSP words ([`firmware-oracle.md`](firmware-oracle.md)) into hertz and seconds. Everything runs on your own copy of the stock firmware, in emulation; nothing here touches a device. Measurements and fits stay in `~/Circuit Desk/Firmware-derived/`. Only the fitted constants are committed, in `packages/engine/src/nova/curves.ts` and `packages/engine/src/fx/curves.ts` (decision D-10).

## Method

1. **Find the consumer.** dsptool's `WATCH` logs the program counter of every access to a word. That locates the DSP routine that reads each swept word (`P:` addresses below). Reading that routine gives the rule: a linear ramp, an exponential factor, or a log-frequency.
2. **Measure the DSP's own response.** `tools/firmware/measure-curves.py` runs the stock core-0 program through `oracle.py` (Synth 1, note C4, velocity 100, 48 kHz, 32-frame blocks). It works without the silent master mix, because these live parts are enough:
   - the per-synth chain buffer `X:$2DF0` (32 samples per block, after filter, EQ and chorus);
   - the envelope outputs `Y:$130`, `$131` and `$142`;
   - the glide offset `Y:$12F`;
   - the chorus LFO phase `Y:$782`.
3. **Fit.** `tools/firmware/fit-curves.ts` checks each rule against the measurements, fits a few constants, prints them, and writes `curves.json`.

```
cd ~/"Personal Repo"/circuit-hacks-rc && .venv/bin/python ~/"Personal Repo"/circuit-desk/tools/firmware/measure-curves.py   # about 25 min
node tools/firmware/fit-curves.ts
```

## Per-curve status

| Curve | Firmware rule (evidence) | Committed fit | Largest error |
|---|---|---|---|
| Filter frequency | `X:$3E7` = base + v · 0x800000/192, the oscillator pitch unit: **one semitone per step**, the same word from v = 111. Slewed per block at `P:$1B89` into `X:$2E9`; summed with env 2, tracking and the matrix at `P:$6DF`. Hz from the resonant peak of noise at resonance 127; a free fit gives 11.992 steps per octave. | Hz = 1649.6 · 2^((min(v, 111) − 64) / 12), at note 60 | 40 cents (v 16–102; the FFT does not resolve peaks below about 100 Hz, and from 110 up the peak sits at Nyquist) |
| Envelope attack | Rises linearly by word / 2^23 of the peak per block (`P:$4E5`). The words match the measured rise within 0.4 % for all three envelopes. | log2 seconds, piecewise linear through 14 knots | 18 %, RMS 4.5 % (the firmware table repeats values in steps near the top) |
| Envelope release, env 3 decay | Falls by a factor of 1 − word / 2^23 per block (`P:$4E5`, `P:$5D3`). The words match the measured fall within 0.14 %. | as above | release 4.4 %, env 3 decay 9.3 % |
| Env 1/2 decay | A coded rate, linear in the value (`P:$741`), measured on the envelope output. | as above | 3.7 % |
| Envelope index offsets | The ARM takes every envelope's words from shared tables. Exact over the whole sweep: env 1 attack = table(v + 33), env 1 decay = table(v + 47), env 1 release = table(v + 20), env 3 release = table(v − 1). | `ENV_SHIFT` | exact |
| Portamento | `P:$5C0`, per block, on the glide offset (65 536 per semitone): step s (`Y:$15A`) toward the target, zero once within s, then multiply by 1 − `Y:$15B` / 2^23. Replaying this matches the DSP within 691/65 536 of a semitone over 26 000 blocks. Values 0–19 give the same words. | Seconds for an octave glide to settle, log2 piecewise linear through 8 knots | 24 %, RMS 5 % |
| EQ mid frequency | Word `X:$3FE` = v << 16. The centre of the measured level-0 notch moves **linearly in hertz**. | Hz = 516.8 + 13.706 v | 4.1 % |
| EQ treble frequency | Word `X:$3FC` = v << 16. Half-boost frequency at level 127. | Hz = 1157.8 + 20.942 v + 0.06987 v² | 1.1 % |
| Chorus rate | `P:$102E`: per block the phase (2^24 per cycle) advances by (value / 128)² × `X:$997`. `X:$997` = 58 197 comes from a table the ARM writes at boot (routine `0x08029710`); the measured phase step matches within 0.04 %. | Hz = 5.2032 · (v / 128)² (0 … 5.1 Hz) | 0.04 % |
| Chorus sync ladder | The chorus sync branch (`P:$101F`) indexes the boot table at `X:$98E` (35 words; [`firmware-boot.md`](firmware-boot.md) also finds it used as the level law). Its entries have exactly the ratios of the LFO's ladder in `nova/lfo.ts` (1, 1.5, 2 … 768). The chorus now uses that ladder instead of the delay's guessed one. | `CHORUS_SYNC_BEATS = LFO_SYNC_BEATS` | ratios exact; absolute scale assumed |

### Still guesses, and what is missing

- **EQ bass band:** the DSP's bass band is not a shelf. At level 127 it is a +1…+5 dB bump, or a dip at frequency 0; at level 0 it is a steep low cut (−18 to −44 dB at 47 Hz). The routine has not been read.
- **EQ gain (`eqGainDb`):** boosts reach about +11 to +12 dB (mid, treble), but level 0 is a deep notch or low-pass, not −12 dB.
- **Chorus delay, depth and feedback:** the words are value << 16 (`Y:$780`, `$77F`) and 2·(value − 64) << 16 (`Y:$781`). The delay-line code (`P:$105F`) scales them by `X:$9B0` (last entry of the boot table) and was not decoded further.
- **Absolute sync rates:** the sync branch multiplies the table by `X:$15`, a tempo factor that is not set in emulation. The second boot table (`X:$9B1`, 35 words) is the reciprocal ladder (its product with `X:$98E` is 2^33), probably the delay's note lengths; this is not checked.
- **Project delay time and sync, reverb decay and damping:** the master section does not run in the oracle. Reverb decay reaches the DSP as 15/16 · value (`X:$D1`) and damping as the value (`X:$D2`).
- **Not swept:** resonance, env 3 delay, LFO rate (no word moves) and LFO delay.

## Decisions (owner, 2026-11-20)

- **Env 1 attack floor:** keep the firmware's 22 ms. At attack 0 the amp envelope takes 33 blocks to its peak, for every note velocity and env 1 velocity setting (measured). The voice's 2 ms declick floor stays below it.
- **Glide shape:** keep the voice's linear glide, timed by the fitted octave-settle time. The firmware's shape (a fixed step, then exponential) is documented above if it is needed later.

## Effect on the card corpus

Measured with `tools/nova-levels.ts` (1 050 patches, 0.4 s note) and `tools/synth-audit.ts` (298 synth parts), before and after:

| | Before | After |
|---|---|---|
| nova-levels: silent (< 0.001) | 0 | 2 (Starlight ×2: a pad whose oscillator levels come from env 2/3 attacks of 127 and 113, now 22 s and about 8 s) |
| nova-levels: p10 / median / p90 / p99 / max | 0.139 / 0.407 / 1.107 / 2.912 / 4.352 | 0.046 / 0.411 / 1.149 / 2.829 / 4.707 |
| nova-levels: above 1.0 | 145 | 146 |
| synth-audit: ok / over full scale / quiet / very quiet | 191 / 92 / 12 / 3 | 185 / 93 / 17 / 3 |
| synth-audit: peak median | −4.3 dBFS | −2.7 dBFS |

The new quiet parts come from the attack curve: with only the attack set back to the old guess, quiet drops to 9 (and over full scale rises to 123). For example, "Daylights" (env 1 attack 0, now 22 ms) is −25 dB with the new attack and 0 dB with the old one. `VOICE_GAIN` was not changed. A device recording (Track 3) should confirm the 22 ms floor before anything is tuned around it.
