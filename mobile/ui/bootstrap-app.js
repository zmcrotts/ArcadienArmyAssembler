"use strict";

try {
  const installedWebApp = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const androidApp = Boolean(window.AndroidFiles);
  const mobileUi = androidApp || installedWebApp || window.matchMedia("(max-width: 860px)").matches;
  if (androidApp && window.screen.width > 860) {
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=860, initial-scale=1, viewport-fit=cover");
  }
  document.documentElement.dataset.mobileUi = mobileUi ? "true" : "false";
  document.documentElement.dataset.nativeShell = androidApp ? "android" : "web";
  const storedTheme = localStorage.getItem("engineTheme");
  const theme = ["light", "dark", "custom"].includes(storedTheme) ? storedTheme : "light";
  const activeTheme = mobileUi ? "dark" : theme;
  document.documentElement.dataset.theme = activeTheme === "custom" ? "dark" : activeTheme;
  document.documentElement.dataset.customTheme = activeTheme === "custom" ? "true" : "false";
  if (activeTheme === "custom") applyBootCustomTheme();
} catch {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.customTheme = "false";
}

function applyBootCustomTheme() {
  const defaults = { canvas: "#101417", surface: "#171d21", raised: "#20282d", text: "#cbd5d9", accent: "#0f8290" };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem("engineCustomThemeV1") || "null") || {}; } catch { /* Use defaults. */ }
  for (const [channel, fallback] of Object.entries(defaults)) {
    const candidate = typeof stored[channel] === "string" ? stored[channel] : "";
    document.documentElement.style.setProperty(`--custom-${channel}`, /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback);
  }
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
