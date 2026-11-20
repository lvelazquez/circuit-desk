"""Sweeps every Synth parameter through the stock firmware's own ARM code and records which DSP words change.

Python, not TypeScript, because the emulators it drives (unicorn + dsptool, from the circuit-hacks-rc
clone) are Python. It reads your local copy of the official firmware and writes only under
~/Circuit Desk/Firmware-derived/, which is never committed.

    .venv/bin/python <this file> [--synth 0|1] [--only filter.frequency,env1.attack]

Environment (all optional; defaults shown):
    CT_HACKS   ~/Personal Repo/circuit-hacks-rc          the clone with tools/ and stock/
    DSPTOOL    ~/Circuit Desk/dsp-tools/bin/dsptool       the built DSP emulator
    CD_FW_OUT  ~/Circuit Desk/Firmware-derived            where results go
Input: params.json from `node tools/export-params.ts` in the same output folder.

What one sweep means: for parameter p and each value v in p.min..p.max, send the CC (or the NRPN:
CC 99 msb, CC 98 lsb, CC 6 value) on the synth's channel and run the ARM's dirty-flush ("set"
writes), then play and release one note, C4 at velocity 100 ("on" writes). Both are captured as
writes to the DSP. Repeated notes write identical addresses (checked), so values can be compared
across the sweep. Only words that take more than one value over the sweep are kept: they are the
parameter's coefficients, in the DSP's own units.
"""
from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path

HOME = Path.home()
HACKS = Path(os.environ.get("CT_HACKS", HOME / "Personal Repo" / "circuit-hacks-rc"))
os.environ.setdefault("DSPTOOL", str(HOME / "Circuit Desk" / "dsp-tools" / "bin" / "dsptool"))
OUT = Path(os.environ.get("CD_FW_OUT", HOME / "Circuit Desk" / "Firmware-derived"))
sys.path.insert(0, str(HACKS / "tools"))
from dsp_session import Session  # noqa: E402


def send(s: Session, ch: int, cc: int, v: int) -> list:
    s.midi(bytes([0xB0 | ch, cc, v]))
    return s.events[-1][1]


def sweep_param(s: Session, ch: int, p: dict) -> dict:
    """Per value: the words written when the parameter is set ("set") and when a note then starts ("on")."""
    values = list(range(p["min"], p["max"] + 1))
    per_value: list[dict[str, int]] = []
    for v in values:
        words: dict[str, int] = {}
        if p["cc"] is not None:
            writes = send(s, ch, p["cc"], v)
        else:
            msb, lsb = p["nrpn"]
            writes = send(s, ch, 99, msb) + send(s, ch, 98, lsb) + send(s, ch, 6, v)
        for _core, space, addr, val in writes:
            words[f"set:{space}:{addr:x}"] = val
        s.midi(bytes([0x90 | ch, 60, 100]))
        for _core, space, addr, val in s.events[-1][1]:
            words[f"on:{space}:{addr:x}"] = val
        s.midi(bytes([0x80 | ch, 60, 0]))
        per_value.append(words)
    keys = sorted({k for w in per_value for k in w})
    varying = {k: [w.get(k) for w in per_value] for k in keys if len({w.get(k) for w in per_value}) > 1}
    return {"id": p["id"], "cc": p["cc"], "nrpn": p["nrpn"], "values": values, "words": varying}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--synth", type=int, default=0, choices=(0, 1))
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    params = json.loads((OUT / "params.json").read_text())
    only = set(filter(None, a.only.split(",")))
    if only:
        params = [p for p in params if p["id"] in only]
    stock = HACKS / "stock" / "circuittracks-firmware-4486-STOCK.bin"
    s = Session(stock.read_bytes())
    t0 = time.time()
    rows = []
    for p in params:
        if p["cc"] is None and p["nrpn"] is None:
            continue
        r = sweep_param(s, a.synth, p)
        rows.append(r)
        print(f"{p['id']:<34} {len(r['values']):>3} values -> {len(r['words'])} varying word(s)  {', '.join(sorted(r['words']))}", flush=True)
    dest = OUT / ("sweep-synth%d%s.json" % (a.synth + 1, "-partial" if only else ""))
    dest.write_text(json.dumps(rows))
    print(f"{len(rows)} parameters in {time.time() - t0:.0f} s -> {dest}")


if __name__ == "__main__":
    main()
