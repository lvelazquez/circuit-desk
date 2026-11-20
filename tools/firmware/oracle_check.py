"""Reproducible oracle check: renders one Synth 1 note with Oracle(boot=True) and no supplied tables, and prints
peak and RMS of the output ring per 1024 frames.

Python, not TypeScript, because it drives oracle.py (unicorn + dsptool from the circuit-hacks-rc clone). It reads
your local copy of the official firmware and prints only levels and counters; it writes nothing unless --wav is
given, and then only under ~/Circuit Desk/Firmware-derived/ (never committed). Nothing here touches a device.

    "$CT_HACKS/.venv/bin/python" tools/firmware/oracle_check.py [--blocks 400] [--note 60] [--off 300]
        [--no-boot] [--wav name.wav]

With boot=True the oscillator's tables are the ones the stock DSP builds itself from the boot zone commands
(zones 0-2 and 13 in its external Y, served to core 1's stand-in by C1FROMY), so the default patch's saw sounds
without any table being supplied. --no-boot shows the old, silent oracle for comparison.
"""
from __future__ import annotations
import argparse, math, os, struct, sys, wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from oracle import Oracle, FRAMES_PER_BLOCK  # noqa: E402

OUT = Path(os.environ.get("CD_FW_OUT", Path.home() / "Circuit Desk" / "Firmware-derived"))
FULL = 1 << 23


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks", type=int, default=400)
    ap.add_argument("--note", type=int, default=60)
    ap.add_argument("--velocity", type=int, default=100)
    ap.add_argument("--off", type=int, default=0, help="block of the note-off (0 = held)")
    ap.add_argument("--no-boot", action="store_true")
    ap.add_argument("--wav", default="")
    a = ap.parse_args()
    o = Oracle(boot=not a.no_boot)
    timeline = [(0, bytes([0x90, a.note, a.velocity]))]
    if a.off:
        timeline.append((a.off, bytes([0x80, a.note, 0])))
    audio, info = o.render(timeline, blocks=a.blocks)
    print(info["c1"])
    if "zone_status" in info:
        print("zone commands done:", ["%06x" % z for z in info["zone_status"]], "($800000 = done)")
    L, R = audio[0::2], audio[1::2]
    print(f"{len(L)} frames ({len(L) / 48000:.2f} s), {a.blocks} blocks of {FRAMES_PER_BLOCK}")
    print(" frames        peakL     peakR    rmsL dBFS  rmsR dBFS")
    for i in range(0, len(L), 1024):
        l, r = L[i:i + 1024], R[i:i + 1024]
        rms = [math.sqrt(sum(v * v for v in c) / len(c)) for c in (l, r)]
        db = ["%9.1f" % (20 * math.log10(x / FULL)) if x else "     -inf" for x in rms]
        print(f"{i:6}  {max(map(abs, l)):9}  {max(map(abs, r)):9}  {db[0]}  {db[1]}")
    if a.wav:
        OUT.mkdir(parents=True, exist_ok=True)
        dest = OUT / a.wav
        with wave.open(str(dest), "wb") as w:
            w.setnchannels(2); w.setsampwidth(3); w.setframerate(48000)
            w.writeframes(b"".join(struct.pack("<i", v)[:3] for v in audio))
        print("->", dest)


if __name__ == "__main__":
    main()
