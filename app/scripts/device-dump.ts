// Read-only device check (plan Track 3, D-8; docs/device-session.md). Sends only the messages on the
// allowlist in packages/patch/src/device.ts (the two current-patch dump requests and the fwid query):
// every send is checked there, in this process, and again in the page; anything else throws.
//
//   npm run app:device-dump -- fwid [--port circuit] [--yes]
//   npm run app:device-dump -- dump <project.ncs> [--port circuit] [--timeout 3000] [--yes]
//
// Without --yes it is a dry run: it lists the MIDI ports and prints the bytes it would send, and sends
// nothing. With --yes it sends them, waits for the answers, compares Synth 1 and 2 with the project
// file's patches, and saves the raw answers and a summary.json to ~/Circuit Desk/Device/<timestamp>/.
// --fake replaces Web MIDI with a fake Circuit (no device is opened) and writes to a temporary folder;
// --out <dir> chooses the folder. Exit code: 0 answered and identical, 1 no answer, 2 a patch differs.
import { app } from "electron";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ALLOWED_DEVICE_MESSAGES, FWID_QUERY, FWID_SEQ, assertAllowedSend, comparePatches, describeDifferences, dumpRequestMessage, hex,
  parseFwidReply, parsePatchMessage, projectPatch, replaceCurrentPatchMessage, COMMAND_REPLACE_CURRENT, type Location,
} from "@circuit-desk/patch";
import { checkOutputFolder, deviceFolder, openDeviceWindow, pageEval, orExit, pickPort, scriptArgs, takeFlag, takeOption, wait } from "./device-window.ts";

// Arguments, the project file and the messages are checked before any window or port is opened.
const { yes, fake, match, timeout, outOption, mode, projectFile, filePatches, plan } = orExit(() => {
  const args = scriptArgs();
  const yes = takeFlag(args, "--yes"), fake = takeFlag(args, "--fake");
  const match = takeOption(args, "--port") ?? "circuit";
  const timeout = Number(takeOption(args, "--timeout") ?? 3000);
  const outArg = takeOption(args, "--out"), outOption = outArg === undefined ? undefined : checkOutputFolder(outArg);
  const [mode, projectFile] = args;
  if (mode !== "fwid" && mode !== "dump") throw new Error("usage: device-dump.ts fwid | dump <project.ncs>  [--port name] [--timeout ms] [--yes] [--fake] [--out dir]");
  if (mode === "dump" && !projectFile) throw new Error("dump needs the project file the device has loaded: device-dump.ts dump <project.ncs>");

  // The project (read only) and what will be sent, checked before any port is opened.
  const file = projectFile ? new Uint8Array(readFileSync(projectFile)) : null;
  const filePatches = file ? ([0, 1] as const).map((s) => projectPatch(file, s)) : null;
  const plan: { label: string; bytes: number[]; location?: Location }[] = mode === "fwid"
    ? [{ label: "fwid query", bytes: [...FWID_QUERY] }]
    : ([0, 1] as const).map((l) => ({ label: `dump request Synth ${l + 1}`, bytes: [...dumpRequestMessage(l)], location: l }));
  for (const m of plan) assertAllowedSend(m.bytes);
  return { yes, fake, match, timeout, outOption, mode, projectFile, filePatches, plan };
});

/** A fake Circuit: answers each dump request with the project's patch (Synth 2 with one byte changed, to show a difference) and fwid with "FAKE". */
function fakeMidi(): string {
  const replies: Record<string, number[]> = { [hex(FWID_QUERY)]: [0xf0, 0x7d, 0x43, 0x54, 0x40, FWID_SEQ, 0x01, 0x46, 0x41, 0x4b, 0x45, 0, 0, 0xf7] };
  if (filePatches) {
    const s2 = filePatches[1]!.slice();
    s2[100] = (s2[100]! + 1) & 0x7f;
    replies[hex(dumpRequestMessage(0))] = [...replaceCurrentPatchMessage(filePatches[0]!, 0)];
    replies[hex(dumpRequestMessage(1))] = [...replaceCurrentPatchMessage(s2, 1)];
  }
  return `
    window.__fakeSent = [];
    const replies = ${JSON.stringify(replies)};
    const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const input = { id: "in", name: "Fake Circuit Tracks", onmidimessage: null };
    const output = { id: "out", name: "Fake Circuit Tracks", send(bytes) {
      window.__fakeSent.push([...bytes]);
      const r = replies[hex(bytes)];
      if (r) setTimeout(() => input.onmidimessage && input.onmidimessage({ data: Uint8Array.from(r), timeStamp: performance.now() }), 30);
    } };
    navigator.requestMIDIAccess = async (o) => ({ inputs: new Map([["in", input]]), outputs: new Map([["out", output]]), sysexEnabled: !!(o && o.sysex), onstatechange: null });`;
}

async function run(): Promise<number> {
  console.log(`${fake ? "FAKE MIDI (no device). " : ""}Mode ${mode}${projectFile ? ` against ${projectFile}` : ""}; port name containing "${match}".`);
  console.log("Will send, in this order (each is on the read-only allowlist):");
  for (const m of plan) console.log(`  ${m.label}: ${hex(m.bytes)}`);

  const wc = await openDeviceWindow({ permissions: new Set(["midi", "midiSysex"]), ...(fake ? { preload: fakeMidi() } : {}) });
  // SysEx is requested only when sending: a dry run asks for plain Web MIDI, to list the ports.
  const ports = await pageEval<{ inputs: string[]; outputs: string[] } | { error: string }>(wc, `navigator.requestMIDIAccess({ sysex: ${yes} }).then(
    (a) => { window.__access = a; return { inputs: [...a.inputs.values()].map((p) => p.name), outputs: [...a.outputs.values()].map((p) => p.name) }; },
    (e) => ({ error: String(e) }))`);
  if ("error" in ports) { console.log(`Web MIDI refused: ${ports.error}`); return 1; }
  console.log(`MIDI inputs: ${ports.inputs.join(", ") || "none"}\nMIDI outputs: ${ports.outputs.join(", ") || "none"}`);
  let inName: string, outName: string;
  try { inName = pickPort(ports.inputs, match, "input"); outName = pickPort(ports.outputs, match, "output"); }
  catch (e) { console.log((e as Error).message); return 1; }
  console.log(`Would use output "${outName}" and input "${inName}".`);
  if (!yes) { console.log("Dry run: nothing sent. Add --yes to send the messages above."); return 0; }

  await pageEval(wc, `(() => {
    const a = window.__access, allowed = ${JSON.stringify(ALLOWED_DEVICE_MESSAGES.map((m) => m.bytes))};
    const input = [...a.inputs.values()].find((p) => p.name === ${JSON.stringify(inName)});
    const output = [...a.outputs.values()].find((p) => p.name === ${JSON.stringify(outName)});
    window.__in = [];
    input.onmidimessage = (e) => { if (e.data[0] === 0xf0) window.__in.push([...e.data]); };
    // The page's own copy of the allowlist: the last check before the port.
    window.__send = (bytes) => {
      if (!allowed.some((m) => m.length === bytes.length && m.every((b, i) => b === bytes[i]))) throw new Error("refused: not on the device allowlist");
      output.send(bytes);
    };
    return true;
  })()`);

  const replies: { label: string; sent: string; reply: number[] | null }[] = [];
  for (const m of plan) {
    assertAllowedSend(m.bytes);
    await pageEval(wc, `window.__in = []; window.__send(${JSON.stringify(m.bytes)})`);
    console.log(`sent ${m.label}`);
    const want = (r: number[]): boolean => mode === "fwid"
      ? parseFwidReply(r)?.seq === FWID_SEQ
      : (() => { const p = parsePatchMessage(Uint8Array.from(r)); return !!p && p.command === COMMAND_REPLACE_CURRENT && p.slot === m.location; })();
    let reply: number[] | null = null;
    for (let t = 0; t < timeout && !reply; t += 50) {
      const got = await pageEval<number[][]>(wc, "window.__in");
      reply = got.find(want) ?? null;
      if (!reply) await wait(50);
    }
    console.log(reply ? `  answer: ${reply.length} bytes` : `  no answer within ${timeout} ms`);
    replies.push({ label: m.label, sent: hex(m.bytes), reply });
  }

  const dir = outOption ? checkOutputFolder(outOption) : fake ? mkdtempSync(path.join(tmpdir(), "circuit-desk-device-fake-")) : deviceFolder();
  mkdirSync(dir, { recursive: true });
  const summary: Record<string, unknown> = {
    kind: "circuit-desk device dump", version: 1, createdAt: new Date().toISOString(), fake, mode,
    project: projectFile ? path.resolve(projectFile) : null, output: outName, input: inName,
    sent: replies.map((r) => ({ label: r.label, bytes: r.sent, answered: r.reply !== null })),
  };
  if (mode === "fwid") {
    const r = replies[0]!.reply;
    const id = r ? parseFwidReply(r) : null;
    if (r) writeFileSync(path.join(dir, "fwid.syx"), Uint8Array.from(r));
    summary["fwid"] = id ?? null;
    console.log(id ? `firmware marker "${id.text}" (${hex(id.marker)}): a Circuit Hacks build` : "no fwid answer: the stock firmware (or a Hacks build older than the fwid hook)");
  } else {
    const synths = replies.map((r, s) => {
      if (!r.reply) return { synth: s + 1, answered: false };
      writeFileSync(path.join(dir, `synth${s + 1}.syx`), Uint8Array.from(r.reply));
      const dev = parsePatchMessage(Uint8Array.from(r.reply))!.patch;
      const d = comparePatches(filePatches![s]!, dev);
      console.log(`Synth ${s + 1}: ${describeDifferences(d)}`);
      return { synth: s + 1, answered: true, identical: d.length === 0, differences: d };
    });
    summary["synths"] = synths;
    summary["identical"] = synths.every((x) => "identical" in x && x.identical);
  }
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 1));
  if (fake) summary["fakeSent"] = await pageEval<number[][]>(wc, "window.__fakeSent");
  console.log(`saved → ${dir}`);
  if (fake) console.log(`fake device received: ${(summary["fakeSent"] as number[][]).map((b) => hex(b)).join(" | ")}`);
  // Exit codes: 0 answered (and, for a dump, byte-identical); 1 no answer; 2 a dumped patch differs.
  if (mode === "fwid") return 0;
  return !replies.every((r) => r.reply) ? 1 : summary["identical"] ? 0 : 2;
}

void app.whenReady().then(() => run()).then((code) => app.exit(code), (e: unknown) => { console.error(e); app.exit(1); });
