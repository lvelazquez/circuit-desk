"""Sweeps the project FX parameters (delay time, sync, feedback, ratio; reverb type, decay, damping) through the stock
ARM code and records which DSP words change. Companion of sweep.py, which does the synth parameters.

Python, not TypeScript, because it drives unicorn through the circuit-hacks-rc clone (dsp_session). It reads your
local copy of the official firmware and writes only ~/Circuit Desk/Firmware-derived/sweep-project-fx.json, which is
never committed. Nothing here touches a device. (Moved from a scratch script, dsp-tools/scratch/delaysync.py.)

    "$CT_HACKS/.venv/bin/python" tools/firmware/sweep_project_fx.py

What one sweep means: for each value, send the NRPN (CC 99 msb, CC 98 lsb, CC 6 value) on channel 16 (the
project channel), then run the ARM's dirty-flush with every group forced dirty, and keep the words written to the
DSP. Only words that take more than one value over the sweep are kept.
"""
from __future__ import annotations
import json, os, sys
from pathlib import Path

HOME = Path.home()
HACKS = Path(os.environ.get("CT_HACKS", HOME / "Personal Repo" / "circuit-hacks-rc"))
os.environ.setdefault("DSPTOOL", str(HOME / "Circuit Desk" / "dsp-tools" / "bin" / "dsptool"))
OUT = Path(os.environ.get("CD_FW_OUT", HOME / "Circuit Desk" / "Firmware-derived"))
sys.path.insert(0, str(HACKS / "tools"))
from dsp_session import Session  # noqa: E402
from unicorn import UC_HOOK_CODE  # noqa: E402
from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0  # noqa: E402

FLUSH = 0x080213B0            # the parameter flush task
DIRTY_CHECK = 0x080297A4      # "is this group dirty?": forced to 1

# (name, NRPN msb, NRPN lsb, values)
PARAMS = (("time", 1, 6, range(0, 128)), ("sync", 1, 7, range(0, 36)), ("feedback", 1, 8, range(0, 128, 16)),
          ("ratio", 1, 10, range(0, 13)), ("revtype", 1, 18, range(0, 6)), ("revdecay", 1, 19, range(0, 128, 16)),
          ("revdamp", 1, 20, range(0, 128, 16)))


def flush_all(s: Session) -> list:
    def h(uc, a, sz, d):
        if a == DIRTY_CHECK:
            uc.reg_write(UC_ARM_REG_R0, 1); uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR) | 1)
    hk = s.e.uc.hook_add(UC_HOOK_CODE, h)
    s.e.call(FLUSH, maxins=50_000_000)
    s.e.uc.hook_del(hk)
    return s._take()


def nrpn(s: Session, msb: int, lsb: int, v: int, ch: int = 15) -> dict[str, int]:
    w = []
    for cc, val in ((99, msb), (98, lsb), (6, v)):
        s.midi(bytes([0xB0 | ch, cc, val])); w += s.events[-1][1]
    w += flush_all(s)
    return {f"{sp}:{a:x}": x for _c, sp, a, x in w}


def main() -> None:
    s = Session((HACKS / "stock" / "circuittracks-firmware-4486-STOCK.bin").read_bytes())
    out = {}
    for name, msb, lsb, rng in PARAMS:
        rows = [nrpn(s, msb, lsb, v) for v in rng]
        keys = sorted({k for r in rows for k in r})
        var = {k: [r.get(k) for r in rows] for k in keys if len({r.get(k) for r in rows}) > 1}
        out[name] = {"values": list(rng), "words": var}
        print(f"{name:<9} {len(rng):>3} values -> {len(var)} varying word(s)  {', '.join(var)}")
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / "sweep-project-fx.json"
    dest.write_text(json.dumps(out))
    print("->", dest)


if __name__ == "__main__":
    main()
