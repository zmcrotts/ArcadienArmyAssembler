"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopRosterSync", {
  getStatus: () => ipcRenderer.invoke("roster-sync:get-status"),
  sync: (saves, syncState) => ipcRenderer.invoke("roster-sync:sync", saves, syncState),
  cleanDuplicates: (saves, syncState) => ipcRenderer.invoke("roster-sync:clean-duplicates", saves, syncState),
  disconnect: () => ipcRenderer.invoke("roster-sync:disconnect")
});

contextBridge.exposeInMainWorld("desktopRosterLinks", {
  onImportUrl: callback => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("roster-import-url", listener);
    return () => ipcRenderer.removeListener("roster-import-url", listener);
  }
});
