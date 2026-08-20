"use strict";

(() => {
  if (window.location.hostname.toLowerCase() !== "zmcrotts.github.io") return;
  const destination = new URL("https://arcadienarmyassembler.pages.dev/download");
  destination.search = window.location.search;
  destination.hash = window.location.hash;
  window.location.replace(destination.href);
})();
