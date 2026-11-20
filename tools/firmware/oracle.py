"""Renders audio from the stock firmware's own DSP core 0, driven by the stock ARM code, with a stand-in for core 1.

Python, not TypeScript, because it drives unicorn and dsptool from the circuit-hacks-rc clone. It reads
your local copy of the official firmware; results go under ~/Circuit Desk/Firmware-derived/ and are
never committed. Analysis of the renders is done in TypeScript (tools/oracle-*.ts).

Core 1 is a copy service (see dsptool-c1.patch): it turns the source addresses core 0 queues into the
words stored there in its external memory. That memory holds the oscillator tables, which are not in
the firmware image, so `tables` supplies them: {address: [24-bit words]}. Addresses nobody supplied read
0 and are counted ("missed").

    from oracle import Oracle
    o = Oracle(tables)
    audio, info = o.render([(0, bytes([0x90, 60, 100])), (300, bytes([0x80, 60, 0]))], blocks=600)

`audio` is a list of signed 24-bit ints, interleaved left/right, 48 kHz (32 frames per block).

`Oracle(tables, boot=True)` adds what the real ARM does at boot and project load, which the plain session
leaves out (see docs/firmware-boot.md):
  * the mixer flush 0x08028EF2 and the settings flush 0x08028FD6 (track levels and pans, master level,
    output level): without them the output ring stays silent;
  * the boot writes of 0x08029710 and 0x0802108C (gain-law tables, voice init), traced by boot_trace.py,
    minus the wavetable frame uploads (the frames come from device storage, which is not available);
  * the zone commands 2-5 run through the DSP's own dispatcher (P:$1C53), so core 0 builds the basic
    waveform tables in its external Y, and core 1's stand-in serves unloaded addresses from there (C1FROMY).
"""
from __future__ import annotations
import os, struct, subprocess, sys, tempfile
from pathlib import Path

HOME = Path.home()
HACKS = Path(os.environ.get("CT_HACKS", HOME / "Personal Repo" / "circuit-hacks-rc"))
TOOL = os.environ.get("DSPTOOL_C1", str(HOME / "Circuit Desk" / "dsp-tools" / "bin" / "dsptool-c1"))
os.environ["DSPTOOL"] = TOOL
sys.path.insert(0, str(HACKS / "tools"))
import dsp_session as D  # noqa: E402

FRAMES_PER_BLOCK = 32
MIXER_FLUSH = 0x08028EF2      # group 0x20: X:$52..$59 track levels/pans, X:$72 master, X:$D1..$DD, ...
SETTINGS_FLUSH = 0x08028FD6   # group 0x21: X:$CF/$D0, Y:$10D..$110, X:$DE output level
ZONE_STUB = 0x7010            # jsr $1C53 ; jset #22,y:$2c,* ; jclr #23,y:$2c,*  (loop until Y:$2C = $800000, "done")
ZONE_STUB_CODE = [0x0BF080, 0x001C53, 0x0A2CF6, ZONE_STUB, 0x0A2CD7, ZONE_STUB]
ZONE_STUB_END = ZONE_STUB + 6


def pack_words(words: list[int]) -> bytes:
    return b"".join(struct.pack(">I", w & 0xFFFFFF)[1:] for w in words)


class Oracle:
    def __init__(self, tables: dict[int, list[int]] | None = None, firmware: Path | None = None, boot: bool = False):
        self.tables = tables or {}
        self.img = (firmware or HACKS / "stock" / "circuittracks-firmware-4486-STOCK.bin").read_bytes()
        self.boot = boot
        self._boot_writes: list[tuple] | None = None

    def session(self) -> D.Session:
        s = D.Session(self.img)
        if self.boot:
            s.capture("mixer", MIXER_FLUSH)
            s.capture("settings", SETTINGS_FLUSH)
        return s

    def boot_script(self) -> tuple[list[str], int]:
        """dsptool lines replaying the boot writes, running each zone command 2-5 to completion; and the zone count."""
        if self._boot_writes is None:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import boot_trace
            self._boot_writes = boot_trace.boot_writes(self.img)
        L = ["P %x %s" % (ZONE_STUB, " ".join("%06x" % x for x in ZONE_STUB_CODE))]
        zones = 0
        for _core, sp, a, v in self._boot_writes:
            if sp == "x" and (0xC00 <= a < 0xD00 or a == 0x12):
                continue                                   # wavetable frame data and SHI mode switches
            if sp == "y" and a == 0x2C:
                if not 2 <= v & 0xF <= 5:
                    continue                               # cmd 0 = a wavetable frame (no data here)
                L += [f"Y 2c {v & 0xFFFFFF:06x}", f"PC {ZONE_STUB:x}", f"STOP {ZONE_STUB_END:x}", "RUN", "DUMPY 2c 1"]
                zones += 1
                continue
            L.append(f"{sp.upper()} {a:x} {v & 0xFFFFFF:06x}")
        return L, zones

    def render(self, timeline: list[tuple[int, bytes]], blocks: int, setup: list[bytes] | None = None,
               sess: D.Session | None = None, log_requests: bool = False,
               dumps: tuple[tuple[str, int, int], ...] = (), watch: tuple[tuple[str, int, int], ...] = (),
               watch_from_block: int = 0) -> tuple[list[int], dict]:
        """Plays `setup` messages before the first block, then each (block, message) of `timeline` at its block.

        Messages go through the stock ARM MIDI handler, so everything a real MIDI message does happens
        here too. Returns (interleaved samples, info).
        """
        s = sess or self.session()
        for m in setup or []:
            s.midi(m)
        pre = len(s.events)
        by_block: dict[int, list[list]] = {}
        for b, m in sorted(timeline, key=lambda x: x[0]):
            s.midi(m)
            by_block.setdefault(b, []).append(s.events[-1][1])
        prog = bytearray(D.dsp_program(self.img))
        for a in D.SPIN_NOPS:
            prog[3 * a:3 * a + 3] = b"\0\0\0"
        work = tempfile.mkdtemp(prefix="cd-oracle-")          # a path without spaces: dsptool reads words, not quoted paths
        try:
            pb, audio_path, log_path = (os.path.join(work, n) for n in ("p.bin", "audio.i32", "req.log"))
            open(pb, "wb").write(prog)
            L = [f"LOADP {pb} 0", "MAX 400000000", "PC 107", "STOP 25f3", "RUN"]
            L += s._mem(s.init_writes) + ["PC 25f3", "STOP 113", "RUN"]
            zones = 0
            if self.boot:
                bl, zones = self.boot_script()
                L += bl + ["C1FROMY ON"]
            for _, w in s.events[:pre]:                 # the initial full parameter dump first, then the setup messages
                L += s._mem(w)
            for i, (base, words) in enumerate(sorted(self.tables.items())):
                tp = os.path.join(work, f"t{i}.bin")
                open(tp, "wb").write(pack_words(words))
                L.append(f"C1LOAD {base:x} {tp}")
            L += ["P %x %s" % (D.STUB, " ".join("%06x" % x for x in [0x0BF080, 0x0001ED, 0x0C0000 | (D.STUB + 2)])),
                  "C1 ON", f"AUDIO {audio_path}"]
            if log_requests:
                L.append(f"C1LOG {log_path}")
            watch_path = os.path.join(work, "watch.log")
            for b in range(blocks):
                if watch and b == watch_from_block:
                    L.append(f"WATCHFILE {watch_path}")
                    L += [f"WATCH {sp.upper()} {a:x} {n}" for sp, a, n in watch]
                for w in by_block.get(b, []):
                    L += s._mem(w)
                L += [f"PC {D.STUB:x}", f"STOP {D.STUB + 2:x}", "RUN", "EMIT"]
                L += [f"DUMP{sp.upper()} {a:x} {n}" for sp, a, n in dumps]
                if log_requests:
                    L.append("C1STAT")
            L.append("C1STAT")
            script = os.path.join(work, "s.txt")
            open(script, "w").write("\n".join(L) + "\n")
            out = subprocess.run([TOOL, "run", script], capture_output=True, text=True).stdout
            raw = open(audio_path, "rb").read()
            audio = list(struct.unpack(f"<{len(raw) // 4}i", raw))
            stats = [l for l in out.splitlines() if l.startswith("C1 served")]
            stat = stats[-1] if stats else ""
            info = {"blocks": blocks, "frames": len(audio) // 2, "c1": stat}
            got_all = [l for l in out.splitlines() if l[:1] in "XYP" and ":" in l]
            if zones:
                info["zone_status"] = [int(l.split(":", 1)[1].split()[0], 16) for l in got_all[:zones]]   # $800000 = done
                got_all = got_all[zones:]
            if watch and os.path.exists(watch_path):
                info["watch"] = [(int(l[0], 16), l[1], l[2], int(l[3], 16)) for l in (x.split() for x in open(watch_path).read().split("\n") if x)]
            if dumps:
                got = [[int(x, 16) for x in l.split(":", 1)[1].split()] for l in got_all]
                per = len(dumps)
                info["dumps"] = [got[i:i + per] for i in range(0, len(got), per)]
            if log_requests and os.path.exists(log_path):
                info["served_per_block"] = [int(l.split()[2]) for l in stats]
                info["c1_stats"] = stats[:4]
                info["requests"] = [int(l.split()[0], 16) for l in open(log_path).read().split("\n") if l]
            return audio, info
        finally:
            for f in Path(work).glob("*"):
                f.unlink()
            os.rmdir(work)
