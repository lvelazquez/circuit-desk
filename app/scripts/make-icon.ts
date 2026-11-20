// Draws the app icon: build/icon.svg (the source) and build/icon.png (1024 × 1024, transparent),
// which electron-builder turns into the macOS .icns. Rendered by Electron's own Chromium so the PNG
// matches the SVG exactly. `npm run app:icon`.
//
// The design is original: a dark tile with a synth waveform over a grid of lit pads, in the app's
// own track colours (app/src/tokens.css). No Novation marks or the device's layout.
import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SIZE = 1024;
const root = path.resolve(import.meta.dirname, "..", "..");
const out = path.join(root, "build");

// Colours from app/src/tokens.css (track colours and surfaces).
const C = {
  synth1: "#a78bfa", synth2: "#f0abfc", midi1: "#5eead4", midi2: "#86efac",
  drum1: "#fb923c", drum2: "#fbbf24", drum3: "#fde047",
  pad: "#2a2d35", tileTop: "#262a33", tileBottom: "#0f1013",
};

// macOS icon grid: an 824-unit tile centred in the 1024 canvas, corner radius ≈ 22.5 %.
const TILE = { x: 100, y: 100, size: 824, r: 185 };

/** A waveform: two cycles of a clean sine. */
function wavePath(x0: number, x1: number, cy: number, amp: number): string {
  const pts: string[] = [];
  const n = 240;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const y = Math.sin(u * Math.PI * 2 * 2);
    pts.push(`${(x0 + u * (x1 - x0)).toFixed(2)},${(cy - y * amp).toFixed(2)}`);
  }
  return `M${pts.join(" L")}`;
}

// 4 × 3 pads; lit ones carry a track colour, like a pattern playing.
const LIT: (keyof typeof C | null)[][] = [
  ["synth1", null, "synth2", null],
  [null, "midi1", null, "drum1"],
  ["drum2", null, "midi2", "drum3"],
];
const PAD = 128, GAP = 28, COLS = 4, ROWS = 3;
const gridW = COLS * PAD + (COLS - 1) * GAP;
const gridX = TILE.x + (TILE.size - gridW) / 2;
const gridY = TILE.y + TILE.size - 100 - (ROWS * PAD + (ROWS - 1) * GAP);

const pads = LIT.flatMap((row, r) => row.map((lit, c) => {
  const x = gridX + c * (PAD + GAP), y = gridY + r * (PAD + GAP);
  if (!lit) return `<rect x="${x}" y="${y}" width="${PAD}" height="${PAD}" rx="30" fill="${C.pad}" stroke="#ffffff" stroke-opacity="0.05" stroke-width="2"/>`;
  const col = C[lit];
  return [
    `<rect x="${x}" y="${y}" width="${PAD}" height="${PAD}" rx="30" fill="${col}" filter="url(#glow)" opacity="0.55"/>`,
    `<rect x="${x}" y="${y}" width="${PAD}" height="${PAD}" rx="30" fill="${col}"/>`,
    `<rect x="${x}" y="${y}" width="${PAD}" height="${PAD}" rx="30" fill="url(#padShine)"/>`,
  ].join("");
})).join("\n  ");

const waveX0 = gridX + 10, waveX1 = gridX + gridW - 10;
// Centred in the band between the tile's top and the pads.
const wave = wavePath(waveX0, waveX1, (TILE.y + gridY) / 2 + 4, 52);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.tileTop}"/>
      <stop offset="1" stop-color="${C.tileBottom}"/>
    </linearGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.synth1}"/>
      <stop offset="1" stop-color="${C.synth2}"/>
    </linearGradient>
    <linearGradient id="padShine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.12"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="waveGlow" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.r}" fill="url(#tile)" filter="url(#shadow)"/>
  <rect x="${TILE.x + 1.5}" y="${TILE.y + 1.5}" width="${TILE.size - 3}" height="${TILE.size - 3}" rx="${TILE.r - 1.5}" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="3"/>
  <path d="${wave}" fill="none" stroke="url(#wave)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" filter="url(#waveGlow)" opacity="0.7"/>
  <path d="${wave}" fill="none" stroke="url(#wave)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  ${pads}
</svg>
`;

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "icon.svg"), svg);

void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 400));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  if (img.getSize().width !== SIZE) img = img.resize({ width: SIZE, height: SIZE, quality: "best" });
  writeFileSync(path.join(out, "icon.png"), img.toPNG());
  console.log(`wrote ${path.join(out, "icon.svg")} and icon.png (${img.getSize().width} × ${img.getSize().height})`);
  app.exit(0);
});
