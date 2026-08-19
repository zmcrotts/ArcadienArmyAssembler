"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopRosterSync", {
  getStatus: () => ipcRenderer.invoke("roster-sync:get-status"),
  sync: saves => ipcRenderer.invoke("roster-sync:sync", saves),
  cleanDuplicates: saves => ipcRenderer.invoke("roster-sync:clean-duplicates", saves),
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
