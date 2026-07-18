"use strict";

try {
  document.documentElement.dataset.theme = localStorage.getItem("engineTheme") === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
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
