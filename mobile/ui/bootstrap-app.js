"use strict";

try {
  const installedWebApp = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const androidApp = Boolean(window.AndroidFiles);
  const mobileUi = androidApp || installedWebApp || window.matchMedia("(max-width: 860px)").matches;
  if (androidApp && window.screen.width > 860) {
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=860, initial-scale=1, viewport-fit=cover");
  }
  document.documentElement.dataset.mobileUi = mobileUi ? "true" : "false";
  document.documentElement.dataset.theme = mobileUi || localStorage.getItem("engineTheme") === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "dark";
}

window.addEventListener("error", event => {
  if (!(event.target instanceof HTMLScriptElement)) return;
  showStartupFailure("A required app file could not be loaded.");
}, true);

window.setTimeout(() => {
  if (!document.getElementById("builderShell")?.hidden) return;
  showStartupFailure("Startup is taking longer than expected.");
}, 60000);

function showStartupFailure(message) {
  const panel = document.querySelector("#startScreen .startupPanel");
  if (!panel || panel.querySelector("[data-startup-retry]")) return;
  const detail = panel.querySelector("p");
  if (detail) detail.textContent = message;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.dataset.startupRetry = "true";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => location.reload());
  panel.appendChild(retry);
}
