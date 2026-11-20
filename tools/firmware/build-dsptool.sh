#!/usr/bin/env bash
# Builds the DSP emulator with the Circuit Desk core-1 stub into ~/Circuit Desk/dsp-tools/bin/dsptool-c1.
# Needs: git, clang++, and cmake + ninja on PATH (pip install cmake ninja into a venv is enough).
# Sources are fetched from their original repositories at the revision circuit-hacks-rc pins; nothing
# third-party is stored here. The three patches in this folder / circuit-hacks-rc/tools/dsptool are applied.
set -euo pipefail
HACKS="${CT_HACKS:-$HOME/Personal Repo/circuit-hacks-rc}"
HERE="$(cd "$(dirname "$0")" && pwd)"
T="${CD_DSP_TOOLS:-$HOME/Circuit Desk/dsp-tools}"
REV=44353be2f0156cac970c6ab4f467ea1998b40605
mkdir -p "$T/bin" "$T/src"
[ -d "$T/dsp56300" ] || git clone -q https://github.com/dsp56300/dsp56300 "$T/dsp56300"
cd "$T/dsp56300"
git checkout -q "$REV"
git submodule update --init source/asmjit
for p in "$HACKS/tools/dsptool/dsp56kEmu-memtrace.patch" "$HERE/dsp56kEmu-c1hook.patch"; do
  if git apply --check --ignore-whitespace "$p" 2>/dev/null; then git apply --ignore-whitespace "$p"; else echo "(already applied: $(basename "$p"))"; fi
done
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build --target dsp56kEmu -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cp "$HACKS/tools/dsptool/dsptool.cpp" "$T/src/dsptool.c1.cpp"
(cd "$T/src" && patch -p3 dsptool.c1.cpp < "$HERE/dsptool-c1.patch")
# libvtuneSdk is Intel-only and not needed on macOS
clang++ -O2 -std=c++17 -Isource -Isource/asmjit/src "$T/src/dsptool.c1.cpp" \
  build/source/dsp56kEmu/libdsp56kEmu.a build/source/dsp56kBase/libdsp56kBase.a build/source/asmjit/libasmjit.a \
  -lpthread -ldl -o "$T/bin/dsptool-c1"
echo "built $T/bin/dsptool-c1"
