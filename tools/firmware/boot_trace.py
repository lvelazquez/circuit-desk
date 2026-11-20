"""Traces the stock ARM's DSP boot setup in unicorn: 0x08029710 (gain-law tables) then 0x0802108C (which calls the
zone/wavetable loader 0x08035E28, then initialises the 12 voices and the master fade).

Python, not TypeScript, because it drives unicorn through the circuit-hacks-rc clone's ARM helpers (emu_sc05,
shi_capture). It reads your local copy of the official firmware and prints only addresses, lengths and the
host-interface words the ARM sends; it never writes firmware bytes anywhere. Nothing here touches a device.

    .venv/bin/python <this file> [--json OUT]      (run with circuit-hacks-rc's venv)

What is stubbed, and why:
  * DSP reads (0x08029344): the boot code polls Y:$2C until it reads $800000 ("command done") and Y:$2B until
    non-zero ("DSP ready"); here every read returns $800000 at once, and each poll is logged.
  * The storage read 0x08047C6C(src, dst, len) (a virtual call, vtable +0xC, on the object at [0x20006968]):
    logged, and dst is filled with zeros, so no stored table data is ever read or kept.
  * The bulk DSP write 0x0803BA78(buf, len) (DMA, so the SPI hook in shi_capture never sees it): its bytes are fed
    to the SHI decoder as data words, so the decoded writes include the frame uploads.

Output: the ordered list of DSP core-0 writes (space, address, value), with the storage reads and polls
interleaved, and a summary. `boot_writes(img)` returns the core-0 writes for the oracle (oracle.py --boot).
"""
from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path

HOME = Path.home()
HACKS = Path(os.environ.get("CT_HACKS", HOME / "Personal Repo" / "circuit-hacks-rc"))
sys.path.insert(0, str(HACKS / "tools"))
from unicorn import UC_HOOK_CODE  # noqa: E402
from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2  # noqa: E402
from emu_sc05 import E  # noqa: E402
from shi_capture import attach  # noqa: E402

GAIN_TABLES = 0x08029710     # called at boot from 0x0801F572: X:$91, then 35 words to X:$98E.. and 35 to X:$9B1..
BOOT_SETUP = 0x0802108C      # called next (0x0801F576): zones, voices, X:$13/$14, X:$CE, Y:$2F
BOOT = (GAIN_TABLES, BOOT_SETUP)  # what the ARM runs after 0x08029260 (program upload + 0x08029492, which dsp_session already runs)
ZONE_LOADER = 0x08035E28     # called from 0x080210BE
DSP_READ = 0x08029344        # (core, addr16) -> word << 8
STORAGE_READ = 0x08047C6C    # (src, dst, len) -> obj->vtable[3](obj, src, dst, len)
BULK_WRITE = 0x0803BA78      # (buf, nbytes): DMA to the selected DSP


def trace(img: bytes, fns: tuple[int, ...] = BOOT) -> dict:
    e = E(img)
    e.stubs[0x0801B394] = "delay"
    shi = attach(e)
    log: list[tuple] = []

    def mark(kind: str, *vals):
        shi.writes.append(("mark", kind) + vals)

    def h(uc, a, sz, d):
        if a == DSP_READ:
            r0, r1 = uc.reg_read(UC_ARM_REG_R0), uc.reg_read(UC_ARM_REG_R1)
            mark("read", r0, r1)
            uc.reg_write(UC_ARM_REG_R0, 0x80000000)
        elif a == STORAGE_READ:
            src, dst, n = (uc.reg_read(r) for r in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2))
            mark("storage", src, dst, n)
            uc.mem_write(dst, bytes(n))
        elif a == BULK_WRITE:
            buf, n = uc.reg_read(UC_ARM_REG_R0), uc.reg_read(UC_ARM_REG_R1)
            mark("bulk", buf, n, shi.st[shi.core]["x10"], shi.st[shi.core]["x11"])
            b = bytes(uc.mem_read(buf, n))
            for i in range(0, n - 2, 3):
                shi.word(int.from_bytes(b[i:i + 3], "big"))
        else:
            return
        uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR) | 1)

    e.uc.hook_add(UC_HOOK_CODE, h)
    zone_calls = []
    e.uc.hook_add(UC_HOOK_CODE, lambda uc, a, s, d: zone_calls.append(len(shi.writes)) if a == ZONE_LOADER else None)
    for fn in fns:
        mark("call", fn)
        e.call(fn, maxins=200_000_000)
    return {"events": list(shi.writes), "zone_loader_at": zone_calls}


def boot_writes(img: bytes, fns: tuple[int, ...] = BOOT) -> list[tuple]:
    """Core-0 writes (core, space, addr, value) in order, as dsp_session's events use them; marks dropped."""
    return [w for w in trace(img, fns)["events"] if w[0] == 0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    ap.add_argument("--fn", default=",".join(hex(f) for f in BOOT), help="comma-separated ARM functions, run in order")
    ap.add_argument("--quiet", action="store_true", help="summary only")
    a = ap.parse_args()
    img = (HACKS / "stock" / "circuittracks-firmware-4486-STOCK.bin").read_bytes()
    t = trace(img, tuple(int(f, 16) for f in a.fn.split(",")))
    ev = t["events"]
    storage = [x for x in ev if x[0] == "mark" and x[1] == "storage"]
    bulk = [x for x in ev if x[0] == "mark" and x[1] == "bulk"]
    if not a.quiet:
        run_start, run = None, 0
        for i, x in enumerate(ev):
            if x[0] == "mark":
                print(f"{i:5}  {x[1]:<8} " + " ".join(f"{v:#x}" for v in x[2:]))
            elif x[0] == 0 and not (x[1] == "x" and 0xC00 <= x[2] < 0xD00):       # frame data words: summarised by "bulk"
                print(f"{i:5}  core{x[0]} {x[1].upper()}:${x[2]:X} = ${x[3] & 0xFFFFFF:06X}")
            elif x[0] == 1:
                print(f"{i:5}  core1 {x[1].upper()}:${x[2]:X} = ${x[3] & 0xFFFFFF:06X}")
    srcs = [s[2] for s in storage]
    print(f"\nzone loader entered at event(s) {t['zone_loader_at']}")
    print(f"storage reads: {len(storage)}; lengths {sorted({s[4] for s in storage})}; dst {sorted({hex(s[3]) for s in storage})}")
    if srcs:
        print(f"  source range {min(srcs):#x} .. {max(srcs) + storage[-1][4]:#x} ({max(srcs) + storage[-1][4] - min(srcs)} bytes)")
    print(f"bulk writes: {len(bulk)}; byte lengths {sorted({b[3] for b in bulk})}; DSP address at start {sorted({hex(b[4]) for b in bulk})}")
    c0 = [x for x in ev if x[0] == 0]
    print(f"core-0 writes: {len(c0)}; core-1 writes: {sum(1 for x in ev if x[0] == 1)}")
    if a.json:
        Path(a.json).write_text(json.dumps({"events": [list(x) for x in ev if x[0] == "mark" or not (x[1] == "x" and 0xC00 <= x[2] < 0xD00)]}))


if __name__ == "__main__":
    main()
