// Bundles the Electron main process (electron/main.ts and the workspace packages it imports) into
// one ES module, app/dist-electron/main.js, for the standalone app. In development Electron runs the
// .ts sources directly; inside a packaged app Node will not strip types from files reached through
// node_modules, so the packaged app runs this bundle instead.
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  // Main-process code only: nothing from the window's public folder.
  publicDir: false,
  ssr: { noExternal: true, external: ["electron"] },
  build: {
    ssr: "electron/main.ts",
    outDir: "dist-electron",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: true,
    rollupOptions: { output: { format: "es", entryFileNames: "main.js" } },
  },
});
