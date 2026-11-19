// Builds the standalone Mac app: `npm run app:dist` → release/Circuit Desk-<version>-arm64.dmg.
//   1. the window (Vite → app/dist), 2. the main process bundled into app/dist-electron/main.js
//   (+ preload.cjs), 3. a staging folder holding only those and a package.json with no
//   dependencies (everything is bundled), 4. electron-builder on the staging folder.
// Unsigned, like the jig-room app: the first launch needs right-click › Open (or System Settings).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build, Platform } from "electron-builder";

const root = resolve(import.meta.dirname, "..");
const appDir = join(root, "app");
const stage = join(appDir, "release-stage");
const appPkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
  version?: string;
  devDependencies?: Record<string, string>;
};
const version = appPkg.version ?? "0.0.0";
const electronVersion = appPkg.devDependencies?.["electron"];
if (!electronVersion) throw new Error("app/package.json has no electron devDependency");

const vite = join(root, "node_modules", ".bin", "vite");
const run = (cmd: string, args: string[]): void => { execFileSync(cmd, args, { cwd: root, stdio: "inherit" }); };

console.log("1/4 window");
run(vite, ["build", "--config", "app/vite.config.ts"]);
console.log("2/4 main process");
run(vite, ["build", "--config", "app/vite.electron.config.ts"]);
cpSync(join(appDir, "electron", "preload.cjs"), join(appDir, "dist-electron", "preload.cjs"));

console.log("3/4 staging");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(appDir, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(appDir, "dist-electron"), join(stage, "dist-electron"), { recursive: true });
writeFileSync(join(stage, "package.json"), JSON.stringify({
  name: "circuit-desk",
  productName: "Circuit Desk",
  version,
  description: "Desktop project editor for the Novation Circuit Tracks",
  author: "Leonardo Velazquez",
  type: "module",
  main: "dist-electron/main.js",
}, null, 2));

console.log("4/4 electron-builder");
const icon = join(root, "build", "icon.png");
await build({
  targets: Platform.MAC.createTarget(["dmg"]),
  projectDir: stage,
  config: {
    appId: "app.circuitdesk.desktop",
    productName: "Circuit Desk",
    electronVersion: electronVersion.replace(/^[^\d]*/, ""),
    directories: { output: join(root, "release"), buildResources: join(root, "build") },
    files: ["dist/**", "dist-electron/**", "package.json"],
    npmRebuild: false,
    mac: {
      category: "public.app-category.music",
      target: [{ target: "dmg", arch: ["arm64"] }],
      identity: null,
      ...(existsSync(icon) ? { icon } : {}),
    },
  },
});
console.log(`done: ${join(root, "release")}`);
