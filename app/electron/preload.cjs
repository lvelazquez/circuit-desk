// Plain JavaScript on purpose: Electron loads a sandboxed preload without type stripping, and it
// can only require "electron". It exposes the bridge typed in api.ts (DeskBridge) and nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("circuitDesk", {
  call: (method, args) => ipcRenderer.invoke("desk:call", method, args),
  pickProject: () => ipcRenderer.invoke("desk:pickProject"),
  reveal: (path) => ipcRenderer.invoke("desk:reveal", path),
  onMenu: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("desk:menu", listener);
    return () => ipcRenderer.removeListener("desk:menu", listener);
  },
});
