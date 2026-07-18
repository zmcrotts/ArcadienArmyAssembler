"use strict";

(() => {
  const panel = document.getElementById("offlinePanel");
  const title = document.getElementById("offlineTitle");
  const detail = document.getElementById("offlineDetail");
  const progress = document.getElementById("offlineProgress");
  const action = document.getElementById("offlineAction");
  if (!panel || !title || !detail || !progress || !action) return;

  const supportedProtocol = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (window.AndroidFiles || !supportedProtocol) return;

  const installedApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  panel.hidden = false;
  if (!("serviceWorker" in navigator)) {
    render("error", "Offline mode unavailable", "This browser does not support installable offline apps.");
    return;
  }
  let registration = null;
  let ready = false;
  let busy = false;
  let expectedBytes = 0;
  const controlledAtStart = Boolean(navigator.serviceWorker.controller);
  let reloadAvailable = false;
  let reloadRequested = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtStart) return;
    if (reloadRequested) {
      location.reload();
      return;
    }
    reloadAvailable = true;
    if (!busy) renderUpdateReady();
  });

  action.addEventListener("click", async () => {
    if (busy) return;
    if (reloadAvailable) {
      if (window.ArcadienApp?.hasUnsavedChanges?.()) {
        render("update", "Update ready", "Save the current list before reloading to apply the update.");
        return;
      }
      const waiting = registration?.waiting;
      if (waiting) {
        reloadRequested = true;
        busy = true;
        render("downloading", "Applying update", "Reloading the updated app…", 0, 1);
        waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        location.reload();
      }
      return;
    }
    if (!navigator.onLine) {
      render("error", "Connection required", "Reconnect once to download the complete offline package.");
      return;
    }
    busy = true;
    render("downloading", "Preparing offline copy", "Starting download…", 0, 1);
    try {
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
      await ensureCapacity(expectedBytes);
      await registration?.update().catch(() => null);
      registration = await navigator.serviceWorker.ready;
      const worker = await activeWorker(registration);
      if (!worker) throw new Error("Offline worker is not ready yet.");
      worker.postMessage({ type: "DOWNLOAD_OFFLINE" });
    } catch (error) {
      busy = false;
      render("error", "Offline setup failed", error?.message || "Try again while connected.");
    }
  });

  navigator.serviceWorker.addEventListener("message", event => {
    const message = event.data || {};
    if (message.type === "OFFLINE_STATUS") {
      ready = Boolean(message.ready);
      expectedBytes = Number(message.totalBytes || 0);
      busy = false;
      if (reloadAvailable) renderUpdateReady();
      else if (ready) renderReady(message.totalBytes);
      else render("needed", "Offline setup needed", `${message.total} files • ${formatBytes(message.totalBytes)}`);
    }
    if (message.type === "OFFLINE_PROGRESS") {
      busy = true;
      const percent = Math.round((message.completed / Math.max(1, message.total)) * 100);
      render("downloading", "Downloading offline data", `${message.completed} of ${message.total} files • ${percent}%`, message.completed, message.total);
    }
    if (message.type === "OFFLINE_READY") {
      ready = true;
      expectedBytes = Number(message.totalBytes || expectedBytes);
      busy = false;
      if (reloadAvailable) renderUpdateReady();
      else renderReady(message.totalBytes);
    }
    if (message.type === "OFFLINE_ERROR") {
      ready = false;
      busy = false;
      render("error", "Offline setup incomplete", `${message.message || "Download failed."} Your previous complete copy, if any, was preserved.`);
    }
  });

  window.addEventListener("online", () => {
    if (!busy && !ready) requestStatus();
  });
  window.addEventListener("offline", () => {
    if (!busy && ready) renderReady();
  });

  start();

  async function start() {
    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      watchForUpdate(registration);
      registration = await navigator.serviceWorker.ready;
      requestStatus();
      void registration.update().catch(() => null);
    } catch (error) {
      registration = await navigator.serviceWorker.getRegistration("./").catch(() => null);
      if (registration || navigator.serviceWorker.controller) requestStatus();
      else render("error", "Offline mode unavailable", error?.message || "Could not start offline support.");
    }
  }

  function watchForUpdate(currentRegistration) {
    if (currentRegistration.waiting && navigator.serviceWorker.controller) {
      reloadAvailable = true;
      renderUpdateReady();
    }
    currentRegistration.addEventListener("updatefound", () => {
      const installing = currentRegistration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state !== "installed" || !navigator.serviceWorker.controller) return;
        reloadAvailable = true;
        if (!busy) renderUpdateReady();
      });
    });
  }

  function requestStatus() {
    const worker = registration?.active || registration?.waiting || registration?.installing || navigator.serviceWorker.controller;
    if (worker) worker.postMessage({ type: "GET_OFFLINE_STATUS" });
  }

  async function activeWorker(currentRegistration) {
    const pending = currentRegistration?.installing || currentRegistration?.waiting;
    if (pending && pending.state !== "activated") {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 10000);
        pending.addEventListener("statechange", () => {
          if (pending.state === "activated" || pending.state === "redundant") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
    return currentRegistration?.active || pending || null;
  }

  function renderReady(totalBytes) {
    const connection = navigator.onLine ? "Ready without a connection" : "Working offline now";
    render("ready", "Offline ready", totalBytes ? `${connection} • ${formatBytes(totalBytes)}` : connection);
  }

  function renderUpdateReady() {
    render("update", "Update ready", "Save any current changes, then reload to use the updated app.");
  }

  async function ensureCapacity(bytes) {
    if (!bytes || !navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    const quota = Number(estimate.quota || 0);
    const usage = Number(estimate.usage || 0);
    if (quota && quota - usage < bytes * 1.1) {
      throw new Error(`The offline package needs about ${formatBytes(bytes * 1.1)} of free browser storage.`);
    }
  }

  function render(state, heading, message, completed = 0, total = 1) {
    panel.dataset.state = state;
    panel.hidden = state === "ready" && installedApp;
    title.textContent = heading;
    detail.textContent = message;
    progress.hidden = state !== "downloading";
    progress.max = Math.max(1, total);
    progress.value = completed;
    action.hidden = state === "downloading";
    action.disabled = state === "downloading";
    action.textContent = state === "update" ? "Reload to update" : state === "ready" ? "Check for updates" : "Download for offline use";
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "size unavailable";
    return `${(value / 1024 / 1024).toFixed(0)} MB`;
  }
})();
