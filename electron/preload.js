"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopRosterSync", {
  getStatus: () => ipcRenderer.invoke("roster-sync:get-status"),
  sync: saves => ipcRenderer.invoke("roster-sync:sync", saves),
  cleanDuplicates: saves => ipcRenderer.invoke("roster-sync:clean-duplicates", saves),
  disconnect: () => ipcRenderer.invoke("roster-sync:disconnect")
});

contextBridge.exposeInMainWorld("desktopLifecycle", {
  onCloseRequested: callback => {
    if (typeof callback !== "function") throw new TypeError("Close handler must be a function.");
    const listener = () => callback();
    ipcRenderer.on("app:close-requested", listener);
    return () => ipcRenderer.removeListener("app:close-requested", listener);
  },
  respondToClose: allow => ipcRenderer.send("app:close-response", allow === true)
});
