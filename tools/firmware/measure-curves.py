"""Measures what the stock DSP does with the swept words, by running the stock core-0 program (no audio output needed).

Python, not TypeScript, because it drives unicorn and dsptool from the circuit-hacks-rc clone (like sweep.py and
oracle.py). It reads your local copy of the official firmware and writes raw measurements to
~/Circuit Desk/Firmware-derived/dsp-measure.json, which is never committed. tools/firmware/fit-curves.ts turns them
into fitted formulas.

What is measured (Synth 1, note C4 at velocity 100, 48 kHz, 32-frame blocks):

- filter: the noise source alone (oscillators off) through the filter with resonance at 127; the per-synth chain
  buffer X:$2DF0 (32 samples per block) is saved for the settled blocks. The resonant peak is the cut-off.
- eq: the same buffer with the filter open, for each band's frequency with that band's level at 0 and at 127,
  plus a flat reference.
- env: the envelope values themselves, one word per block: envelope 1 Y:$130, envelope 2 Y:$131,
  envelope 3 Y:$142 (found by watching which slot each envelope's attack moves).
- glide: the glide offset Y:$12F (65 536 per semitone) for an octave step with portamento on.
- chorus: the chorus LFO phase Y:$782 per block, after replaying the ARM boot routine 0x08029710, which
  writes the X:$98E / X:$9B1 tables the rate code reads (the plain session never runs it, so they read 0).

    cd ~/"Personal Repo"/circuit-hacks-rc && .venv/bin/python ~/"Personal Repo"/circuit-desk/tools/firmware/measure-curves.py [--quick | --chorus-only]

--chorus-only adds the chorus part to an existing dsp-measure.json.
"""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import Oracle  # noqa: E402

OUT = Path.home() / "Circuit Desk" / "Firmware-derived" / "dsp-measure.json"
CHAIN = 0x2DF0           # per-synth chain buffer after the filter, EQ and chorus (32 samples per block)
ENV_SLOT = {1: 0x130, 2: 0x131, 3: 0x142}
GLIDE_SLOT = 0x12F
NOTE_ON = bytes([0x90, 60, 100])


def sg(v: int) -> int:
    return v - (1 << 24) if v >= 1 << 23 else v


def cc(n: int, v: int) -> bytes:
    return bytes([0xB0, n, v])


def nrpn(msb: int, lsb: int, v: int) -> list[bytes]:
    return [cc(99, msb), cc(98, lsb), cc(6, v)]


NOISE_ONLY = [cc(51, 0), cc(52, 0), cc(56, 127)]          # oscillator levels off, noise full


class M:
    def __init__(self) -> None:
        self.o = Oracle({0x100000: [0] * 0x8000})

    def chain(self, setup: list[bytes], blocks: int, keep_from: int) -> list[int]:
        _, info = self.o.render([], blocks=blocks, setup=setup + [NOTE_ON], dumps=(("x", CHAIN, 32),))
        return [sg(v) for b in info["dumps"][keep_from:] for v in b[0]]

    def slot(self, setup: list[bytes], blocks: int, addr: int, timeline: list[tuple[int, bytes]] = (),
             note: bytes | None = NOTE_ON) -> list[int]:
        _, info = self.o.render(list(timeline), blocks=blocks, setup=setup + ([note] if note else []),
                                dumps=(("y", addr, 1),))
        return [sg(b[0][0]) for b in info["dumps"]]


ENV_CTRL = {   # env: (attack, decay, sustain, release) setters
    1: (lambda v: [cc(73, v)], lambda v: [cc(75, v)], lambda v: [cc(70, v)], lambda v: [cc(72, v)]),
    2: (lambda v: nrpn(0, 1, v), lambda v: nrpn(0, 2, v), lambda v: nrpn(0, 3, v), lambda v: nrpn(0, 4, v)),
    3: (lambda v: nrpn(0, 15, v), lambda v: nrpn(0, 16, v), lambda v: nrpn(0, 17, v), lambda v: nrpn(0, 18, v)),
}


BOOT_TABLES = 0x08029710   # ARM boot routine that writes X:$98E.. and X:$9B1.. (35 words each)


def measure_chorus(m: M) -> list[dict]:
    """Chorus LFO phase increment per block, by rate value (chorus level 64, free running)."""
    rows = []
    for v in sorted(set(list(range(0, 128, 16)) + [127])):
        s = m.o.session()
        s.e.call(BOOT_TABLES, maxins=50_000_000)
        s.events.append(("boot tables", s._take()))
        setup = [cc(93, 64)] + nrpn(1, 25, v) + [NOTE_ON]
        _, info = m.o.render([], blocks=300, setup=setup, sess=s, dumps=(("y", 0x782, 1), ("x", 0x997, 1)))
        ph = [b[0][0] for b in info["dumps"]]
        incs = sorted((ph[i + 1] - ph[i]) & 0xFFFFFF for i in range(100, 299))
        rows.append({"value": v, "incPerBlock": incs[len(incs) // 2], "x997": info["dumps"][-1][1][0]})
    return rows


def main() -> None:
    m = M()
    if "--chorus-only" in sys.argv:
        out = json.loads(OUT.read_text())
        out["chorus"] = measure_chorus(m)
        OUT.write_text(json.dumps(out))
        print("added chorus to", OUT)
        return
    quick = "--quick" in sys.argv
    step = 8 if quick else 2
    out: dict = {"sampleRate": 48000, "framesPerBlock": 32, "note": 60, "velocity": 100}
    t0 = time.time()

    # Filter: resonant peak of filtered noise.
    filt = []
    for v in sorted(set(list(range(0, 128, step)) + [127])):
        x = m.chain(NOISE_ONLY + [cc(71, 127), cc(74, v)], 2000, 1000)
        filt.append({"value": v, "samples": x})
        print(f"filter {v}", round(time.time() - t0, 1), flush=True)
    out["filter"] = filt

    # EQ: each band's frequency with its level at 127 against level 64, filter open.
    open_f = NOISE_ONLY + [cc(71, 0), cc(74, 127)]
    eq = {"reference": m.chain(open_f, 1600, 800), "bands": []}
    for band, (fl, ll) in {"bass": (104, 105), "mid": (106, 107), "treble": (108, 109)}.items():
        for v in sorted(set(list(range(0, 128, 16 if quick else 8)) + [127])):
            for lv in (0, 127):
                x = m.chain(open_f + nrpn(0, fl, v) + nrpn(0, ll, lv), 1600, 800)
                eq["bands"].append({"band": band, "frequency": v, "level": lv, "samples": x})
        print(f"eq {band}", round(time.time() - t0, 1), flush=True)
    out["eq"] = eq

    # Envelopes: attack increments, decay toward sustain 0, release from sustain 127.
    env: dict = {}
    for e, (atk, dec, sus, rel) in ENV_CTRL.items():
        a = ENV_SLOT[e]
        rec: dict = {"attack": [], "decay": [], "release": []}
        for v in sorted(set(list(range(0, 128, step * 2)) + [127])):
            rec["attack"].append({"value": v, "trace": m.slot(atk(v) + sus(127), 40, a)})
        for v in sorted(set(list(range(0, 128, step)) + [127])):
            rec["decay"].append({"value": v, "trace": m.slot(atk(0) + sus(0) + dec(v), 2500, a)})
            rec["release"].append({"value": v, "trace": m.slot(atk(0) + dec(0) + sus(127) + rel(v), 2560, a,
                                                              timeline=[(60, bytes([0x80, 60, 0]))])})
        env[str(e)] = rec
        print(f"env {e}", round(time.time() - t0, 1), flush=True)
    out["env"] = env

    # Glide: C3 then C4, portamento on; offset per block.
    glide = []
    for v in sorted(set(list(range(0, 128, step * 2)) + [127])):
        tr = m.slot([cc(5, v)], 1200, GLIDE_SLOT, timeline=[(0, bytes([0x90, 48, 100])), (400, bytes([0x90, 60, 100]))], note=None)
        glide.append({"value": v, "trace": tr[400:]})
    out["glide"] = glide
    print("glide", round(time.time() - t0, 1), flush=True)

    out["chorus"] = measure_chorus(m)
    print("chorus", round(time.time() - t0, 1), flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
