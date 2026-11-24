// Read-only download of projects from a Circuit Tracks over USB, with Components' own file transfer
// (packages/patch/src/transfer.ts; docs/device-transfer.md). Sends only the read-only requests that
// module builds, checked there in this process and again in the page; anything else throws.
//
//   npm run app:device-transfer -- list [--port circuit] [--yes]
//   npm run app:device-transfer -- get <slot> [<slot>…] [--port circuit] [--yes] [--out dir]
//
// Slots are 1–64 as on the device's project grid. Without --yes it is a dry run: it lists the MIDI
// ports and prints what it would send, and sends nothing. With --yes it lists the device's pack and
// its projects, downloads the slots asked for into ~/Circuit Desk/Device/<timestamp>/ (or --out) as
// NN_<name>.ncs, and checks each opens as a project. --fake replaces Web MIDI with a fake Circuit.
import { app } from "electron";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as N from "@circuit-desk/ncs";
import { blankProject } from "../../packages/ncs/src/testing.ts";
import {
  TRANSFER_KINDS, TRANSFER_PACKET, assembleFile, assertTransferSend, closeSession, dataPacketMessage, hex, listFiles, listPacks, openSession,
  parseDataPacket, parseListedName, parseReadReply, queryCapabilities, queryInfo, readFile, readReplyMessage, transferCommand, type DataPacket,
} from "@circuit-desk/patch";
import { checkOutputFolder, deviceFolder, openDeviceWindow, orExit, pageEval, pickPort, scriptArgs, takeFlag, takeOption, wait } from "./device-window.ts";

const SESSIONS = TRANSFER_KINDS.sessions;

const { yes, fake, match, timeout, outOption, mode, slots } = orExit(() => {
  const args = scriptArgs();
  const yes = takeFlag(args, "--yes"), fake = takeFlag(args, "--fake");
  const match = takeOption(args, "--port") ?? "circuit";
  const timeout = Number(takeOption(args, "--timeout") ?? 10000);
  const outArg = takeOption(args, "--out"), outOption = outArg === undefined ? undefined : checkOutputFolder(outArg);
  const [mode, ...rest] = args;
  if (mode !== "list" && mode !== "get") throw new Error("usage: device-transfer.ts list | get <slot 1–64>…  [--port name] [--yes] [--fake] [--out dir]");
  const slots = rest.map(Number);
  if (mode === "get" && (!slots.length || slots.some((s) => !Number.isInteger(s) || s < 1 || s > 64))) throw new Error("get needs project slots 1–64, as on the device's grid");
  return { yes, fake, match, timeout, outOption, mode, slots };
});

/** A fake Circuit with one pack of two projects (slots 1 and 31), built from a synthetic project. */
function fakeMidi(): string {
  const file = blankProject("Fake Session");
  const reply = (m: Uint8Array): number[][] => {
    const b = [...m], body = b.slice(7, -1), P = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x03];
    if (body[0] === 0x40 || body[0] === 0x41) return [[0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x08, 0x00, 0xf7]];
    if (body[0] === 0x0b && body[1] === 0x01) return [[...P, 0x0b, 0x01, 0x01, 0xf7]];
    if (body[0] === 0x09) return [[...P, 0x09, 0x01, 0x00, 0, 0, 0, 0, 0, 0x06, 0x01, 0x00, 0x0c, 0xf7]];
    if (body[0] === 0x0b && body[1] === 0x02) return [[...P, 0x0b, 0x02, 0x01, 0xf7], [...P, 0x0c, 0x02, 0x00, ...[..."00_Fake"].map((c) => c.charCodeAt(0)), 0xf7]];
    if (body[0] === 0x0b && body[1] === 0x03) return [[...P, 0x0b, 0x03, 0x00, 0x02, 0x00, 0xf7], ...[0, 30].map((i) => [...P, 0x0c, 0x03, 0x00, i, ...[...`${String(i).padStart(2, "0")}_SESSION.ncs`].map((c) => c.charCodeAt(0)), 0xf7])];
    if (body[0] === 0x01) {
      const i = body[11]!;
      if (i !== 0 && i !== 30) return [[...readReplyMessage(SESSIONS, 0, i, null)]];
      const out = [[...readReplyMessage(SESSIONS, 0, i, file.length)]];
      for (let k = 0; k * TRANSFER_PACKET < file.length; k++) out.push([...dataPacketMessage(k + 1, SESSIONS, 0, i, file.subarray(k * TRANSFER_PACKET, (k + 1) * TRANSFER_PACKET))]);
      return out;
    }
    return [];
  };
  // Precompute every reply the plan can ask for, keyed by the request's hex.
  const table: Record<string, number[][]> = {};
  for (const m of [openSession(), closeSession(), queryCapabilities(), queryInfo(), listPacks(), listFiles(0), ...Array.from({ length: 64 }, (_, i) => readFile(SESSIONS, 0, i))]) table[hex(m)] = reply(m);
  return `
    window.__fakeSent = [];
    const table = ${JSON.stringify(table)};
    const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const input = { id: "in", name: "Fake Circuit Tracks", onmidimessage: null };
    const output = { id: "out", name: "Fake Circuit Tracks", send(bytes) {
      window.__fakeSent.push([...bytes]);
      (table[hex(bytes)] || []).forEach((r, k) => setTimeout(() => input.onmidimessage && input.onmidimessage({ data: Uint8Array.from(r), timeStamp: performance.now() }), 10 + k));
    } };
    navigator.requestMIDIAccess = async (o) => ({ inputs: new Map([["in", input]]), outputs: new Map([["out", output]]), sysexEnabled: !!(o && o.sysex), onstatechange: null });`;
}

type Msg = number[];

async function run(): Promise<number> {
  const preview = [openSession(), queryCapabilities(), queryInfo(), listPacks(), listFiles(0), ...slots.map((s) => readFile(SESSIONS, 0, s - 1)), closeSession()];
  console.log(`${fake ? "FAKE MIDI (no device). " : ""}Mode ${mode}${slots.length ? `, slots ${slots.join(", ")}` : ""}; port name containing "${match}".`);
  console.log("Will send (each is a read-only transfer request; the pack index comes from the device's list):");
  for (const m of preview) console.log(`  ${assertTransferSend(m)}: ${hex(m)}`);

  const wc = await openDeviceWindow({ permissions: new Set(["midi", "midiSysex"]), ...(fake ? { preload: fakeMidi() } : {}) });
  const ports = await pageEval<{ inputs: string[]; outputs: string[] } | { error: string }>(wc, `navigator.requestMIDIAccess({ sysex: ${yes} }).then(
    (a) => { window.__access = a; return { inputs: [...a.inputs.values()].map((p) => p.name), outputs: [...a.outputs.values()].map((p) => p.name) }; },
    (e) => ({ error: String(e) }))`);
  if ("error" in ports) { console.log(`Web MIDI refused: ${ports.error}`); return 1; }
  let inName: string, outName: string;
  try { inName = pickPort(ports.inputs, match, "input"); outName = pickPort(ports.outputs, match, "output"); }
  catch (e) { console.log((e as Error).message); return 1; }
  console.log(`Output "${outName}", input "${inName}".`);
  if (!yes) { console.log("Dry run: nothing sent. Add --yes to send the requests above."); return 0; }

  // The page keeps every SysEx reply; its own check refuses anything but the transfer's read requests.
  await pageEval(wc, `(() => {
    const a = window.__access;
    const input = [...a.inputs.values()].find((p) => p.name === ${JSON.stringify(inName)});
    const output = [...a.outputs.values()].find((p) => p.name === ${JSON.stringify(outName)});
    window.__in = [];
    input.onmidimessage = (e) => { if (e.data[0] === 0xf0) window.__in.push([...e.data]); };
    const P = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x03];
    const ok = (b) => b.length >= 9 && b[b.length - 1] === 0xf7 && P.every((x, i) => b[i] === x) && (() => {
      const c = b.slice(7, -1), is = (...x) => c.length === x.length && x.every((v, i) => c[i] === v);
      return is(0x40) || is(0x41) || is(0x0b, 0x01) || is(0x09, 0x01, 0x00) || is(0x0b, 0x02) || (c.length === 3 && c[0] === 0x0b && c[1] === 0x03)
        || (c.length === 13 && c[0] === 0x01 && c.slice(1, 9).every((x) => x === 0) && c[9] === 3 && c[12] === 0x02);
    })();
    window.__send = (bytes) => { if (!ok(bytes)) throw new Error("refused: not a read-only transfer request"); output.send(bytes); };
    return true;
  })()`);

  let seen = 0;
  const send = async (m: Uint8Array): Promise<void> => {
    assertTransferSend(m);
    await pageEval(wc, `window.__send(${JSON.stringify([...m])})`);
  };
  /** Waits until `done` holds over the replies received since the last call; returns them. */
  const until = async (done: (r: Msg[]) => boolean, what: string, ms = timeout): Promise<Msg[]> => {
    for (let t = 0; t < ms; t += 50) {
      const got = await pageEval<Msg[]>(wc, `window.__in.slice(${seen})`);
      if (done(got)) { seen += got.length; return got; }
      await wait(50);
    }
    throw new Error(`no complete answer to ${what} within ${ms} ms`);
  };
  const ack = (r: Msg[]): boolean => r.some((m) => m[6] === 0x08);
  const cmd = (c: number) => (r: Msg[]): Msg | undefined => r.find((m) => transferCommand(m) === c);

  let code = 0;
  await send(openSession());
  await until(ack, "open session");
  try {
    await send(queryCapabilities());
    await until((r) => !!r.find((m) => transferCommand(m) === 0x0b && m[8] === 0x01), "query 0B 01");
    await send(queryInfo());
    await until((r) => !!cmd(0x09)(r), "query 09 01 00");

    await send(listPacks());
    const packs = await until((r) => {
      const head = r.find((m) => transferCommand(m) === 0x0b && m[8] === 0x02);
      return !!head && r.filter((m) => parseListedName(m)?.list === 2).length >= head[9]!;
    }, "list packs");
    const packNames = packs.map(parseListedName).filter((x) => x?.list === 2);
    // The pack the device has loaded is the one Components offers first; with several, the first.
    const pack = packNames[0];
    if (!pack) throw new Error("the device listed no pack");
    console.log(`packs: ${packNames.map((p) => `${p!.index} ${p!.name}`).join(", ")}; using ${pack.name}`);

    await send(listFiles(pack.index));
    const files = await until((r) => {
      const head = r.find((m) => transferCommand(m) === 0x0b && m[8] === 0x03);
      return !!head && r.filter((m) => parseListedName(m)?.list === 3).length >= head[10]! + head[11]! * 128;
    }, "list files");
    const names = files.map(parseListedName).filter((x) => x?.list === 3).map((x) => x!);
    console.log(`projects on the device (slot: file): ${names.map((f) => `${f.index + 1}: ${f.name}`).join(", ")}`);

    if (mode === "get") {
      const dir = outOption ?? (fake ? mkdtempSync(path.join(tmpdir(), "circuit-desk-transfer-fake-")) : deviceFolder());
      mkdirSync(dir, { recursive: true });
      for (const slot of slots) {
        const i = slot - 1;
        if (!names.some((f) => f.index === i)) { console.log(`slot ${slot}: empty on the device (not listed); not requested`); code = 1; continue; }
        await send(readFile(SESSIONS, pack.index, i));
        let size = -1;
        const got = await until((r) => {
          for (const m of r) { const x = parseReadReply(m, SESSIONS, pack.index, i); if (x) size = "size" in x ? x.size : 0; }
          if (size === 0) return true;
          return size > 0 && r.filter((m) => transferCommand(m) === 0x02).length >= Math.ceil(size / TRANSFER_PACKET);
        }, `read slot ${slot}`);
        if (size === 0) { console.log(`slot ${slot}: empty on the device`); code = 1; continue; }
        const packets = got.map(parseDataPacket).filter((p): p is DataPacket => p !== null);
        const file = assembleFile(size, packets, SESSIONS, pack.index, i);
        const p = N.openProject(file);
        const name = N.readSettings(p).name.trim().replace(/[^\w .-]/g, "_") || "Project";
        const out = path.join(dir, `${String(slot).padStart(2, "0")}_${name}.ncs`);
        writeFileSync(out, file);
        console.log(`slot ${slot}: ${size} bytes, "${name}" → ${out}`);
      }
      writeFileSync(path.join(dir, "transfer.json"), JSON.stringify({ kind: "circuit-desk device transfer", version: 1, createdAt: new Date().toISOString(), fake, pack: pack.name, slots, port: outName }, null, 1));
    }
  } catch (e) {
    console.log((e as Error).message);
    code = 1;
  } finally {
    await send(closeSession());
    await until(ack, "close session", 2000).catch(() => console.log("no answer to close session"));
  }
  if (fake) console.log(`fake device received: ${(await pageEval<Msg[]>(wc, "window.__fakeSent")).map((b) => assertTransferSend(b)).join(" | ")}`);
  return code;
}

void app.whenReady().then(() => run()).then((c) => app.exit(c), (e: unknown) => { console.error(e); app.exit(1); });
