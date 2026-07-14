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
  let registration = null;
  let ready = false;
  let busy = false;

  action.addEventListener("click", async () => {
    if (busy) return;
    if (!navigator.onLine) {
      render("error", "Connection required", "Reconnect once to download the complete offline package.");
      return;
    }
    busy = true;
    render("downloading", "Preparing offline copy", "Starting download…", 0, 1);
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
      await registration?.update();
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
      busy = false;
      if (ready) renderReady(message.totalBytes);
      else render("needed", "Offline setup needed", `${message.total} files • ${formatBytes(message.totalBytes)}`);
    }
    if (message.type === "OFFLINE_PROGRESS") {
      busy = true;
      const percent = Math.round((message.completed / Math.max(1, message.total)) * 100);
      render("downloading", "Downloading offline data", `${message.completed} of ${message.total} files • ${percent}%`, message.completed, message.total);
    }
    if (message.type === "OFFLINE_READY") {
      ready = true;
      busy = false;
      renderReady(message.totalBytes);
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
    if (!("serviceWorker" in navigator)) {
      render("error", "Offline mode unavailable", "This browser does not support installable offline apps.");
      return;
    }
    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      registration = await navigator.serviceWorker.ready;
      requestStatus();
    } catch (error) {
      render("error", "Offline mode unavailable", error?.message || "Could not start offline support.");
    }
  }

  function requestStatus() {
    const worker = registration?.active || registration?.waiting || registration?.installing;
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
    action.textContent = state === "ready" ? "Check for updates" : "Download for offline use";
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "size unavailable";
    return `${(value / 1024 / 1024).toFixed(0)} MB`;
  }
})();
