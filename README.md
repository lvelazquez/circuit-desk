# Circuit Desk

A desktop editor for **Novation Circuit Tracks** projects. Open the `.ncs` files from your SD card, see and edit every track, hear a preview, and export to MIDI or Ableton Live.

Circuit Desk is an independent project. It is not made or endorsed by Novation or Focusrite.

## Features

- **Circuit-style view.** All 8 tracks, patterns, chains and scenes in a pad grid, with a piano roll, drum editor and inspector.
- **Sequence editing.**
  - Notes: velocity, gate, micro-step offset and probability.
  - Patterns: length and play direction (forward, reverse, ping-pong, random).
  - Automation lanes, scenes and chains.
- **Mixer and project settings.**
  - Mixer: levels, pans, reverb and delay sends, the reverb and delay themselves, and sidechains.
  - Project: tempo, swing, scale and root, and drum sounds.
- **Undo.** Every edit can be undone.
- **Preview.** An emulation of the Circuit's synth voice with the pack's own samples, with swing, probability and direction applied as the device plays them.
- **MIDI out.** Play a project to the Circuit, to Live or to any MIDI port, with clock.
- **Export.** Multitrack `.mid` and Ableton Live sets, with automation.
- **MCP server.** An AI assistant can read projects and make edits through the same safe operations as the app.
- **Your files stay as they are.** The app never overwrites a project or the card; edits are saved as a new copy.

## Status

The `.ncs` format is undocumented. Every field Circuit Desk reads is listed in a registry (`packages/ncs/src/registry.ts`) with its evidence, and each field has a status:

| Status | Meaning |
|---|---|
| `verified` | Confirmed on hardware |
| `partial` | Strong evidence from real projects, not yet confirmed on a device |
| `unknown` | Not decoded |

The app shows which status applies when you edit a field.

Not there yet:
- **Wavetables.** Oscillators 14–29 play placeholder shapes.
- **Patch editor.** You can't edit synth patches yet.
- **Sending edits back.** Edits can't be sent to the device. Copy the saved file to the card yourself.
- **Platforms.** Only macOS (Apple Silicon) has been built and tested.

## Install

Download the `.dmg` from Releases. The app isn't code-signed, so macOS warns you the first time: right-click the app, choose **Open**, then confirm.

## Build from source

Needs Node.js 22 or later.

```sh
npm install
npm test            # unit tests
npm run typecheck
npm run app         # build and run the app
npm run app:dist    # package a .dmg into release/
npm run mcp         # the MCP server, over stdio
```

## Layout

| Path | What |
|---|---|
| `packages/ncs` | `.ncs` read and write, the field registry, settings |
| `packages/export` | Arrangement, MIDI and Ableton Live export |
| `packages/playback` | The sequencer schedule |
| `packages/engine` | The Web Audio preview and synth voice |
| `packages/patch` | Synth patches, SysEx, read-only device transfer |
| `packages/core-service` | Projects, edits and undo, shared by the app and MCP |
| `packages/mcp` | MCP server |
| `app` | Electron + React app |
| `tools` | Command-line tools (export, card survey, device checks) |
| `docs` | Plans, format notes and device-check write-ups |

## Firmware, samples and your data

The repository contains no Novation firmware, factory samples, patches, manuals or user projects. A few synth curves are fitted formulas derived from studying the firmware's behaviour. The tools in `tools/firmware` work only with a firmware image you supply yourself, and never commit what they extract.

## Credits

- **The format notes** build on the reverse-engineering in [CIRCUIT-HACKS](https://github.com/Ghillermo/CIRCUIT-HACKS-RC) (MIT, © 2026 Ghillermo), in particular its NOTAS notes. Citations such as `NOTAS:1828` point there.
- **Circuit Tracks, Components and Novation** are trademarks of Focusrite Audio Engineering Ltd.

## Licence

[MIT](LICENSE)
