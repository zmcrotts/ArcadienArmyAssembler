"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopRosterSync", {
  getStatus: () => ipcRenderer.invoke("roster-sync:get-status"),
  sync: saves => ipcRenderer.invoke("roster-sync:sync", saves),
  changeFolder: () => ipcRenderer.invoke("roster-sync:change-folder"),
  disconnect: () => ipcRenderer.invoke("roster-sync:disconnect")
});
