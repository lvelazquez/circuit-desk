# Device file transfer (read only)

How Circuit Desk downloads projects from a Circuit Tracks over USB, without the SD card.

## Source

Captured on 2026-11-24 from Novation Components' web app (components.novationmusic.com) while it fetched one project (pack "00_Waves_SoundGhost", slot 31) from a Circuit Tracks on firmware 4486. A listener in the page recorded every SysEx message in both directions and sent nothing itself. Components sent 7 messages and received 48.

**Check:** the 20 data packets, unpacked, gave 160,780 bytes with the same SHA-256 as the `.ncs` Components saved for that slot (`219cbf0bb8b1…`).

## Messages

Every message starts `F0 00 20 29 01 64 03` (Novation, product 0x64) and ends `F7`. Numbers travel as 8 nibbles (u32, big-endian).

| Request | Meaning | Reply |
|---|---|---|
| `40` | Open a transfer session | `…64 08 00` (ack); a `03 04 00…` status message follows |
| `0B 01` | Unknown query; Components sends it first | `0B 01 01` |
| `09 01 00` | Unknown query | `09 01 00 00 00 00 00 06 01 00 0C` |
| `0B 02` | List packs | `0B 02 n`, then `0C 02 i <name>` per pack |
| `0B 03 pack` | List a pack's files | `0B 03 pack lo hi` (count 17 = `11 00`), then `0C 03 pack i NN_SESSION.ncs` per file |
| `01 <u32 0> 03 pack i 02` | Read file `i` (0-based slot) of kind 3, Sessions | `01 <u32 0> 03 pack i 01 <u32 size>`, then data packets |
| (none) | Data packet | `02 <u32 packet, from 1> 03 pack i <7-bit data>` |
| `41` | Close the session | `…64 08 00` |

- **Slot numbering:** file `NN_SESSION.ncs` with `i = NN` is slot `NN + 1` on the device grid.
- **Data packing:** groups of 8 bytes. The first byte holds the high bits: bit k is the high bit of data byte k. Up to 7 data bytes follow.
- **Packet size:** a full packet carries 8,192 bytes, 9,383 on the wire. A project is 20 packets, the last one 5,132 bytes.
- **Untested guess:** the `<u32 0>` in the read request is probably a start offset, since Components always sent 0.

## Not seen yet

The kinds other than 3 (Sessions) are not used here: 4 Patches, 5 PCM and 6 meta, from `circuit-hacks-rc` `tools/probe35s.py`. Writing a file is a different message, which Components sends when uploading. It is not captured, and Circuit Desk does not send it.

## Safety

- **Request builders:** `packages/patch/src/transfer.ts` builds the requests above and nothing else.
- **First check:** `assertTransferSend` accepts exactly these shapes and refuses everything else, data packets included. A data packet is what a write would send.
- **Second check:** `app/scripts/device-transfer.ts` checks every message again in the page before it reaches the port.
- **Dry run by default:** without `--yes` the script sends nothing. With `--fake` it talks to a simulated Circuit.

```
npm run app:device-transfer -- list --yes
npm run app:device-transfer -- get 31 32 --yes      # → ~/Circuit Desk/Device/<timestamp>/31_<name>.ncs …
```
